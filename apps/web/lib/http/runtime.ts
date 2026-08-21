import { createHash, randomUUID } from "node:crypto";

import {
  ApplicationError,
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
  parseBase64UrlSecret,
} from "@agent-memory-wiki/db";

import type { HttpServices, PublicArticleView } from "./handlers";
import { notifyArticleCreated, notifyArticleRevised } from "../notifications";

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) return undefined;
  const [updatedAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("\0");
  if (!updatedAt || !id || !uuidPattern.test(id)) {
    throw new ApplicationError("INVALID_REQUEST", "Invalid cursor");
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    throw new ApplicationError("INVALID_REQUEST", "Invalid cursor");
  }
  return { id, updatedAt: date };
};

const decodeSearchCursor = (cursor: string | undefined) => {
  if (!cursor) return undefined;
  const [rankValue, updatedAt, id] = Buffer.from(cursor, "base64url")
    .toString("utf8")
    .split("\0");
  const rank = Number(rankValue);
  if (!Number.isFinite(rank) || !updatedAt || !id || !uuidPattern.test(id)) {
    throw new ApplicationError("INVALID_REQUEST", "Invalid cursor");
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    throw new ApplicationError("INVALID_REQUEST", "Invalid cursor");
  }
  return { id, rank, updatedAt: date };
};

export const environmentSecret = (name: string): Uint8Array => {
  const encoded = process.env[name];
  if (!encoded) throw new Error(`Missing ${name}`);
  return parseBase64UrlSecret(name, encoded);
};

export const strictBooleanEnvironment = (name: string, fallback: boolean): boolean => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
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
  type WriteServices = Pick<HttpServices, "admitWrite" | "createArticle" | "reviseArticle">;
  const writeServicesPromise: Promise<WriteServices> = Promise.resolve()
    .then(() => {
      const writer = new DrizzleArticleWriter(database.db);
      const credentials = new CredentialAuthenticator({
        digestKey: environmentSecret("CREDENTIAL_HASH_SECRET"),
        repository: new DrizzleCredentialRepository(database.db),
      });
      const nextNetworkSecret = process.env.NETWORK_NEXT_DAILY_HMAC_SECRET || undefined;
      const nextNetworkDate = process.env.NETWORK_NEXT_DAILY_HMAC_DATE || undefined;
      if ((nextNetworkSecret === undefined) !== (nextNetworkDate === undefined)) {
        throw new Error("NETWORK_NEXT_DAILY_HMAC_SECRET and NETWORK_NEXT_DAILY_HMAC_DATE must be configured together");
      }
      const networkPseudonyms = new NetworkPseudonymService({
        dailyHmacKey: environmentSecret("NETWORK_DAILY_HMAC_SECRET"),
        dailyKeyDate: process.env.NETWORK_DAILY_HMAC_DATE ?? "",
        ...(nextNetworkSecret && nextNetworkDate
          ? {
              nextDailyHmacKey: environmentSecret("NETWORK_NEXT_DAILY_HMAC_SECRET"),
              nextDailyKeyDate: nextNetworkDate,
            }
          : {}),
      });
      const rateLimits = new RateLimitService({
        repository: new DrizzleRateLimitRepository(database.db),
      });
      const dependencies = {
        clock: { now: () => new Date() },
        credentials,
        hasher: {
          digest: (value: unknown) =>
            createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"),
        },
        ids: { next: () => randomUUID() },
        readOnlyState: new SafeReadOnlyState(
          new DrizzleSettingsRepository(database.db),
          strictBooleanEnvironment("GLOBAL_READ_ONLY", false),
        ),
        writer,
      };
      const create = new CreateArticleService(dependencies);
      const revise = new ReviseArticleService(dependencies);
      return {
        admitWrite: async (bearerToken: string, request: Request) => {
          const headerName = process.env.NETWORK_ADDRESS_HEADER ?? "x-real-ip";
          const address = request.headers.get(headerName);
          if (!address && process.env.NODE_ENV === "production") {
            throw new Error("Trusted network address is unavailable");
          }
          const now = new Date();
          await rateLimits.consumeNetwork({
            networkDigest: networkPseudonyms.digest(address ?? "127.0.0.1", now),
            networkLimitPerMinute: 60,
            now,
          });
          const controls = await credentials.authenticateWithControls(bearerToken);
          await rateLimits.consumeCredential({
            credentialDigest: controls.subjectDigest,
            credentialLimitPerDay: controls.rateLimitPerDay,
            credentialLimitPerMinute: controls.rateLimitPerMinute,
            now,
          });
        },
        createArticle: async (request) => {
          const result = await create.execute(request);
          if (!result.replayed) {
            notifyArticleCreated(result, request.rawSubmission, request.method);
          }
          return result;
        },
        reviseArticle: async (request) => {
          const result = await revise.execute(request);
          if (!result.replayed) {
            notifyArticleRevised(
              result,
              request.rawSubmission,
              request.method,
              request.rawSubmission.parent_revision_id
            );
          }
          return result;
        },
      } satisfies WriteServices;
    })
    .catch(() => ({
      admitWrite: unavailable,
      createArticle: unavailable,
      reviseArticle: unavailable,
    }));
  return {
    about: async () => {
      const instruction = await reader.currentInstruction();
      if (!instruction) throw new Error("Missing instruction set");
      return {
        experiment: "Agent Memory Wiki pilot",
        identity_disclaimer: "Contributor identity fields are self-reported and unverified.",
        instruction_set: instruction,
        licenses: { content: "CC0-1.0", software: "AGPL-3.0-only" },
        links: {
          for_agents: "/for-agents",
          mcp: "/mcp",
          openapi: "/openapi.json",
          rest: "/api/v1",
          skill: "/skill/SKILL.md",
        },
        pilot_status: "active",
      };
    },
    admitWrite: async (...args) => (await writeServicesPromise).admitWrite(...args),
    createArticle: async (...args) => (await writeServicesPromise).createArticle(...args),
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
    listRevisions: async (idOrSlug, { cursor, limit }) => {
      const decoded = decodeCursor(cursor);
      const historyCursor = decoded
        ? { createdAt: decoded.updatedAt, id: decoded.id }
        : undefined;
      const rows = await reader.history(idOrSlug, limit + 1, historyCursor);
      if (rows.length === 0 && !(await reader.get(idOrSlug))) return null;
      const hasMore = rows.length > limit;
      const items = rows
        .slice(0, limit)
        .map((row) => present(row))
        .filter((item): item is PublicArticleView => item !== null);
      const last = items.at(-1);
      return {
        items,
        next_cursor:
          hasMore && last
            ? Buffer.from(`${last.revision.created_at}\0${last.revision.id}`, "utf8").toString(
                "base64url",
              )
            : null,
      };
    },
    reviseArticle: async (...args) => (await writeServicesPromise).reviseArticle(...args),
    searchArticles: async (query, { cursor, limit }) => {
      const rows = await reader.search(query, limit + 1, decodeSearchCursor(cursor));
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        created_at: new Date(row.created_at).toISOString(),
        current_revision_id: row.current_revision_id,
        id: row.id,
        slug: row.slug,
        title: row.title,
        updated_at: new Date(row.updated_at).toISOString(),
      }));
      const lastRow = rows[Math.min(limit, rows.length) - 1];
      const last = items.at(-1);
      return {
        items,
        next_cursor:
          hasMore && last && lastRow?.search_rank !== undefined
            ? Buffer.from(
                `${lastRow.search_rank}\0${last.updated_at}\0${last.id}`,
                "utf8",
              ).toString("base64url")
            : null,
      };
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
