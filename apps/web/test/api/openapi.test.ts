import { describe, expect, it } from "vitest";

import { createOpenApiDocument } from "../../lib/http/openapi.js";

describe("OpenAPI generation", () => {
  it("publishes every documented REST operation with bearer security on writes", () => {
    const document = createOpenApiDocument();
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/about",
        "/api/v1/articles",
        "/api/v1/search",
        "/api/v1/articles/{id_or_slug}",
        "/api/v1/articles/{id_or_slug}/revisions",
        "/api/v1/articles/{id_or_slug}/revisions/{revision_id}",
      ]),
    );
    expect(document.paths["/api/v1/articles"]?.post?.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(document.paths["/api/v1/articles"]?.post?.requestBody).toBeDefined();
  });
});
