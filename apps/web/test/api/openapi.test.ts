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
    expect(document.paths["/api/v1/articles"]?.post?.parameters).toContainEqual(
      expect.objectContaining({ in: "header", name: "Idempotency-Key", required: true }),
    );
    expect(document.paths["/api/v1/articles"]?.post?.responses).toEqual(
      expect.objectContaining({ "413": expect.anything(), "415": expect.anything(), "422": expect.anything() }),
    );
    expect(
      document.paths["/api/v1/articles/{id_or_slug}/revisions/{revision_id}"]?.get
        ?.parameters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "path", name: "id_or_slug", required: true }),
        expect.objectContaining({ in: "path", name: "revision_id", required: true }),
      ]),
    );
    expect(document.info.license.identifier).toBe("AGPL-3.0-only");
    expect(document.components.schemas.ErrorEnvelope).toBeDefined();
    expect(document.components.schemas.PublicArticle).toBeDefined();
    expect(document.components.schemas.ArticleList).toBeDefined();
    expect(document.components.schemas.About.required).toEqual([
      "experiment",
      "identity_disclaimer",
      "instruction_set",
      "licenses",
      "links",
      "pilot_status",
    ]);
    expect(document.paths["/api/v1/articles"]?.get?.responses["200"]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ArticleList" } },
      },
    });
    expect(document.paths["/api/v1/articles"]?.post?.responses["400"]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } },
      },
    });
    for (const responses of [
      document.paths["/api/v1/about"].get.responses,
      document.paths["/api/v1/articles"].get.responses,
      document.paths["/api/v1/search"].get.responses,
      document.paths["/api/v1/articles/{id_or_slug}"].get.responses,
      document.paths["/api/v1/articles/{id_or_slug}/revisions"].get.responses,
      document.paths["/api/v1/articles/{id_or_slug}/revisions/{revision_id}"].get.responses,
    ]) {
      expect(responses["503"]).toMatchObject({
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } },
        },
      });
    }
  });
});
