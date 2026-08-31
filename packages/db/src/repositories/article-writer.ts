import type {
  ArticleWriteResult,
  ArticleWriter,
  CreateArticleCommand,
  ReviseArticleCommand,
} from "@agent-memory-wiki/application";
import { ApplicationError } from "@agent-memory-wiki/application";
import { RevisionConflictError } from "@agent-memory-wiki/domain";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../client";
import {
  agentIdentities,
  articles,
  articleStateEvents,
  auditEvents,
  idempotencyRecords,
  revisions,
  revisionStateEvents,
  submissionOutcomeEvents,
  submissions,
} from "../schema/index";

type TransactionOutcome =
  | { readonly kind: "accepted"; readonly result: ArticleWriteResult }
  | { readonly kind: "conflict" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "idempotency_conflict" };

const digestBytes = (hexDigest: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/u.test(hexDigest)) {
    throw new ApplicationError("INVALID_DIGEST", "A SHA-256 digest must be lowercase hex.");
  }

  return new Uint8Array(Buffer.from(hexDigest, "hex"));
};

const equalDigest = (left: Uint8Array, rightHex: string): boolean =>
  Buffer.from(left).equals(Buffer.from(digestBytes(rightHex)));

const idempotencyExpiry = (receivedAt: Date): Date =>
  new Date(receivedAt.getTime() + 30 * 24 * 60 * 60 * 1_000);

const slugFor = (title: string, articleId: string): string => {
  const base = title
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 72);
  return `${base || "article"}-${articleId.slice(0, 8)}`;
};

const isUniqueViolation = (error: unknown): boolean => {
  let candidate = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    if ("code" in candidate && candidate.code === "23505") return true;
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return false;
};

