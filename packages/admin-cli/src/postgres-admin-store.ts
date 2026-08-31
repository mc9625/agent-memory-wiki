import { randomUUID } from "node:crypto";

import {
  articleStateEvents,
  articles,
  auditEvents,
  instructionSetActivationEvents,
  instructionSets,
  pilotCredentials,
  rateLimitBuckets,
  revisions,
  revisionStateEvents,
  systemSettings,
} from "@agent-memory-wiki/db";
import type { Database } from "@agent-memory-wiki/db";
import { and, eq, lte, sql } from "drizzle-orm";

import type { AdminStore, NewCredentialRecord } from "./ports";

export class PostgresAdminStore implements AdminStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async activateInstruction(
    input: Parameters<AdminStore["activateInstruction"]>[0],
  ): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const [instruction] = await transaction
        .select({ id: instructionSets.id })
        .from(instructionSets)
        .where(eq(instructionSets.id, input.instructionSetId))
        .limit(1);
      if (!instruction) throw new Error("Instruction set not found.");
      await transaction.insert(instructionSetActivationEvents).values({
        actorType: input.actorType,
        createdAt: input.at,
        id: randomUUID(),
        instructionSetId: input.instructionSetId,
        reasonCode: input.reasonCode,
      });
      await transaction.insert(auditEvents).values({
        action: "activate_instruction",
        actorType: input.actorType,
        createdAt: input.at,
        id: randomUUID(),
        outcomeCode: "ACCEPTED",
        reasonCode: input.reasonCode,
        requestId: input.requestId,
        safeMetadata: {},
        targetId: input.instructionSetId,
        targetType: "instruction_set",
      });
    });
  }

  public async createCredential(record: NewCredentialRecord): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      await transaction.insert(pilotCredentials).values({
        id: record.id,
        instructionSetId: record.instructionSetId,
        operatorLabel: record.operatorLabel,
        publicPrefix: record.publicPrefix,
        rateLimitPerDay: record.rateLimitPerDay,
        rateLimitPerMinute: record.rateLimitPerMinute,
        secretDigest: record.secretDigest,
        status: "active",
        termsAcceptedAt: record.termsAcceptedAt,
        termsVersion: record.termsVersion,
      });
      await transaction.insert(auditEvents).values({
        action: "create_credential",
        actorType: "admin",
        createdAt: new Date(),
        id: randomUUID(),
        outcomeCode: "ACCEPTED",
        requestId: randomUUID(),
        safeMetadata: {},
        targetId: record.id,
        targetType: "credential",
      });
    });
  }

  public async revokeCredential(input: Parameters<AdminStore["revokeCredential"]>[0]): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const updated = await transaction.update(pilotCredentials).set({ status: "revoked", revokedAt: input.at }).where(and(eq(pilotCredentials.id, input.credentialId), eq(pilotCredentials.status, "active"))).returning({ id: pilotCredentials.id });
      if (updated.length !== 1) throw new Error("Active credential not found.");
      await transaction.insert(auditEvents).values({ action: "revoke_credential", actorType: input.actorType, createdAt: input.at, id: randomUUID(), outcomeCode: "ACCEPTED", reasonCode: input.reasonCode, requestId: input.requestId, safeMetadata: {}, targetId: input.credentialId, targetType: "credential" });
    });
  }

  public async setReadOnly(input: Parameters<AdminStore["setReadOnly"]>[0]): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const updated = await transaction.update(systemSettings).set({ readOnly: input.enabled, settingsVersion: sql`${systemSettings.settingsVersion} + 1`, updatedAt: input.at }).where(eq(systemSettings.singleton, true)).returning({ singleton: systemSettings.singleton });
      if (updated.length !== 1) throw new Error("System settings are unavailable.");
      await transaction.insert(auditEvents).values({ action: "set_read_only", actorType: input.actorType, createdAt: input.at, id: randomUUID(), outcomeCode: "ACCEPTED", reasonCode: input.reasonCode, requestId: input.requestId, safeMetadata: { enabled: input.enabled }, targetType: "system_settings" });
    });
  }

  public async quarantineRevision(input: Parameters<AdminStore["quarantineRevision"]>[0]): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const [revision] = await transaction.select({ id: revisions.id }).from(revisions).where(eq(revisions.id, input.revisionId)).limit(1);
      if (!revision) throw new Error("Revision not found.");
      await transaction.insert(revisionStateEvents).values({ actorType: "admin", createdAt: input.at, id: randomUUID(), reasonCode: input.reasonCode, revisionId: input.revisionId, state: "quarantined" });
      await transaction.insert(auditEvents).values({ action: "quarantine_revision", actorType: input.actorType, createdAt: input.at, id: randomUUID(), outcomeCode: "ACCEPTED", reasonCode: input.reasonCode, requestId: input.requestId, safeMetadata: {}, targetId: input.revisionId, targetType: "revision" });
    });
  }

  public async approveRevision(input: Parameters<AdminStore["approveRevision"]>[0]): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const [revision] = await transaction
        .select({ id: revisions.id, articleId: revisions.articleId })
        .from(revisions)
        .where(eq(revisions.id, input.revisionId))
        .limit(1);
      if (!revision) throw new Error("Revision not found.");

      await transaction.insert(revisionStateEvents).values({
        actorType: "admin",
        createdAt: input.at,
        id: randomUUID(),
        reasonCode: input.reasonCode || "ADMIN_APPROVED",
        revisionId: input.revisionId,
        state: "published",
      });

      await transaction.insert(articleStateEvents).values({
        actorType: "admin",
        articleId: revision.articleId,
        createdAt: input.at,
        id: randomUUID(),
        reasonCode: input.reasonCode || "ADMIN_APPROVED",
        visibility: "visible",
      });

      await transaction
        .update(articles)
        .set({ currentRevisionId: input.revisionId })
        .where(eq(articles.id, revision.articleId));

      await transaction.insert(auditEvents).values({
        action: "approve_revision",
        actorType: "admin",
        createdAt: input.at,
        id: randomUUID(),
        outcomeCode: "ACCEPTED",
        reasonCode: input.reasonCode || "ADMIN_APPROVED",
        requestId: input.requestId,
        safeMetadata: {},
        targetId: input.revisionId,
        targetType: "revision",
      });
    });
  }

  public async rejectRevision(input: Parameters<AdminStore["rejectRevision"]>[0]): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const [revision] = await transaction
        .select({ id: revisions.id, articleId: revisions.articleId })
        .from(revisions)
        .where(eq(revisions.id, input.revisionId))
        .limit(1);
      if (!revision) throw new Error("Revision not found.");

      await transaction.insert(revisionStateEvents).values({
        actorType: "admin",
        createdAt: input.at,
        id: randomUUID(),
        reasonCode: input.reasonCode || "ADMIN_REJECTED",
        revisionId: input.revisionId,
        state: "quarantined",
      });

      await transaction.insert(auditEvents).values({
        action: "reject_revision",
        actorType: "admin",
        createdAt: input.at,
        id: randomUUID(),
        outcomeCode: "ACCEPTED",
        reasonCode: input.reasonCode || "ADMIN_REJECTED",
        requestId: input.requestId,
        safeMetadata: {},
        targetId: input.revisionId,
        targetType: "revision",
      });
    });
  }

  public async listPendingRevisions(): Promise<Awaited<ReturnType<AdminStore["listPendingRevisions"]>>> {
    const rows = await this.#database.execute<{
      revision_id: string;
      article_id: string;
      parent_revision_id: string | null;
      title: string;
      body_markdown: string;
      revision_created_at: string;
      slug: string;
      submission_id: string;
      submission_method: "mcp" | "rest";
      received_at: string;
      claimed_agent_name: string;
      claimed_model: string | null;
      claimed_provider: string | null;
      claimed_client: string | null;
      quarantine_reason: string;
    }>(sql`
      SELECT
        r.id::text AS revision_id,
        r.article_id::text AS article_id,
        r.parent_revision_id::text AS parent_revision_id,
        r.title,
        r.body_markdown,
        r.created_at::text AS revision_created_at,
        a.slug,
        s.id::text AS submission_id,
        s.submission_method,
        s.received_at::text AS received_at,
        i.claimed_agent_name,
        i.claimed_model,
        i.claimed_provider,
        i.claimed_client,
        rse.reason_code AS quarantine_reason
      FROM revisions r
      JOIN articles a ON a.id = r.article_id
      JOIN submissions s ON s.id = r.submission_id
      JOIN agent_identities i ON i.id = s.author_agent_id
      JOIN LATERAL (
        SELECT state, reason_code FROM revision_state_events
        WHERE revision_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) rse ON rse.state = 'quarantined' AND rse.reason_code = 'PENDING_MODERATION'
      ORDER BY r.created_at ASC
    `);

    return rows.map((row) => ({
      articleId: row.article_id,
      bodyMarkdown: row.body_markdown,
      claimedAgentName: row.claimed_agent_name,
      claimedClient: row.claimed_client,
      claimedModel: row.claimed_model,
      claimedProvider: row.claimed_provider,
      parentRevisionId: row.parent_revision_id,
      quarantineReason: row.quarantine_reason,
      receivedAt: new Date(row.received_at),
      revisionCreatedAt: new Date(row.revision_created_at),
      revisionId: row.revision_id,
      slug: row.slug,
      submissionId: row.submission_id,
      submissionMethod: row.submission_method,
      title: row.title,
    }));
  }

  public async hideArticle(input: Parameters<AdminStore["hideArticle"]>[0]): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const [article] = await transaction.select({ id: articles.id }).from(articles).where(eq(articles.id, input.articleId)).limit(1);
      if (!article) throw new Error("Article not found.");
      await transaction.insert(articleStateEvents).values({ actorType: "admin", articleId: input.articleId, createdAt: input.at, id: randomUUID(), reasonCode: input.reasonCode, visibility: "hidden" });
      await transaction.insert(auditEvents).values({ action: "hide_article", actorType: input.actorType, createdAt: input.at, id: randomUUID(), outcomeCode: "ACCEPTED", reasonCode: input.reasonCode, requestId: input.requestId, safeMetadata: {}, targetId: input.articleId, targetType: "article" });
    });
  }

  public async deleteExpiredRateLimits(input: Parameters<AdminStore["deleteExpiredRateLimits"]>[0]): Promise<number> {
    const deleted = await this.#database.delete(rateLimitBuckets).where(and(lte(rateLimitBuckets.expiresAt, input.expiredAtOrBefore), lte(rateLimitBuckets.windowStartedAt, input.windowStartedAtOrBefore))).returning({ subjectType: rateLimitBuckets.subjectType });
    return deleted.length;
  }

  public async getSettings(): Promise<Awaited<ReturnType<AdminStore["getSettings"]>>> {
    const [settings] = await this.#database
      .select({
        readOnly: systemSettings.readOnly,
        settingsVersion: systemSettings.settingsVersion,
        updatedAt: systemSettings.updatedAt,
      })
      .from(systemSettings)
      .where(eq(systemSettings.singleton, true))
      .limit(1);
    return settings ?? null;
  }

  public async listCredentials(): Promise<Awaited<ReturnType<AdminStore["listCredentials"]>>> {
    return this.#database
      .select({
        createdAt: pilotCredentials.createdAt,
        id: pilotCredentials.id,
        instructionSetId: pilotCredentials.instructionSetId,
        operatorLabel: pilotCredentials.operatorLabel,
        publicPrefix: pilotCredentials.publicPrefix,
        rateLimitPerDay: pilotCredentials.rateLimitPerDay,
        rateLimitPerMinute: pilotCredentials.rateLimitPerMinute,
        revokedAt: pilotCredentials.revokedAt,
        status: pilotCredentials.status,
        termsAcceptedAt: pilotCredentials.termsAcceptedAt,
        termsVersion: pilotCredentials.termsVersion,
      })
      .from(pilotCredentials)
      .orderBy(pilotCredentials.createdAt, pilotCredentials.id);
  }
}
