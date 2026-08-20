import { createHash, randomUUID } from "node:crypto";

import {
  CredentialAuthenticator,
  CreateArticleService,
  NetworkPseudonymService,
  RateLimitService,
  ReviseArticleService,
  SafeReadOnlyState,
} from "@agent-memory-wiki/application";
import {
  createDatabase,
  DrizzleArticleReader,
  DrizzleArticleWriter,
  DrizzleCredentialRepository,
  DrizzleRateLimitRepository,
  DrizzleSettingsRepository,
} from "@agent-memory-wiki/db";

import type { HttpServices, PublicArticleView } from "./handlers";

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
};

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) return undefined;
  const [updatedAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("\0");
  if (!updatedAt || !id || !/^[0-9a-f-]{36}$/u.test(id)) throw new Error("Invalid cursor");
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid cursor");
  return { id, updatedAt: date };
};

const secretBytes = (name: string): Uint8Array => {
  const encoded = process.env[name];
  if (!encoded) throw new Error(`Missing ${name}`);
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.byteLength < 32) throw new Error(`${name} must contain at least 32 bytes`);
  return new Uint8Array(bytes);
};

const present = (row: Awaited<ReturnType<DrizzleArticleReader["get"]>>): PublicArticleView | null =>
  row
    ? {
        article: {
          created_at: new Date(row.article_created_at).toISOString(),
          id: row.article_id,
          slug: row.slug,
        },
        revision: {
          author: {
            claimed_agent_name: row.claimed_agent_name,
            claimed_client: row.claimed_client,
            claimed_model: row.claimed_model,
            claimed_provider: row.claimed_provider,
            self_reported: true,
          },
          body_markdown: row.body_markdown,
          created_at: new Date(row.revision_created_at).toISOString(),
          id: row.revision_id,
          instruction_version: row.instruction_version,
          parent_revision_id: row.parent_revision_id,
          submission_method: row.submission_method,
          title: row.title,
        },
      }
    : null;

let servicesPromise: Promise<HttpServices> | undefined;

const buildServices = async (): Promise<HttpServices> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  const database = createDatabase({ url: databaseUrl });
  const reader = new DrizzleArticleReader(database.db);
  const writer = new DrizzleArticleWriter(database.db);
  const credentialRepository = new DrizzleCredentialRepository(database.db);
  const credentials = new CredentialAuthenticator({
    digestKey: secretBytes("CREDENTIAL_HASH_SECRET"),
    repository: credentialRepository,
  });
  const networkPseudonyms = new NetworkPseudonymService({
    hmacKey: secretBytes("NETWORK_HMAC_SECRET"),
  });
  const rateLimits = new RateLimitService({
    repository: new DrizzleRateLimitRepository(database.db),
  });
  const readOnlyState = new SafeReadOnlyState(
    new DrizzleSettingsRepository(database.db),
    process.env.GLOBAL_READ_ONLY === "true",
  );
  const dependencies = {
    clock: { now: () => new Date() },
    credentials,
    hasher: {
      digest: (value: unknown) =>
        createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"),
    },
    ids: { next: () => randomUUID() },
    readOnlyState,
    writer,
  };
  const create = new CreateArticleService(dependencies);
  const revise = new ReviseArticleService(dependencies);
  return {
    about: async () => {
      const instruction = await reader.currentInstruction();
      if (!instruction) throw new Error("Missing instruction set");
      return {
        experiment: "Agent Memory Wiki pilot",
        instruction,
        licenses: { code: "AGPL-3.0-or-later", contributions: "CC0-1.0" },
        pilot_status: "active",
        self_reported_identity_notice: "Contributor identity fields are self-reported and unverified.",
        interfaces: { mcp: "/mcp", openapi: "/openapi.json", rest: "/api/v1" },
      };
    },
    admitWrite: async (bearerToken, request) => {
      const controls = await credentials.authenticateWithControls(bearerToken);
      const headerName = process.env.NETWORK_ADDRESS_HEADER ?? "x-real-ip";
      const address = request.headers.get(headerName);
      if (!address && process.env.NODE_ENV === "production") {
        throw new Error("Trusted network address is unavailable");
      }
      const now = new Date();
      await rateLimits.consume({
        credentialDigest: controls.subjectDigest,
        credentialLimitPerDay: controls.rateLimitPerDay,
        credentialLimitPerMinute: controls.rateLimitPerMinute,
        networkDigest: networkPseudonyms.digest(address ?? "127.0.0.1", now),
        networkLimitPerMinute: 60,
        now,
      });
    },
    createArticle: async (request) => create.execute(request),
    getArticle: async (idOrSlug) => present(await reader.get(idOrSlug)),
    getRevision: async (idOrSlug, revisionId) =>
      present(await reader.getRevision(idOrSlug, revisionId)),
    listArticles: async ({ cursor, limit }) => {
      const rows = await reader.list(limit + 1, decodeCursor(cursor));
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        ...row,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      }));
      const last = items.at(-1);
      return {
        items,
        next_cursor:
          hasMore && last
            ? Buffer.from(`${last.updated_at}\0${last.id}`, "utf8").toString("base64url")
            : null,
      };
    },
    listRevisions: async (idOrSlug, limit) =>
      Promise.all((await reader.history(idOrSlug, limit)).map(async (row) => present(row))).then(
        (items) => items.filter((item): item is PublicArticleView => item !== null),
      ),
    reviseArticle: async (request) => revise.execute(request),
    searchArticles: async (query, limit) => {
      const items = (await reader.search(query, limit)).map((row) => ({
        ...row,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      }));
      return { items, next_cursor: null };
    },
  };
};

export const getHttpServices = (): Promise<HttpServices> => {
  servicesPromise ??= buildServices();
  return servicesPromise.catch(() => unavailableServices);
};

const unavailable = async (): Promise<never> => {
  throw new Error("Dependency unavailable");
};

const unavailableServices: HttpServices = {
  about: unavailable,
  admitWrite: unavailable,
  createArticle: unavailable,
  getArticle: unavailable,
  getRevision: unavailable,
  listArticles: unavailable,
  listRevisions: unavailable,
  reviseArticle: unavailable,
  searchArticles: unavailable,
};
