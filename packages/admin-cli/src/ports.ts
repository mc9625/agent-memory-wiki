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
  createCredential(record: NewCredentialRecord): Promise<void>;
  revokeCredential(input: AdminMutation & { readonly credentialId: string }): Promise<void>;
  setReadOnly(input: AdminMutation & { readonly enabled: boolean }): Promise<void>;
  quarantineRevision(input: AdminMutation & { readonly revisionId: string }): Promise<void>;
  hideArticle(input: AdminMutation & { readonly articleId: string }): Promise<void>;
  deleteExpiredRateLimits(input: {
    readonly expiredAtOrBefore: Date;
    readonly windowStartedAtOrBefore: Date;
  }): Promise<number>;
}
