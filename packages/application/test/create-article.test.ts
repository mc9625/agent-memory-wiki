import { createPilotCredential } from "@agent-memory-wiki/domain";
import { describe, expect, it } from "vitest";

import { CreateArticleService } from "../src/create-article.js";
import { ReadOnlyError } from "../src/errors.js";
import type {
  ArticleWriter,
  AuthenticatedCredential,
  Clock,
  ContentHasher,
  IdGenerator,
  ReadOnlyState,
} from "../src/ports/index.js";

const credential = createPilotCredential({
  id: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
  instructionSetId: "00000000-0000-4000-8000-000000000001",
  status: "active",
});

const rawSubmission = {
  title: "  Exact title  ",
  body_markdown: "Exact Markdown\n",
  identity: { claimed_agent_name: "agent" },
} as const;

const result = {
  articleId: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
  revisionId: "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a",
  submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a",
  replayed: false,
} as const;

class FixedIds implements IdGenerator {
  readonly #ids = [result.submissionId, result.articleId, result.revisionId];

  next(): string {
    const id = this.#ids.shift();
    if (!id) throw new Error("No fixed id remaining");
    return id;
  }
}

class RecordingHasher implements ContentHasher {
  readonly values: unknown[] = [];

  digest(value: unknown): string {
    this.values.push(value);
    return `digest-${this.values.length}`;
  }
}

class RecordingWriter implements ArticleWriter {
  command: unknown;

  async create(command: unknown): Promise<typeof result> {
    this.command = command;
    return result;
  }

  async revise(): Promise<never> {
    throw new Error("Not used");
  }
}

const activeCredential: AuthenticatedCredential = {
  authenticate: async () => credential,
};

const writable: ReadOnlyState = {
  isReadOnly: async () => false,
};

const clock: Clock = {
  now: () => new Date("2026-08-20T00:00:00.000Z"),
};

describe("CreateArticleService", () => {
  it("binds exact input to the authenticated credential instruction", async () => {
    const writer = new RecordingWriter();
    const hasher = new RecordingHasher();
    const service = new CreateArticleService({
      credentials: activeCredential,
      clock,
      hasher,
      ids: new FixedIds(),
      readOnlyState: writable,
      writer,
    });

    await service.execute({
      bearerToken: "pilot_secret",
      idempotencyKey: "idempotency-key-0001",
      method: "mcp",
      rawSubmission,
      requestId: "request-1",
    });

    expect(writer.command).toMatchObject({
      credentialId: credential.id,
      instructionSetId: credential.instructionSetId,
      method: "mcp",
      rawSubmission,
      requestId: "request-1",
      title: rawSubmission.title,
      bodyMarkdown: rawSubmission.body_markdown,
    });
    expect(hasher.values).toContainEqual([
      rawSubmission.title,
      rawSubmission.body_markdown,
    ]);
  });

  it("rejects writes before persistence when global read-only is active", async () => {
    const writer = new RecordingWriter();
    const service = new CreateArticleService({
      credentials: activeCredential,
      clock,
      hasher: new RecordingHasher(),
      ids: new FixedIds(),
      readOnlyState: { isReadOnly: async () => true },
      writer,
    });

    await expect(
      service.execute({
        bearerToken: "pilot_secret",
        idempotencyKey: "idempotency-key-0001",
        method: "rest",
        rawSubmission,
        requestId: "request-1",
      }),
    ).rejects.toBeInstanceOf(ReadOnlyError);
    expect(writer.command).toBeUndefined();
  });

  it("requires a nonblank idempotency key", async () => {
    const service = new CreateArticleService({
      credentials: activeCredential,
      clock,
      hasher: new RecordingHasher(),
      ids: new FixedIds(),
      readOnlyState: writable,
      writer: new RecordingWriter(),
    });

    await expect(
      service.execute({
        bearerToken: "pilot_secret",
        idempotencyKey: " ",
        method: "rest",
        rawSubmission,
        requestId: "request-1",
      }),
    ).rejects.toThrow("idempotency");
  });
});
