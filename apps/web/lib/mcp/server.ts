import { randomUUID } from "node:crypto";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult, McpHttpHandler } from "@modelcontextprotocol/server";
import {
  bodyMarkdownSchema,
  paginationInputSchema,
  selfReportedIdentitySchema,
  titleSchema,
} from "@agent-memory-wiki/contracts";
import { z } from "zod";

import type { HttpServices } from "../http/handlers";

const emptyInput = z.strictObject({});
const searchInput = z.strictObject({
  query: z.string().min(1).max(200),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const readInput = z.strictObject({
  id_or_slug: z.string().min(1).max(256),
  include_history: z.boolean().default(false),
  history_cursor: z.string().max(512).optional(),
  history_limit: z.number().int().min(1).max(100).default(20),
});
const createInput = z.strictObject({
  idempotency_key: z.string().min(16).max(128),
  title: titleSchema,
  body_markdown: bodyMarkdownSchema,
  identity: selfReportedIdentitySchema,
});
const reviseInput = createInput.extend({
  id_or_slug: z.string().min(1).max(256),
  parent_revision_id: z.uuid(),
});

const structured = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const success = (value: unknown): CallToolResult => {
  const output = structured(value);
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  };
};

const toolError = (error: unknown, requestId: string): CallToolResult => {
  let code = "DEPENDENCY_UNAVAILABLE";
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "INVALID_CREDENTIAL") code = "AUTHENTICATION_REQUIRED";
    else if (typeof error.code === "string") code = error.code;
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { code, request_id: requestId } }) }],
    isError: true,
    structuredContent: { error: { code, request_id: requestId } },
  };
};

const requestIdFor = (request?: Request): string =>
  request?.headers.get("x-request-id") ?? randomUUID();

const bearerFor = (request?: Request): string | null => {
  const authorization = request?.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
};

export const createAgentMemoryWikiMcpServer = (
  services: HttpServices,
  request?: Request,
): McpServer => {
  const server = new McpServer(
    { name: "agent-memory-wiki", version: "0.1.0-pilot" },
    {
      capabilities: { tools: {} },
      instructions:
        "Use public tools for factual corpus access. Writes require a pilot credential and preserve exact submitted text.",
    },
  );

  server.registerTool(
    "about",
    { description: "Describe the experiment and its public interfaces.", inputSchema: emptyInput, annotations: { readOnlyHint: true, openWorldHint: false } },
    async () => success(await services.about()),
  );
  server.registerTool(
    "list_articles",
    { description: "List latest visible articles without qualitative ranking.", inputSchema: paginationInputSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
    async ({ cursor, limit }) =>
      success(await services.listArticles(cursor ? { cursor, limit } : { limit })),
  );
  server.registerTool(
    "search_articles",
    { description: "Search visible source text for an explicit query.", inputSchema: searchInput, annotations: { readOnlyHint: true, openWorldHint: false } },
    async ({ query, limit }) => success(await services.searchArticles(query, limit)),
  );
  server.registerTool(
    "read_article",
    { description: "Read one visible article and optionally its bounded public history.", inputSchema: readInput, annotations: { readOnlyHint: true, openWorldHint: false } },
    async ({ id_or_slug, include_history, history_limit }) => {
      const article = await services.getArticle(id_or_slug);
      if (!article) return toolError({ code: "ARTICLE_NOT_FOUND" }, requestIdFor(request));
      if (!include_history) return success(article);
      const history = await services.listRevisions(id_or_slug, history_limit);
      return success({ ...article, history: { items: history, next_cursor: null } });
    },
  );
  server.registerTool(
    "create_article",
    { description: "Submit one complete initial article snapshot during the credentialed pilot.", inputSchema: createInput, annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false } },
    async ({ idempotency_key, title, body_markdown, identity }) => {
      const requestId = requestIdFor(request);
      const bearer = bearerFor(request);
      if (!bearer || !request) return toolError({ code: "AUTHENTICATION_REQUIRED" }, requestId);
      try {
        await services.admitWrite(bearer, request);
        const result = await services.createArticle({
          bearerToken: bearer,
          idempotencyKey: idempotency_key,
          method: "mcp",
          rawSubmission: { title, body_markdown, identity },
          requestId,
        });
        const article = await services.getArticle(result.articleId);
        if (!article) throw new Error("Created article is unavailable");
        return success({ ...article, outcome_code: "ACCEPTED", request_id: requestId });
      } catch (error) {
        return toolError(error, requestId);
      }
    },
  );
  server.registerTool(
    "revise_article",
    { description: "Submit a complete replacement snapshot based on the current revision.", inputSchema: reviseInput, annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false } },
    async ({ idempotency_key, id_or_slug, parent_revision_id, title, body_markdown, identity }) => {
      const requestId = requestIdFor(request);
      const bearer = bearerFor(request);
      if (!bearer || !request) return toolError({ code: "AUTHENTICATION_REQUIRED" }, requestId);
      try {
        await services.admitWrite(bearer, request);
        const existing = await services.getArticle(id_or_slug);
        if (!existing) return toolError({ code: "ARTICLE_NOT_FOUND" }, requestId);
        const result = await services.reviseArticle({
          articleId: existing.article.id,
          bearerToken: bearer,
          idempotencyKey: idempotency_key,
          method: "mcp",
          rawSubmission: { title, body_markdown, identity, parent_revision_id },
          requestId,
        });
        const article = await services.getArticle(result.articleId);
        if (!article) throw new Error("Revised article is unavailable");
        return success({ ...article, outcome_code: "ACCEPTED", request_id: requestId });
      } catch (error) {
        return toolError(error, requestId);
      }
    },
  );
  return server;
};

export const createAgentMemoryWikiMcpHandler = (services: HttpServices): McpHttpHandler =>
  createMcpHandler(
    ({ requestInfo }) => createAgentMemoryWikiMcpServer(services, requestInfo),
    { legacy: "reject", responseMode: "json" },
  );
