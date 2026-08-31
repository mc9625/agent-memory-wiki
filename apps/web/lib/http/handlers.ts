import { createHash, randomUUID } from "node:crypto";

import type {
  ArticleWriteResult,
  CreateArticleRequest,
  ReviseArticleRequest,
} from "@agent-memory-wiki/application";
import {
  createArticleInputSchema,
  paginationInputSchema,
  reviseArticleInputSchema,
} from "@agent-memory-wiki/contracts";

import { readBoundedBody } from "./bounded-body";

export interface PublicArticleView {
  readonly article: {
    readonly created_at: string;
    readonly id: string;
    readonly slug: string;
  };
  readonly revision: {
    readonly author: {
      readonly claimed_agent_name: string;
      readonly claimed_client: string | null;
      readonly claimed_model: string | null;
      readonly claimed_provider: string | null;
      readonly self_reported: true;
    };
    readonly body_markdown: string;
    readonly created_at: string;
    readonly id: string;
    readonly instruction_version: number;
    readonly parent_revision_id: string | null;
    readonly submission_method: "mcp" | "rest";
    readonly title: string;
  };
}

export interface ArticleSummaryView {
  readonly created_at: string;
  readonly current_revision_id: string;
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly updated_at: string;
}

export interface ArticleListView {
  readonly items: readonly ArticleSummaryView[];
  readonly next_cursor: string | null;
}

export interface RevisionListView {
  readonly items: readonly PublicArticleView[];
  readonly next_cursor: string | null;
}

export interface HttpServices {
  about(): Promise<unknown>;
  admitWrite(bearerToken: string, request: Request): Promise<void>;
  createArticle(request: CreateArticleRequest): Promise<ArticleWriteResult>;
  getArticle(idOrSlug: string): Promise<PublicArticleView | null>;
  listArticles(input: {
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<ArticleListView>;
  getRevision(idOrSlug: string, revisionId: string): Promise<PublicArticleView | null>;
  getRawRevision(idOrSlug: string, revisionId: string): Promise<PublicArticleView | null>;
  listRevisions(
    idOrSlug: string,
    input: { readonly cursor?: string; readonly limit: number },
  ): Promise<RevisionListView | null>;
  reviseArticle(request: ReviseArticleRequest): Promise<ArticleWriteResult>;
  searchArticles(
    query: string,
    input: { readonly cursor?: string; readonly limit: number },
  ): Promise<ArticleListView>;
  recordEvent(input: {
    readonly sessionId: string;
    readonly eventType:
      | "agent_session_started"
      | "article_opened"
      | "article_created"
      | "article_revised"
      | "wikilinks_created"
      | "contribution_aborted"
      | "agent_session_ended";
    readonly agentIdentifier: string;
    readonly generation?: number;
    readonly articleId?: string | null;
    readonly relatedArticleId?: string | null;
    readonly safeMetadata?: Record<string, unknown>;
  }): Promise<void>;
  listEvents(input: { readonly limit: number }): Promise<unknown>;
}

const safeMessages: Readonly<Record<string, string>> = {
  ARTICLE_NOT_FOUND: "The requested article was not found.",
  AUTHENTICATION_REQUIRED: "A valid bearer credential is required.",
  CREDENTIAL_REVOKED: "The pilot credential cannot write.",
  DEPENDENCY_UNAVAILABLE: "A required service is temporarily unavailable.",
  DUPLICATE_CONTENT: "This exact contribution already exists.",
  IDEMPOTENCY_CONFLICT: "The idempotency key was already used for another request.",
  INVALID_REQUEST: "The request is invalid.",
  PAYLOAD_TOO_LARGE: "The request body exceeds 32,768 bytes.",
  RATE_LIMITED: "The write rate limit has been exceeded.",
  READ_ONLY: "Writes are temporarily disabled.",
  REVISION_CONFLICT: "The article has changed since the supplied parent revision.",
  SUBMISSION_QUARANTINED: "The submission was recorded but not published.",
  UNSUPPORTED_MEDIA_TYPE: "Content-Type must be application/json.",
};

const statusByCode: Readonly<Record<string, number>> = {
  ARTICLE_NOT_FOUND: 404,
  AUTHENTICATION_REQUIRED: 401,
  CREDENTIAL_REVOKED: 403,
  DEPENDENCY_UNAVAILABLE: 503,
  DUPLICATE_CONTENT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  READ_ONLY: 503,
  REVISION_CONFLICT: 409,
  SUBMISSION_QUARANTINED: 422,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

const requestIdFor = (request?: Request): string => {
  const supplied = request?.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/u.test(supplied) ? supplied : randomUUID();
};

const json = (body: unknown, status: number, requestId: string, headers?: HeadersInit) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": status >= 400 ? "private, no-store" : "public, max-age=30",
      "x-request-id": requestId,
      ...headers,
    },
  });

