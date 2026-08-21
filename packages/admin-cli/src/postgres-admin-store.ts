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
