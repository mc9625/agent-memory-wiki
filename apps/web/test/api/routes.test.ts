import { describe, expect, it, vi } from "vitest";

import {
  handleCreateArticle,
  handleGetArticle,
  handleListArticles,
  handleListRevisions,
  handleRecordEvent,
  handleReviseArticle,
  handleSearchArticles,
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
  getRawRevision: vi.fn(async () => article),
  listArticles: vi.fn(async () => ({ items: [], next_cursor: null })),
  listRevisions: vi.fn(async () => ({ items: [article], next_cursor: null })),
  reviseArticle: vi.fn(async () => ({
    articleId: article.article.id,
    replayed: false,
    revisionId: "27832363-fbdf-4a67-bb66-164503774031",
    submissionId: "05a00a54-937e-4499-bcd2-57c391b49347",
  })),
  searchArticles: vi.fn(async () => ({ items: [], next_cursor: null })),
  recordEvent: vi.fn(async () => undefined),
  listEvents: vi.fn(async () => ({ items: [] })),
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

const eventBody = JSON.stringify({
  sessionId: "session-1",
  eventType: "article_opened",
  agentIdentifier: "Claude",
});

describe("telemetry writes", () => {
  it("passes POST /events through the same write gate as a submission", async () => {
    const admitWrite = vi.fn(async () => undefined);
    const recordEvent = vi.fn(async () => undefined);
    const response = await handleRecordEvent(writeRequest(eventBody), {
      ...services,
      admitWrite,
      recordEvent,
    });

    expect(response.status).toBe(200);
    expect(admitWrite).toHaveBeenCalledOnce();
    expect(recordEvent).toHaveBeenCalledOnce();
  });

  it("stays open to anonymous callers, under the open_public credential", async () => {
    const admitWrite = vi.fn(async () => undefined);
    const request = new Request("http://localhost/api/v1/events", {
      body: eventBody,
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const response = await handleRecordEvent(request, { ...services, admitWrite });

    expect(response.status).toBe(200);
    expect(admitWrite).toHaveBeenCalledWith("open_public", request);
  });

  it("does not record the event when the write gate refuses", async () => {
    const recordEvent = vi.fn(async () => undefined);
    const response = await handleRecordEvent(writeRequest(eventBody), {
      ...services,
      admitWrite: vi.fn(async () => {
        throw Object.assign(new Error("limited"), { code: "RATE_LIMITED" });
      }),
      recordEvent,
    });

    expect(response.status).toBe(429);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("rejects an oversized telemetry body before parsing it", async () => {
    const response = await handleRecordEvent(
      writeRequest("{".padEnd(32_769, "x")),
      services,
    );
    expect(response.status).toBe(413);
  });
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

  it("stops reading a chunked body as soon as the byte limit is crossed", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        canceled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(20_000));
        controller.enqueue(new Uint8Array(20_000));
        controller.enqueue(new Uint8Array(20_000));
      },
    });
    const request = new Request("http://localhost/api/v1/articles", {
      body: stream,
      headers: {
        authorization: "Bearer pilot_abcd.secretsecretsecretsecret",
        "content-type": "application/json",
        "idempotency-key": "1234567890abcdef",
      },
      method: "POST",
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await handleCreateArticle(request, services);
    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
  });

  it("rejects unsupported media types safely", async () => {
    const unsupported = await handleCreateArticle(
      writeRequest("{}", { "content-type": "text/plain" }),
      services,
    );
    expect(unsupported.status).toBe(415);

    const wrongCharset = await handleCreateArticle(
      writeRequest("{}", { "content-type": "application/json; charset=iso-8859-1" }),
      services,
    );
    expect(wrongCharset.status).toBe(415);
  });

  it("rejects malformed UTF-8 instead of persisting replacement characters", async () => {
    const response = await handleCreateArticle(
      new Request("http://localhost/api/v1/articles", {
        body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
        headers: {
          authorization: "Bearer pilot_abcd.secretsecretsecretsecret",
          "content-type": "application/json; charset=utf-8",
          "idempotency-key": "1234567890abcdef",
        },
        method: "POST",
      }),
      services,
    );
    expect(response.status).toBe(400);
    expect(services.createArticle).not.toHaveBeenCalledWith(
      expect.objectContaining({ rawSubmission: expect.stringContaining("�") }),
    );
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

  it("names the field and the rule a rejected submission broke", async () => {
    const response = await handleCreateArticle(
      writeRequest(
        JSON.stringify({
          title: "Cloud",
          body: "A body carrying <b>raw HTML</b>.",
          agentIdentifier: "   ",
        }),
      ),
      services,
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error: { details?: { field: string; message: string }[] };
    };
    // Reported against the normalized field names, which are the ones the
    // archive and `/openapi.json` use, not the shorthand that was posted.
    expect(payload.error.details).toEqual(
      expect.arrayContaining([
        { field: "body_markdown", message: "Raw HTML is not accepted in the pilot" },
        { field: "identity.claimed_agent_name", message: "Must not be blank" },
      ]),
    );
  });

  it("says which part of an unparseable body failed", async () => {
    const response = await handleCreateArticle(writeRequest("{\"title\": "), services);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error: { details?: { field: string; message: string }[] };
    };
    expect(payload.error.details?.[0]?.field).toBe("(body)");
    expect(payload.error.details?.[0]?.message).toMatch(/not valid JSON/);
  });

  it("rejects database-unsafe string characters at the REST boundary", async () => {
    const response = await handleCreateArticle(
      writeRequest(JSON.stringify({
        title: "Unsafe\0title",
        body_markdown: "Body",
        identity: { claimed_agent_name: "agent" },
      })),
      services,
    );
    expect(response.status).toBe(400);
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
    expect(services.getRawRevision).toHaveBeenCalledWith(article.article.id, article.revision.id);
  });

  it("returns the original revision when an idempotent write is replayed after the article advances", async () => {
    const original = { ...article, revision: { ...article.revision, title: "Original response" } };
    const advanced = { ...article, revision: { ...article.revision, id: "27832363-fbdf-4a67-bb66-164503774031", title: "Later revision" } };
    const replay: HttpServices = {
      ...services,
      createArticle: vi.fn(async () => ({
        articleId: article.article.id,
        replayed: true,
        revisionId: article.revision.id,
        submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a",
      })),
      getArticle: vi.fn(async () => advanced),
      getRevision: vi.fn(async () => original),
      getRawRevision: vi.fn(async () => original),
    };

    const response = await handleCreateArticle(
      writeRequest(JSON.stringify({
        title: "Cloud",
        body_markdown: "Body\n",
        identity: { claimed_agent_name: "agent" },
      })),
      replay,
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ revision: { title: "Original response" } });
    expect(replay.getArticle).not.toHaveBeenCalled();
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

  it("forwards opaque cursors for search and revision history", async () => {
    const cursor = "YWJj";
    const searched = await handleSearchArticles(
      new Request(`http://localhost/api/v1/search?q=cloud&limit=7&cursor=${cursor}`),
      services,
    );
    expect(searched.status).toBe(200);
    expect(services.searchArticles).toHaveBeenLastCalledWith("cloud", { cursor, limit: 7 });

    const history = await handleListRevisions(
      article.article.id,
      new Request(
        `http://localhost/api/v1/articles/${article.article.id}/revisions?limit=3&cursor=${cursor}`,
      ),
      services,
    );
    expect(history.status).toBe(200);
    expect(services.listRevisions).toHaveBeenLastCalledWith(article.article.id, {
      cursor,
      limit: 3,
    });
  });

  it("preserves stable cursor errors instead of converting them to a dependency failure", async () => {
    const invalidCursor: HttpServices = {
      ...services,
      listArticles: vi.fn(async () => {
        const error = new Error("decoded cursor detail") as Error & { code: string };
        error.code = "INVALID_REQUEST";
        throw error;
      }),
      searchArticles: vi.fn(async () => {
        const error = new Error("decoded search cursor detail") as Error & { code: string };
        error.code = "INVALID_REQUEST";
        throw error;
      }),
    };

    const response = await handleListArticles(
      new Request("http://localhost/api/v1/articles?cursor=not-a-cursor"),
      invalidCursor,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });

    const searchResponse = await handleSearchArticles(
      new Request("http://localhost/api/v1/search?q=cloud&cursor=not-a-cursor"),
      invalidCursor,
    );
    expect(searchResponse.status).toBe(400);
    expect(await searchResponse.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("returns an empty terminal history page and reserves 404 for a missing article", async () => {
    const terminal: HttpServices = {
      ...services,
      listRevisions: vi.fn(async () => ({ items: [], next_cursor: null })),
    };
    const terminalResponse = await handleListRevisions(
      article.article.id,
      new Request(
        `http://localhost/api/v1/articles/${article.article.id}/revisions?cursor=terminal`,
      ),
      terminal,
    );
    expect(terminalResponse.status).toBe(200);
    await expect(terminalResponse.json()).resolves.toEqual({ items: [], next_cursor: null });

    const missing: HttpServices = {
      ...services,
      listRevisions: vi.fn(async () => null),
    };
    const missingResponse = await handleListRevisions(
      "missing",
      new Request("http://localhost/api/v1/articles/missing/revisions"),
      missing,
    );
    expect(missingResponse.status).toBe(404);
  });

  it("normalizes flexible payload aliases like body and agentIdentifier for AI agents", async () => {
    const response = await handleCreateArticle(
      writeRequest(
        JSON.stringify({
          title: "Synthesized Concept",
          slug: "synthesized-concept",
          body: "A concept body with [[Wikilink]]",
          intent: "Leave behind an autonomous trace",
          confidence: "high",
          agentIdentifier: "gemini-2.5-pro",
        }),
      ),
      services,
    );
    expect(response.status).toBe(201);
    expect(services.createArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        rawSubmission: {
          title: "Synthesized Concept",
          body_markdown: "A concept body with [[Wikilink]]",
          identity: {
            claimed_agent_name: "gemini-2.5-pro",
            claimed_client: undefined,
            claimed_model: undefined,
            claimed_provider: undefined,
          },
        },
      }),
    );
  });
});
