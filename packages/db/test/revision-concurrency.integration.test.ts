import type {
  CreateArticleCommand,
  ReviseArticleCommand,
} from "@agent-memory-wiki/application";
import { RevisionConflictError } from "@agent-memory-wiki/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../src/client.js";
import { DrizzleArticleReader } from "../src/repositories/article-reader.js";
import { DrizzleArticleWriter } from "../src/repositories/article-writer.js";
import { pilotCredentials, submissions } from "../src/schema/index.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://wiki_owner:wiki_owner@localhost:55432/wiki_test";

const database = createDatabase({ maxConnections: 8, url: databaseUrl });
const writer = new DrizzleArticleWriter(database.db);

const hex = (value: string): string => value.repeat(64).slice(0, 64);

afterAll(async () => {
  await database.close();
});

const baseCommand = {
  bodyMarkdown: "Initial body\n",
  contentDigest: hex("1"),
  credentialId: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
  idempotencyKeyDigest: hex("2"),
  identity: { claimed_agent_name: "agent" },
  identityFingerprint: hex("3"),
  instructionSetId: "00000000-0000-4000-8000-000000000001",
  method: "rest" as const,
  payloadDigest: hex("4"),
  receivedAt: new Date("2026-08-20T00:00:00.000Z"),
  requestDigest: hex("5"),
  requestId: "request-initial",
  title: "Initial title",
};

beforeEach(async () => {
  await database.db.execute(sql.raw(`
    TRUNCATE TABLE
      audit_events,
      idempotency_records,
      rate_limit_buckets,
      submission_outcome_events,
      revision_state_events,
      article_state_events,
      revisions,
      articles,
      submissions,
      agent_identities,
      pilot_credentials
    RESTART IDENTITY CASCADE
  `));

  await database.db.insert(pilotCredentials).values({
    id: baseCommand.credentialId,
    publicPrefix: "pilot_123456",
    secretDigest: Buffer.alloc(32, 7),
    instructionSetId: baseCommand.instructionSetId,
    termsVersion: "pilot-v1",
    termsAcceptedAt: baseCommand.receivedAt,
    status: "active",
    rateLimitPerMinute: 30,
    rateLimitPerDay: 500,
  });
});