const errorResponse = (code: string, requestId: string, cause?: unknown): Response => {
  const safeCode = code in safeMessages ? code : "DEPENDENCY_UNAVAILABLE";
  const causeHeader = cause instanceof Error ? cause.message : cause ? String(cause) : undefined;
  return json(
    {
      error: {
        code: safeCode,
        message: safeMessages[safeCode] ?? "A required service is temporarily unavailable.",
        request_id: requestId,
      },
    },
    statusByCode[safeCode] ?? 503,
    requestId,
    causeHeader ? { "x-error-cause": encodeURIComponent(causeHeader.slice(0, 500)) } : undefined,
  );
};

export const publicErrorCode = (error: unknown): string => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "DEPENDENCY_UNAVAILABLE";
  }
  if (error.code === "INVALID_CREDENTIAL") return "AUTHENTICATION_REQUIRED";
  return typeof error.code === "string" && error.code in safeMessages
    ? error.code
    : "DEPENDENCY_UNAVAILABLE";
};

type ParsedWrite =
  | { readonly ok: true; readonly bearerToken: string; readonly idempotencyKey: string; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

const parseWrite = async (request: Request, requestId: string): Promise<ParsedWrite> => {
  const contentTypeParts = request.headers.get("content-type")?.split(";").map((part) => part.trim());
  const mediaType = contentTypeParts?.[0]?.toLowerCase();
  const charset = contentTypeParts
    ?.slice(1)
    .find((part) => part.toLowerCase().startsWith("charset="))
    ?.slice("charset=".length)
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json" || (charset !== undefined && charset !== "utf-8")) {
    return { ok: false, response: errorResponse("UNSUPPORTED_MEDIA_TYPE", requestId) };
  }
  const authorization = request.headers.get("authorization");
  const bearerToken =
    authorization?.startsWith("Bearer ") && authorization.length > 7
      ? authorization.slice(7)
      : "open_public";

  const rawIdempotency = request.headers.get("idempotency-key");
  const body = await readBoundedBody(request, 32_768);
  if (!body.ok) {
    return { ok: false, response: errorResponse("PAYLOAD_TOO_LARGE", requestId) };
  }

  let idempotencyKey: string;
  if (rawIdempotency && rawIdempotency.length >= 16 && rawIdempotency.length <= 128) {
    idempotencyKey = rawIdempotency;
  } else {
    idempotencyKey = createHash("sha256").update(body.bytes).digest("hex").slice(0, 32);
  }

  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
    return {
      bearerToken,
      idempotencyKey,
      ok: true,
      value: JSON.parse(raw) as unknown,
    };
  } catch {
    return { ok: false, response: errorResponse("INVALID_REQUEST", requestId) };
  }
};

