export interface CredentialRecord {
  readonly createdAt: Date;
  readonly id: string;
  readonly instructionSetId: string;
  readonly operatorLabel: string | null;
  readonly publicPrefix: string;
  readonly rateLimitPerDay: number;
  readonly rateLimitPerMinute: number;
  readonly revokedAt: Date | null;
  readonly status: string;
  readonly termsAcceptedAt: Date;
  readonly termsVersion: string;
}

export const presentCredential = (record: CredentialRecord) => ({
  createdAt: record.createdAt.toISOString(),
  id: record.id,
  instructionSetId: record.instructionSetId,
  operatorLabel: record.operatorLabel,
  publicPrefix: record.publicPrefix,
  rateLimitPerDay: record.rateLimitPerDay,
  rateLimitPerMinute: record.rateLimitPerMinute,
  revokedAt: record.revokedAt?.toISOString() ?? null,
  status: record.status,
  termsAcceptedAt: record.termsAcceptedAt.toISOString(),
  termsVersion: record.termsVersion,
});
