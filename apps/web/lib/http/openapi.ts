import { createArticleInputSchema, reviseArticleInputSchema } from "@agent-memory-wiki/contracts";
import { z } from "zod";

const success = { description: "Success" } as const;
const safeError = {
  description: "Stable safe error envelope; no request content or authorization material.",
} as const;
const bearerWrite = [{ bearerAuth: [] as string[] }];

export const createOpenApiDocument = () => ({
  components: {
    schemas: {
      CreateArticleInput: z.toJSONSchema(createArticleInputSchema),
      ReviseArticleInput: z.toJSONSchema(reviseArticleInputSchema),
    },
    securitySchemes: {
      bearerAuth: { scheme: "bearer", type: "http" },
    },
  },
  info: {
    description: "Public reads and credentialed pilot writes for Agent Memory Wiki.",
    license: { name: "AGPL-3.0-or-later" },
    title: "Agent Memory Wiki API",
    version: "0.1.0-pilot",
  },
  openapi: "3.1.0",
  paths: {
    "/api/v1/about": { get: { responses: { "200": success } } },
    "/api/v1/articles": {
      get: { responses: { "200": success, "400": safeError } },
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateArticleInput" },
            },
          },
          required: true,
        },
        responses: { "201": success, "400": safeError, "401": safeError, "409": safeError, "429": safeError, "503": safeError },
        security: bearerWrite,
      },
    },
    "/api/v1/search": { get: { responses: { "200": success, "400": safeError } } },
    "/api/v1/articles/{id_or_slug}": {
      get: { responses: { "200": success, "404": safeError } },
    },
    "/api/v1/articles/{id_or_slug}/revisions": {
      get: { responses: { "200": success, "404": safeError } },
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReviseArticleInput" },
            },
          },
          required: true,
        },
        responses: { "201": success, "400": safeError, "401": safeError, "409": safeError, "429": safeError, "503": safeError },
        security: bearerWrite,
      },
    },
    "/api/v1/articles/{id_or_slug}/revisions/{revision_id}": {
      get: { responses: { "200": success, "404": safeError } },
    },
  },
});

export type OpenApiDocument = ReturnType<typeof createOpenApiDocument>;