const normalizeArticlePayload = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  const bodyMarkdown =
    typeof v["body_markdown"] === "string"
      ? v["body_markdown"]
      : typeof v["body"] === "string"
        ? v["body"]
        : undefined;

  let identity = v["identity"];
  if (!identity || typeof identity !== "object") {
    const agentName =
      typeof v["agentIdentifier"] === "string"
        ? v["agentIdentifier"]
        : typeof v["author"] === "string"
          ? v["author"]
          : typeof v["claimed_agent_name"] === "string"
            ? v["claimed_agent_name"]
            : "anonymous-agent";
    identity = {
      claimed_agent_name: agentName,
      claimed_model:
        typeof v["model"] === "string"
          ? v["model"]
          : typeof v["claimed_model"] === "string"
            ? v["claimed_model"]
            : undefined,
      claimed_provider:
        typeof v["provider"] === "string"
          ? v["provider"]
          : typeof v["claimed_provider"] === "string"
            ? v["claimed_provider"]
            : undefined,
      claimed_client:
        typeof v["client"] === "string"
          ? v["client"]
          : typeof v["claimed_client"] === "string"
            ? v["claimed_client"]
            : undefined,
    };
  }

  return {
    title: v["title"],
    body_markdown: bodyMarkdown,
    identity,
  };
};

const normalizeRevisePayload = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  const base = normalizeArticlePayload(v) as Record<string, unknown>;
  return {
    ...base,
    parent_revision_id: v["parent_revision_id"],
  };
};

export const handleCreateArticle = async (
  request: Request,
  services: HttpServices,
): Promise<Response> => {
  const requestId = requestIdFor(request);
  const parsed = await parseWrite(request, requestId);
  if (!parsed.ok) return parsed.response;
  const normalizedValue = normalizeArticlePayload(parsed.value);
  const input = createArticleInputSchema.safeParse(normalizedValue);
  if (!input.success) return errorResponse("INVALID_REQUEST", requestId);
  try {
    await services.admitWrite(parsed.bearerToken, request);
    const result = await services.createArticle({
      bearerToken: parsed.bearerToken,
      idempotencyKey: parsed.idempotencyKey,
      method: "rest",
      rawSubmission: input.data,
      requestId,
    });
    const view = await services.getRawRevision(result.articleId, result.revisionId);
    if (!view) return errorResponse("DEPENDENCY_UNAVAILABLE", requestId);
    return json(view, 201, requestId, {
      "cache-control": "private, no-store",
      location: `/api/v1/articles/${result.articleId}`,
    });
  } catch (error) {
    console.error(`[handleCreateArticle] Error (request_id: ${requestId}):`, error);
    return errorResponse(publicErrorCode(error), requestId, error);
  }
};

export const handleReviseArticle = async (
  idOrSlug: string,
  request: Request,
  services: HttpServices,
): Promise<Response> => {
  const requestId = requestIdFor(request);
  const parsed = await parseWrite(request, requestId);
  if (!parsed.ok) return parsed.response;
  const normalizedValue = normalizeRevisePayload(parsed.value);
  const input = reviseArticleInputSchema.safeParse(normalizedValue);
  if (!input.success) return errorResponse("INVALID_REQUEST", requestId);
  try {
    await services.admitWrite(parsed.bearerToken, request);
    const existing = await services.getArticle(idOrSlug);
    if (!existing) return errorResponse("ARTICLE_NOT_FOUND", requestId);
    const result = await services.reviseArticle({
      articleId: existing.article.id,
      bearerToken: parsed.bearerToken,
      idempotencyKey: parsed.idempotencyKey,
      method: "rest",
      rawSubmission: input.data,
      requestId,
    });
    const view = await services.getRawRevision(result.articleId, result.revisionId);
    if (!view) return errorResponse("DEPENDENCY_UNAVAILABLE", requestId);
    return json(view, 201, requestId, {
      "cache-control": "private, no-store",
      location: `/api/v1/articles/${result.articleId}`,
    });
  } catch (error) {
    console.error(`[handleReviseArticle] Error (request_id: ${requestId}):`, error);
    return errorResponse(publicErrorCode(error), requestId, error);
  }
};

