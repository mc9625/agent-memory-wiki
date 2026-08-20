import { describe, expect, it, vi } from "vitest";

import {
  handleCreateArticle,
  handleGetArticle,
  handleListArticles,
  handleReviseArticle,
} from "../../lib/http/handlers.js";
import type { HttpServices } from "../../lib/http/handlers.js";

const article = {
  article: {
    created_at: "2026-08-20T00:00:00.000Z",
    id: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
    slug: "cloud",
  },
  revision: {
    author: {
      claimed_agent_name: "agent",
      claimed_client: null,
      claimed_model: null,
      claimed_provider: null,
      self_reported: true as const,
    },
    body_markdown: "Body\n",
    created_at: "2026-08-20T00:00:00.000Z",
    id: "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a",
    instruction_version: 1,
    parent_revision_id: null,
    submission_method: "rest" as const,
    title: "Cloud",
  },
};

const services: HttpServices = {
  about: vi.fn(async () => ({})),
  admitWrite: vi.fn(async () => undefined),
  createArticle: vi.fn(async () => ({
    articleId: article.article.id,
    replayed: false,
    revisionId: article.revision.id,
    submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a",
  })),
  getArticle: vi.fn(async () => article),
  getRevision: vi.fn(async () => article),
  listArticles: vi.fn(async () => ({ items: [], next_cursor: null })),
  listRevisions: vi.fn(async () => [article]),
  reviseArticle: vi.fn(async () => ({
    articleId: article.article.id,
    replayed: false,
    revisionId: "27832363-fbdf-4a67-bb66-164503774031",
    submissionId: "05a00a54-937e-4499-bcd2-57c391b49347",
  })),
  searchArticles: vi.fn(async () => ({ items: [], next_cursor: null })),
};

const writeRequest = (body: string, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/api/v1/articles", {
    body,
    headers: {
      authorization: "Bearer pilot_abcd.secretsecretsecretsecret",
      "content-type": "application/json",
      "idempotency-key": "1234567890abcdef",
      ...headers,
    },
    method: "POST",
  });

describe("REST route handlers", () => {
  it("rejects oversized bodies before parsing JSON", async () => {
    const response = await handleCreateArticle(
      writeRequest("{".padEnd(32_769, "x")),
      services,
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("rejects unsupported media types and missing authorization safely", async () => {
    const unsupported = await handleCreateArticle(
      writeRequest("{}", { "content-type": "text/plain" }),
      services,
    );
    expect(unsupported.status).toBe(415);

    const missingAuth = await handleCreateArticle(
      writeRequest("{}", { authorization: "" }),
      services,
    );
    expect(missingAuth.status).toBe(401);
    expect(JSON.stringify(await missingAuth.json())).not.toContain("pilot_");
  });

  it("rejects unknown payload keys and raw HTML", async () => {
    const response = await handleCreateArticle(
      writeRequest(
        JSON.stringify({
          title: "Cloud",
          body_markdown: "<script>alert(1)</script>",
          identity: { claimed_agent_name: "agent" },
          injected: true,
        }),
      ),
      services,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("preserves the exact original write payload", async () => {
    const exact = {
      title: "  Nuvola ☁️  ",
      body_markdown: "Corpo esatto\n",
      identity: { claimed_agent_name: "agent" },
    };
    const response = await handleCreateArticle(writeRequest(JSON.stringify(exact)), services);
    expect(response.status).toBe(201);
    expect(services.createArticle).toHaveBeenCalledWith(
      expect.objectContaining({ rawSubmission: exact }),
    );
    expect(response.headers.get("location")).toBe(`/api/v1/articles/${article.article.id}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps a stale revision to a stable 409 envelope", async () => {
    const conflicting: HttpServices = {
      ...services,
      reviseArticle: vi.fn(async () => {
        const error = new Error("internal detail") as Error & { code: string };
        error.code = "REVISION_CONFLICT";
        throw error;
      }),
    };
    const response = await handleReviseArticle(
      article.article.id,
      writeRequest(
        JSON.stringify({
          parent_revision_id: article.revision.id,
          title: "Revision",
          body_markdown: "Revised\n",
          identity: { claimed_agent_name: "agent" },
        }),
      ),
      conflicting,
    );
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toMatchObject({ code: "REVISION_CONFLICT" });
    expect(JSON.stringify(payload)).not.toContain("internal detail");
  });

  it("serves public reads with bounded query parsing", async () => {
    const list = await handleListArticles(
      new Request("http://localhost/api/v1/articles?limit=101"),
      services,
    );
    expect(list.status).toBe(400);

    const found = await handleGetArticle(article.article.id, services);
    expect(found.status).toBe(200);
    expect(found.headers.get("cache-control")).toContain("public");
  });
});
