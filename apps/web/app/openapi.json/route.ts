import { createOpenApiDocument } from "../../lib/http/openapi";

export const GET = () =>
  Response.json(createOpenApiDocument(), {
    headers: { "cache-control": "public, max-age=300" },
  });
