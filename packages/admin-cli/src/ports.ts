export interface NewCredentialRecord {
  readonly id: string;
  readonly instructionSetId: string;
  readonly operatorLabel: string;
  readonly publicPrefix: string;
  readonly rateLimitPerDay: number;
  readonly rateLimitPerMinute: number;
  readonly secretDigest: Uint8Array;
  readonly termsAcceptedAt: Date;
  readonly termsVersion: string;
}

export interface AdminMutation {
  readonly actorType: "admin";
  readonly at: Date;
  readonly reasonCode: string;
  readonly requestId: string;
}

export interface AdminStore {
  activateInstruction(
    input: AdminMutation & { readonly instructionSetId: string },
  ): Promise<void>;
  createCredential(record: NewCredentialRecord): Promise<void>;
  revokeCredential(input: AdminMutation & { readonly credentialId: string }): Promise<void>;
  setReadOnly(input: AdminMutation & { readonly enabled: boolean }): Promise<void>;
  quarantineRevision(input: AdminMutation & { readonly revisionId: string }): Promise<void>;
  hideArticle(input: AdminMutation & { readonly articleId: string }): Promise<void>;
  deleteExpiredRateLimits(input: {
    readonly expiredAtOrBefore: Date;
    readonly windowStartedAtOrBefore: Date;
  }): Promise<number>;
  getSettings(): Promise<{ readonly readOnly: boolean; readonly settingsVersion: number; readonly updatedAt: Date } | null>;
  listCredentials(): Promise<readonly {
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
  }[]>;
}
