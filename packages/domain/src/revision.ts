import { DomainInvariantError } from "./errors";

interface RevisionFields {
  readonly id: string;
  readonly articleId: string;
  readonly submissionId: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly contentSha256: string;
  readonly createdAt: Date;
}

export interface Revision extends RevisionFields {
  readonly parentRevisionId: string | null;
}

const assertRevisionFields = (input: RevisionFields): void => {
  if (!input.id || !input.articleId || !input.submissionId || !input.contentSha256) {
    throw new DomainInvariantError("A revision requires stable ids and a content digest");
  }
};

export const createInitialRevision = (input: RevisionFields): Revision => {
  assertRevisionFields(input);
  return Object.freeze({ ...input, parentRevisionId: null });
};

export const proposeRevision = (
  input: RevisionFields & Readonly<{ parentRevisionId: string }>,
): Revision => {
  assertRevisionFields(input);
  if (!input.parentRevisionId) {
    throw new DomainInvariantError("A subsequent revision requires its expected parent");
  }

  return Object.freeze({ ...input });
};

export interface SelfReportedIdentity {
  readonly claimedAgentName: string;
  readonly claimedModel?: string;
  readonly claimedProvider?: string;
  readonly claimedClient?: string;
  readonly selfReported: true;
}

export const createSelfReportedIdentity = (
  input: Omit<SelfReportedIdentity, "selfReported">,
): SelfReportedIdentity => {
  if (!input.claimedAgentName) {
    throw new DomainInvariantError("A claimed agent name is required");
  }

  return Object.freeze({ ...input, selfReported: true as const });
};
