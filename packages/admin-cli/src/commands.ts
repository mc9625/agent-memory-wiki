import { createHmac, randomBytes, randomUUID } from "node:crypto";

import type { AdminMutation, AdminStore } from "./ports";

const mutation = (reasonCode: string, at = new Date()): AdminMutation => {
  if (reasonCode.trim().length === 0) throw new Error("A reason code is required.");
  return { actorType: "admin", at, reasonCode, requestId: randomUUID() };
};

export interface CreateCredentialInput {
  readonly instructionSetId: string;
  readonly operatorLabel: string;
  readonly rateLimitPerDay: number;
  readonly rateLimitPerMinute: number;
  readonly termsAcceptedAt: Date;
  readonly termsVersion: string;
}

export const createCredential = async (
  input: CreateCredentialInput,
  dependencies: { readonly digestKey: Uint8Array; readonly store: AdminStore },
): Promise<{ readonly bearerToken: string; readonly credentialId: string }> => {
  if (dependencies.digestKey.byteLength !== 32) throw new Error("Digest key must be exactly 32 bytes.");
  if (!input.instructionSetId || !input.termsVersion || !input.operatorLabel) {
    throw new Error("Instruction, terms, and operator label are required.");
  }
  if (input.rateLimitPerDay <= 0 || input.rateLimitPerMinute <= 0) {
    throw new Error("Rate limits must be positive.");
  }
  const secret = randomBytes(32).toString("base64url");
  const publicPrefix = `pilot_${secret.slice(0, 10)}`;
  const bearerToken = `${publicPrefix}.${secret}`;
  const credentialId = randomUUID();
  await dependencies.store.createCredential({
    id: credentialId,
    instructionSetId: input.instructionSetId,
    operatorLabel: input.operatorLabel,
    publicPrefix,
    rateLimitPerDay: input.rateLimitPerDay,
    rateLimitPerMinute: input.rateLimitPerMinute,
    secretDigest: new Uint8Array(
      createHmac("sha256", dependencies.digestKey).update(bearerToken, "utf8").digest(),
    ),
    termsAcceptedAt: input.termsAcceptedAt,
    termsVersion: input.termsVersion,
  });
  return { bearerToken, credentialId };
};

export const revokeCredential = async (
  input: { readonly credentialId: string; readonly reasonCode: string; readonly at?: Date },
  store: AdminStore,
): Promise<void> => store.revokeCredential({ credentialId: input.credentialId, ...mutation(input.reasonCode, input.at) });

export const setReadOnly = async (
  input: { readonly enabled: boolean; readonly reasonCode: string; readonly at?: Date },
  store: AdminStore,
): Promise<void> => store.setReadOnly({ enabled: input.enabled, ...mutation(input.reasonCode, input.at) });

export const quarantineRevision = async (
  input: { readonly reasonCode: string; readonly revisionId: string; readonly at?: Date },
  store: AdminStore,
): Promise<void> => store.quarantineRevision({ revisionId: input.revisionId, ...mutation(input.reasonCode, input.at) });

export const approveRevision = async (
  input: { readonly reasonCode?: string; readonly revisionId: string; readonly at?: Date },
  store: AdminStore,
): Promise<void> => store.approveRevision({ revisionId: input.revisionId, ...mutation(input.reasonCode || "ADMIN_APPROVED", input.at) });

export const rejectRevision = async (
  input: { readonly reasonCode?: string; readonly revisionId: string; readonly at?: Date },
  store: AdminStore,
): Promise<void> => store.rejectRevision({ revisionId: input.revisionId, ...mutation(input.reasonCode || "ADMIN_REJECTED", input.at) });

export const listPendingRevisions = async (
  store: AdminStore,
): Promise<Awaited<ReturnType<AdminStore["listPendingRevisions"]>>> => store.listPendingRevisions();

export const hideArticle = async (
  input: { readonly articleId: string; readonly reasonCode: string; readonly at?: Date },
  store: AdminStore,
): Promise<void> => store.hideArticle({ articleId: input.articleId, ...mutation(input.reasonCode, input.at) });

export const cleanupRateLimits = (now: Date, store: AdminStore): Promise<number> =>
  store.deleteExpiredRateLimits({
    expiredAtOrBefore: now,
    windowStartedAtOrBefore: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
  });

export const activateInstruction = async (
  input: { readonly instructionSetId: string; readonly reasonCode: string; readonly at?: Date },
  store: AdminStore,
): Promise<void> =>
  store.activateInstruction({
    instructionSetId: input.instructionSetId,
    ...mutation(input.reasonCode, input.at),
  });

export const requireEnvironmentConfirmation = (confirmedProduction: boolean): void => {
  if (!confirmedProduction) {
    throw new Error("Administrative mutations require --confirm-production.");
  }
};
