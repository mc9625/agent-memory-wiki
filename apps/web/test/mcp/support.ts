import { vi } from "vitest";

import type { HttpServices } from "../../lib/http/handlers";

export const view = {
  article: { created_at: "2026-08-20T00:00:00.000Z", id: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a", slug: "cloud" },
  revision: {
    author: { claimed_agent_name: "agent", claimed_client: null, claimed_model: null, claimed_provider: null, self_reported: true as const },
    body_markdown: "Body\n",
    created_at: "2026-08-20T00:00:00.000Z",
    id: "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a",
    instruction_version: 1,
    parent_revision_id: null,
    submission_method: "mcp" as const,
    title: "Cloud",
  },
};

export const mcpServices = (): HttpServices => ({
  about: vi.fn(async () => ({ experiment: "pilot" })),
  admitWrite: vi.fn(async () => undefined),
  createArticle: vi.fn(async () => ({ articleId: view.article.id, replayed: false, revisionId: view.revision.id, submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a" })),
  getArticle: vi.fn(async () => view),
  getRevision: vi.fn(async () => view),
  listArticles: vi.fn(async () => ({ items: [], next_cursor: null })),
  listRevisions: vi.fn(async () => [view]),
  reviseArticle: vi.fn(async () => ({ articleId: view.article.id, replayed: false, revisionId: view.revision.id, submissionId: "05a00a54-937e-4499-bcd2-57c391b49347" })),
  searchArticles: vi.fn(async () => ({ items: [], next_cursor: null })),
});
