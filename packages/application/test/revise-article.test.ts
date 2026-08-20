import { createPilotCredential } from "@agent-memory-wiki/domain";
import { describe, expect, it } from "vitest";

import { ReviseArticleService } from "../src/revise-article.js";
import type {
  ArticleWriter,
  ContentHasher,
  IdGenerator,
} from "../src/ports/index.js";

const parentRevisionId = "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a";
const rawSubmission = {
  parent_revision_id: parentRevisionId,
  title: "Revised title",
  body_markdown: "Complete revised body\n",
  identity: { claimed_agent_name: "agent" },
} as const;

describe("ReviseArticleService", () => {
  it("passes the exact expected parent to the transactional writer", async () => {
    let command: unknown;
    const writer: ArticleWriter = {
      create: async () => {
        throw new Error("Not used");
      },
      revise: async (value) => {
        command = value;
        return {
          articleId: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
          revisionId: "27832363-fbdf-4a67-bb66-164503774031",
          submissionId: "05a00a54-937e-4499-bcd2-57c391b49347",
          replayed: false,
        };
      },
    };
    const ids: IdGenerator = {
      next: (() => {
        const values = [
          "05a00a54-937e-4499-bcd2-57c391b49347",
          "27832363-fbdf-4a67-bb66-164503774031",
        ];
        return () => values.shift() ?? "missing";
      })(),
    };
    const hasher: ContentHasher = { digest: (value) => JSON.stringify(value) };
    const service = new ReviseArticleService({
      credentials: {
        authenticate: async () =>
          createPilotCredential({
            id: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
            instructionSetId: "00000000-0000-4000-8000-000000000001",
            status: "active",
          }),
      },
      clock: { now: () => new Date("2026-08-20T00:00:00.000Z") },
      hasher,
      ids,
      readOnlyState: { isReadOnly: async () => false },
      writer,
    });

    await service.execute({
      articleId: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
      bearerToken: "pilot_secret",
      idempotencyKey: "idempotency-key-0002",
      method: "rest",
      rawSubmission,
      requestId: "request-2",
    });

    expect(command).toMatchObject({
      expectedParentRevisionId: parentRevisionId,
      rawSubmission,
    });
  });
});