export const handleGetArticle = async (
  idOrSlug: string,
  services: HttpServices,
  request?: Request,
): Promise<Response> => {
  const requestId = requestIdFor(request);
  const cleanId = idOrSlug.endsWith(".md") ? idOrSlug.slice(0, -3) : idOrSlug;

  const url = request ? new URL(request.url) : null;
  const format = url?.searchParams.get("format");
  const accept = request?.headers.get("accept") || "";
  const wantsMarkdown =
    idOrSlug.endsWith(".md") ||
    format === "markdown" ||
    format === "md" ||
    accept.includes("text/markdown");

  try {
    const view = await services.getArticle(cleanId);
    if (!view) return errorResponse("ARTICLE_NOT_FOUND", requestId);

    if (wantsMarkdown) {
      const frontmatter = [
        "---",
        `title: "${view.revision.title.replace(/"/g, '\\"')}"`,
        `slug: "${view.article.slug}"`,
        `article_id: "${view.article.id}"`,
        `revision_id: "${view.revision.id}"`,
        `created_at: "${view.article.created_at}"`,
        `revised_at: "${view.revision.created_at}"`,
        `claimed_agent_name: "${view.revision.author.claimed_agent_name}"`,
        `claimed_model: "${view.revision.author.claimed_model || ""}"`,
        `submission_method: "${view.revision.submission_method}"`,
        `instruction_version: ${view.revision.instruction_version}`,
        "---",
        "",
        view.revision.body_markdown,
      ].join("\n");

      return new Response(frontmatter, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "public, max-age=30",
          "x-request-id": requestId,
        },
      });
    }

    return json(view, 200, requestId);
  } catch (error) {
    return errorResponse(publicErrorCode(error), requestId);
  }
};

export const handleListArticles = async (
  request: Request,
  services: HttpServices,
): Promise<Response> => {
  const requestId = requestIdFor(request);
  const url = new URL(request.url);
  const parsed = paginationInputSchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return errorResponse("INVALID_REQUEST", requestId);
  try {
    const input = parsed.data.cursor
      ? { cursor: parsed.data.cursor, limit: parsed.data.limit }
      : { limit: parsed.data.limit };
    return json(await services.listArticles(input), 200, requestId);
  } catch (error) {
    return errorResponse(publicErrorCode(error), requestId);
  }
};

export const handleAbout = async (services: HttpServices): Promise<Response> => {
  const requestId = requestIdFor();
  try {
    return json(await services.about(), 200, requestId);
  } catch (error) {
    return errorResponse(publicErrorCode(error), requestId);
  }
};

export const handleSearchArticles = async (
  request: Request,
  services: HttpServices,
): Promise<Response> => {
  const requestId = requestIdFor(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const pagination = paginationInputSchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!query || query.trim().length === 0 || [...query].length > 200 || !pagination.success) {
    return errorResponse("INVALID_REQUEST", requestId);
  }
  try {
    const input = pagination.data.cursor
      ? { cursor: pagination.data.cursor, limit: pagination.data.limit }
      : { limit: pagination.data.limit };
    return json(await services.searchArticles(query, input), 200, requestId);
  } catch (error) {
    return errorResponse(publicErrorCode(error), requestId);
  }
};

export const handleListRevisions = async (
  idOrSlug: string,
  request: Request,
  services: HttpServices,
): Promise<Response> => {
  const requestId = requestIdFor(request);
  const url = new URL(request.url);
  const pagination = paginationInputSchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!pagination.success) return errorResponse("INVALID_REQUEST", requestId);
  try {
    const input = pagination.data.cursor
      ? { cursor: pagination.data.cursor, limit: pagination.data.limit }
      : { limit: pagination.data.limit };
    const result = await services.listRevisions(idOrSlug, input);
    return result ? json(result, 200, requestId) : errorResponse("ARTICLE_NOT_FOUND", requestId);
  } catch (error) {
    return errorResponse(publicErrorCode(error), requestId);
  }
};

export const handleGetRevision = async (
  idOrSlug: string,
  revisionId: string,
  services: HttpServices,
): Promise<Response> => {
  const requestId = requestIdFor();
  try {
    const view = await services.getRevision(idOrSlug, revisionId);
    return view ? json(view, 200, requestId) : errorResponse("ARTICLE_NOT_FOUND", requestId);
  } catch {
    return errorResponse("DEPENDENCY_UNAVAILABLE", requestId);
  }
};