describe("DrizzleArticleWriter", () => {
  it("serializes concurrent exact duplicates across new articles", async () => {
    const first: CreateArticleCommand = {
      ...baseCommand,
      articleId: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
      operation: "create_article",
      rawSubmission: {
        title: baseCommand.title,
        body_markdown: baseCommand.bodyMarkdown,
        identity: baseCommand.identity,
      },
      revisionId: "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a",
      submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a",
    };
    const second: CreateArticleCommand = {
      ...first,
      articleId: "447fd2dc-91f5-4481-bc8a-1d58e478588e",
      idempotencyKeyDigest: hex("6"),
      payloadDigest: hex("7"),
      requestDigest: hex("8"),
      requestId: "request-concurrent-duplicate",
      revisionId: "27832363-fbdf-4a67-bb66-164503774031",
      submissionId: "05a00a54-937e-4499-bcd2-57c391b49347",
    };

    const results = await Promise.allSettled([writer.create(first), writer.create(second)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(
      results.find((item): item is PromiseRejectedResult => item.status === "rejected")?.reason,
    ).toMatchObject({ code: "DUPLICATE_CONTENT" });

    const counts = await database.db.execute<{
      revision_count: number;
      submission_count: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM revisions) AS revision_count,
        (SELECT count(*)::int FROM submissions) AS submission_count
    `);
    expect(counts[0]).toEqual({ revision_count: 1, submission_count: 2 });
  });

  it("serializes concurrent replays of one idempotency key", async () => {
    const command: CreateArticleCommand = {
      ...baseCommand,
      articleId: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
      operation: "create_article",
      rawSubmission: {
        title: baseCommand.title,
        body_markdown: baseCommand.bodyMarkdown,
        identity: baseCommand.identity,
      },
      revisionId: "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a",
      submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a",
    };

    const results = await Promise.all([writer.create(command), writer.create(command)]);
    expect(results.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map(({ revisionId }) => revisionId))).toEqual(
      new Set([command.revisionId]),
    );

    const storedSubmissions = await database.db.select().from(submissions);
    expect(storedSubmissions).toHaveLength(1);
  });

  it("preserves but rejects an exact duplicate submitted as a revision", async () => {
    const initial: CreateArticleCommand = {
      ...baseCommand,
      articleId: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
      operation: "create_article",
      rawSubmission: {
        title: baseCommand.title,
        body_markdown: baseCommand.bodyMarkdown,
        identity: baseCommand.identity,
      },
      revisionId: "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a",
      submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a",
    };
    await writer.create(initial);

    const duplicate: ReviseArticleCommand = {
      ...baseCommand,
      articleId: initial.articleId,
      expectedParentRevisionId: initial.revisionId,
      idempotencyKeyDigest: hex("6"),
      operation: "revise_article",
      payloadDigest: hex("7"),
      rawSubmission: {
        parent_revision_id: initial.revisionId,
        title: baseCommand.title,
        body_markdown: baseCommand.bodyMarkdown,
        identity: baseCommand.identity,
      },
      requestDigest: hex("8"),
      requestId: "request-duplicate",
      revisionId: "27832363-fbdf-4a67-bb66-164503774031",
      submissionId: "05a00a54-937e-4499-bcd2-57c391b49347",
    };

    await expect(writer.revise(duplicate)).rejects.toMatchObject({
      code: "DUPLICATE_CONTENT",
    });

    const counts = await database.db.execute<{
      duplicate_count: number;
      revision_count: number;
      submission_count: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM revisions) AS revision_count,
        (SELECT count(*)::int FROM submissions) AS submission_count,
        (
          SELECT count(*)::int
          FROM submission_outcome_events
          WHERE outcome_code = 'DUPLICATE_CONTENT'
        ) AS duplicate_count
    `);
    expect(counts[0]).toEqual({
      duplicate_count: 1,
      revision_count: 1,
      submission_count: 2,
    });
  });

  it("preserves every admitted concurrent submission but accepts one child", async () => {
    const initial: CreateArticleCommand = {
      ...baseCommand,
      articleId: "420d2ea2-222a-4c03-8bd7-60f1768dbd3a",
      operation: "create_article",
      rawSubmission: {
        title: baseCommand.title,
        body_markdown: baseCommand.bodyMarkdown,
        identity: baseCommand.identity,
      },
      revisionId: "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a",
      submissionId: "20af83c7-eca8-48d5-87b6-a7746641994a",
    };
    await writer.create(initial);

    const first: ReviseArticleCommand = {
      ...baseCommand,
      articleId: initial.articleId,
      bodyMarkdown: "First contender\n",
      contentDigest: hex("6"),
      expectedParentRevisionId: initial.revisionId,
      idempotencyKeyDigest: hex("7"),
      operation: "revise_article",
      payloadDigest: hex("8"),
      rawSubmission: {
        parent_revision_id: initial.revisionId,
        title: "First contender",
        body_markdown: "First contender\n",
        identity: baseCommand.identity,
      },
      requestDigest: hex("9"),
      requestId: "request-first",
      revisionId: "27832363-fbdf-4a67-bb66-164503774031",
      submissionId: "05a00a54-937e-4499-bcd2-57c391b49347",
      title: "First contender",
    };
    const second: ReviseArticleCommand = {
      ...first,
      bodyMarkdown: "Second contender\n",
      contentDigest: hex("a"),
      idempotencyKeyDigest: hex("b"),
      payloadDigest: hex("c"),
      rawSubmission: {
        ...first.rawSubmission,
        title: "Second contender",
        body_markdown: "Second contender\n",
      },
      requestDigest: hex("d"),
      requestId: "request-second",
      revisionId: "50613418-af25-44c2-b695-53b7153ae52b",
      submissionId: "2938f247-fc12-41fd-8494-a4d735019649",
      title: "Second contender",
    };

    const results = await Promise.allSettled([
      writer.revise(first),
      writer.revise(second),
    ]);

    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(RevisionConflictError);

    const storedSubmissions = await database.db.select().from(submissions);
    expect(storedSubmissions).toHaveLength(3);

    const counts = await database.db.execute<{
      revision_count: number;
      conflict_count: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM revisions) AS revision_count,
        (
          SELECT count(*)::int
          FROM submission_outcome_events
          WHERE outcome_code = 'REVISION_CONFLICT'
        ) AS conflict_count
    `);
    expect(counts[0]).toEqual({ revision_count: 2, conflict_count: 1 });

    const fulfilledRevisionId = results.find((item) => item.status === "fulfilled")?.value.revisionId;
    const reader = new DrizzleArticleReader(database.db);
    const raw = await reader.getRawRevision(initial.articleId, fulfilledRevisionId!);
    expect(raw?.revision.id).toBe(fulfilledRevisionId);
  });
});