export class DrizzleArticleWriter implements ArticleWriter {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async create(command: CreateArticleCommand): Promise<ArticleWriteResult> {
    const outcome = await this.#database.transaction(async (transaction) => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`idempotency:${command.credentialId}:${command.idempotencyKeyDigest}`}::text, 0::bigint)
        )
      `);
      const [existingIdempotency] = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.credentialId, command.credentialId),
            eq(
              idempotencyRecords.idempotencyKeyDigest,
              digestBytes(command.idempotencyKeyDigest),
            ),
          ),
        )
        .limit(1);

      if (existingIdempotency) {
        if (!equalDigest(existingIdempotency.requestDigest, command.requestDigest)) {
          return { kind: "idempotency_conflict" } as const;
        }

        if (existingIdempotency.resourceId) {
          const [existingRevision] = await transaction
            .select({ articleId: revisions.articleId, submissionId: revisions.submissionId })
            .from(revisions)
            .where(eq(revisions.id, existingIdempotency.resourceId))
            .limit(1);
          if (existingRevision) {
            return {
              kind: "accepted",
              result: {
                articleId: existingRevision.articleId,
                replayed: true,
                revisionId: existingIdempotency.resourceId,
                submissionId: existingRevision.submissionId,
              },
            } as const;
          }
        }

        return existingIdempotency.outcomeCode === "DUPLICATE_CONTENT"
          ? ({ kind: "duplicate" } as const)
          : ({ kind: "idempotency_conflict" } as const);
      }

      const identityDigest = digestBytes(command.identityFingerprint);
      await transaction
        .insert(agentIdentities)
        .values({
          id: randomUUID(),
          claimedAgentName: command.identity.claimed_agent_name,
          claimedModel: command.identity.claimed_model,
          claimedProvider: command.identity.claimed_provider,
          claimedClient: command.identity.claimed_client,
          rawClientMetadata: command.identity.raw_client_metadata ?? {},
          identityFingerprint: identityDigest,
          firstSeenAt: command.receivedAt,
        })
        .onConflictDoNothing({ target: agentIdentities.identityFingerprint });
      const [identity] = await transaction
        .select({ id: agentIdentities.id })
        .from(agentIdentities)
        .where(eq(agentIdentities.identityFingerprint, identityDigest))
        .limit(1);
      if (!identity) throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Identity write failed.");

      await transaction.insert(submissions).values({
        id: command.submissionId,
        pilotCredentialId: command.credentialId,
        authorAgentId: identity.id,
        instructionSetId: command.instructionSetId,
        submissionMethod: command.method,
        operation: command.operation,
        rawSubmission: command.rawSubmission,
        payloadSha256: digestBytes(command.payloadDigest),
        receivedAt: command.receivedAt,
      });

      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`content:${command.contentDigest}`}::text, 0::bigint))
      `);
      const [duplicate] = await transaction
        .select({ id: revisions.id })
        .from(revisions)
        .where(
          and(
            eq(revisions.contentSha256, digestBytes(command.contentDigest)),
            eq(revisions.title, command.title),
            eq(revisions.bodyMarkdown, command.bodyMarkdown),
          ),
        )
        .limit(1);
      if (duplicate) {
        await transaction.insert(submissionOutcomeEvents).values({
          id: randomUUID(),
          submissionId: command.submissionId,
          outcomeCode: "DUPLICATE_CONTENT",
          safeMetadata: {},
          createdAt: command.receivedAt,
        });
        await transaction.insert(idempotencyRecords).values({
          credentialId: command.credentialId,
          idempotencyKeyDigest: digestBytes(command.idempotencyKeyDigest),
          requestDigest: digestBytes(command.requestDigest),
          operation: command.operation,
          outcomeCode: "DUPLICATE_CONTENT",
          createdAt: command.receivedAt,
          expiresAt: idempotencyExpiry(command.receivedAt),
        });
        await transaction.insert(auditEvents).values({
          id: randomUUID(),
          requestId: command.requestId,
          actorType: "credential",
          actorId: command.credentialId,
          action: command.operation,
          outcomeCode: "DUPLICATE_CONTENT",
          safeMetadata: {},
          createdAt: command.receivedAt,
        });
        return { kind: "duplicate" } as const;
      }

      await transaction.insert(articles).values({
        id: command.articleId,
        slug: slugFor(command.title, command.articleId),
        createdAt: command.receivedAt,
      });
      await transaction.insert(revisions).values({
        id: command.revisionId,
        articleId: command.articleId,
        parentRevisionId: null,
        title: command.title,
        bodyMarkdown: command.bodyMarkdown,
        submissionId: command.submissionId,
        contentSha256: digestBytes(command.contentDigest),
        createdAt: command.receivedAt,
      });
      await transaction
        .update(articles)
        .set({ currentRevisionId: command.revisionId })
        .where(eq(articles.id, command.articleId));
      await transaction.insert(submissionOutcomeEvents).values({
        id: randomUUID(),
        submissionId: command.submissionId,
        outcomeCode: "ACCEPTED",
        articleId: command.articleId,
        revisionId: command.revisionId,
        safeMetadata: {},
        createdAt: command.receivedAt,
      });
      await transaction.insert(revisionStateEvents).values({
        id: randomUUID(),
        revisionId: command.revisionId,
        state: "quarantined",
        reasonCode: "PENDING_MODERATION",
        actorType: "system",
        createdAt: command.receivedAt,
      });
      await transaction.insert(articleStateEvents).values({
        id: randomUUID(),
        articleId: command.articleId,
        visibility: "hidden",
        reasonCode: "PENDING_MODERATION",
        actorType: "system",
        createdAt: command.receivedAt,
      });
      await transaction.insert(idempotencyRecords).values({
        credentialId: command.credentialId,
        idempotencyKeyDigest: digestBytes(command.idempotencyKeyDigest),
        requestDigest: digestBytes(command.requestDigest),
        operation: command.operation,
        outcomeCode: "ACCEPTED",
        resourceType: "revision",
        resourceId: command.revisionId,
        createdAt: command.receivedAt,
        expiresAt: idempotencyExpiry(command.receivedAt),
      });
      await transaction.insert(auditEvents).values({
        id: randomUUID(),
        requestId: command.requestId,
        actorType: "credential",
        actorId: command.credentialId,
        action: command.operation,
        targetType: "article",
        targetId: command.articleId,
        outcomeCode: "ACCEPTED",
        safeMetadata: {},
        createdAt: command.receivedAt,
      });

      return {
        kind: "accepted",
        result: {
          articleId: command.articleId,
          replayed: false,
          revisionId: command.revisionId,
          submissionId: command.submissionId,
        },
      } as const;
    });

    return this.#unwrap(outcome);
  }

  public async revise(command: ReviseArticleCommand): Promise<ArticleWriteResult> {
    const outcome: TransactionOutcome = await this.#database.transaction(async (transaction) => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`idempotency:${command.credentialId}:${command.idempotencyKeyDigest}`}::text, 0::bigint)
        )
      `);
      const [existingIdempotency] = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.credentialId, command.credentialId),
            eq(
              idempotencyRecords.idempotencyKeyDigest,
              digestBytes(command.idempotencyKeyDigest),
            ),
          ),
        )
        .limit(1);
      if (existingIdempotency) {
        if (!equalDigest(existingIdempotency.requestDigest, command.requestDigest)) {
          return { kind: "idempotency_conflict" };
        }
        if (existingIdempotency.resourceId) {
          const [existingRevision] = await transaction
            .select({ articleId: revisions.articleId, submissionId: revisions.submissionId })
            .from(revisions)
            .where(eq(revisions.id, existingIdempotency.resourceId))
            .limit(1);
          if (existingRevision) {
            return {
              kind: "accepted",
              result: {
                articleId: existingRevision.articleId,
                replayed: true,
                revisionId: existingIdempotency.resourceId,
                submissionId: existingRevision.submissionId,
              },
            };
          }
        }
        if (existingIdempotency.outcomeCode === "REVISION_CONFLICT") {
          return { kind: "conflict" };
        }
        return existingIdempotency.outcomeCode === "DUPLICATE_CONTENT"
          ? { kind: "duplicate" }
          : { kind: "idempotency_conflict" };
      }

      const identityDigest = digestBytes(command.identityFingerprint);
      await transaction
        .insert(agentIdentities)
        .values({
          id: randomUUID(),
          claimedAgentName: command.identity.claimed_agent_name,
          claimedModel: command.identity.claimed_model,
          claimedProvider: command.identity.claimed_provider,
          claimedClient: command.identity.claimed_client,
          rawClientMetadata: command.identity.raw_client_metadata ?? {},
          identityFingerprint: identityDigest,
          firstSeenAt: command.receivedAt,
        })
        .onConflictDoNothing({ target: agentIdentities.identityFingerprint });
      const [identity] = await transaction
        .select({ id: agentIdentities.id })
        .from(agentIdentities)
        .where(eq(agentIdentities.identityFingerprint, identityDigest))
        .limit(1);
      if (!identity) throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Identity write failed.");

      await transaction.insert(submissions).values({
        id: command.submissionId,
        pilotCredentialId: command.credentialId,
        authorAgentId: identity.id,
        instructionSetId: command.instructionSetId,
        submissionMethod: command.method,
        operation: command.operation,
        rawSubmission: command.rawSubmission,
        payloadSha256: digestBytes(command.payloadDigest),
        receivedAt: command.receivedAt,
      });

      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`content:${command.contentDigest}`}::text, 0::bigint))
      `);
      const [duplicate] = await transaction
        .select({ id: revisions.id })
        .from(revisions)
        .where(
          and(
            eq(revisions.contentSha256, digestBytes(command.contentDigest)),
            eq(revisions.title, command.title),
            eq(revisions.bodyMarkdown, command.bodyMarkdown),
          ),
        )
        .limit(1);
      if (duplicate) {
        await transaction.insert(submissionOutcomeEvents).values({
          id: randomUUID(),
          submissionId: command.submissionId,
          outcomeCode: "DUPLICATE_CONTENT",
          articleId: command.articleId,
          safeMetadata: {},
          createdAt: command.receivedAt,
        });
        await transaction.insert(idempotencyRecords).values({
          credentialId: command.credentialId,
          idempotencyKeyDigest: digestBytes(command.idempotencyKeyDigest),
          requestDigest: digestBytes(command.requestDigest),
          operation: command.operation,
          outcomeCode: "DUPLICATE_CONTENT",
          createdAt: command.receivedAt,
          expiresAt: idempotencyExpiry(command.receivedAt),
        });
        await transaction.insert(auditEvents).values({
          id: randomUUID(),
          requestId: command.requestId,
          actorType: "credential",
          actorId: command.credentialId,
          action: command.operation,
          targetType: "article",
          targetId: command.articleId,
          outcomeCode: "DUPLICATE_CONTENT",
          safeMetadata: {},
          createdAt: command.receivedAt,
        });
        return { kind: "duplicate" };
      }

      let conflict = false;
      try {
        await transaction.transaction(async (savepoint) => {
          const [article] = await savepoint
            .select({ id: articles.id, currentRevisionId: articles.currentRevisionId })
            .from(articles)
            .where(
              and(
                eq(articles.id, command.articleId),
                eq(articles.currentRevisionId, command.expectedParentRevisionId),
              ),
            )
            .limit(1);
          if (!article) throw new RevisionConflictError();

          await savepoint.insert(revisions).values({
            id: command.revisionId,
            articleId: command.articleId,
            parentRevisionId: command.expectedParentRevisionId,
            title: command.title,
            bodyMarkdown: command.bodyMarkdown,
            submissionId: command.submissionId,
            contentSha256: digestBytes(command.contentDigest),
            createdAt: command.receivedAt,
          });
        });
      } catch (error) {
        if (!(error instanceof RevisionConflictError) && !isUniqueViolation(error)) throw error;
        conflict = true;
      }

      const outcomeCode = conflict ? "REVISION_CONFLICT" : "ACCEPTED";
      await transaction.insert(submissionOutcomeEvents).values({
        id: randomUUID(),
        submissionId: command.submissionId,
        outcomeCode,
        articleId: command.articleId,
        revisionId: conflict ? null : command.revisionId,
        safeMetadata: {},
        createdAt: command.receivedAt,
      });
      if (!conflict) {
        await transaction.insert(revisionStateEvents).values({
          id: randomUUID(),
          revisionId: command.revisionId,
          state: "quarantined",
          reasonCode: "PENDING_MODERATION",
          actorType: "system",
          createdAt: command.receivedAt,
        });
      }
      await transaction.insert(idempotencyRecords).values({
        credentialId: command.credentialId,
        idempotencyKeyDigest: digestBytes(command.idempotencyKeyDigest),
        requestDigest: digestBytes(command.requestDigest),
        operation: command.operation,
        outcomeCode,
        resourceType: conflict ? null : "revision",
        resourceId: conflict ? null : command.revisionId,
        createdAt: command.receivedAt,
        expiresAt: idempotencyExpiry(command.receivedAt),
      });
      await transaction.insert(auditEvents).values({
        id: randomUUID(),
        requestId: command.requestId,
        actorType: "credential",
        actorId: command.credentialId,
        action: command.operation,
        targetType: "article",
        targetId: command.articleId,
        outcomeCode,
        safeMetadata: {},
        createdAt: command.receivedAt,
      });

      return conflict
        ? { kind: "conflict" }
        : {
            kind: "accepted",
            result: {
              articleId: command.articleId,
              replayed: false,
              revisionId: command.revisionId,
              submissionId: command.submissionId,
            },
          };
    });

    return this.#unwrap(outcome);
  }

  #unwrap(outcome: TransactionOutcome): ArticleWriteResult {
    if (outcome.kind === "accepted") return outcome.result;
    if (outcome.kind === "conflict") throw new RevisionConflictError();
    if (outcome.kind === "duplicate") {
      throw new ApplicationError("DUPLICATE_CONTENT", "This exact contribution already exists.");
    }
    throw new ApplicationError(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for a different request.",
    );
  }
}
