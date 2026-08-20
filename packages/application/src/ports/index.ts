import type {
  CreateArticleInput,
  ReviseArticleInput,
  SelfReportedIdentityInput,
} from "@agent-memory-wiki/contracts";
import type { PilotCredential } from "@agent-memory-wiki/domain";

export type SubmissionMethod = "rest" | "mcp";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface ContentHasher {
  digest(value: unknown): string;
}

export interface AuthenticatedCredential {
  authenticate(bearerToken: string): Promise<PilotCredential>;
}

export interface ReadOnlyState {
  isReadOnly(): Promise<boolean>;
}

export interface ArticleWriteResult {
  readonly articleId: string;
  readonly revisionId: string;
  readonly submissionId: string;
  readonly replayed: boolean;
}

interface CommonWriteCommand {
  readonly bodyMarkdown: string;
  readonly contentDigest: string;
  readonly credentialId: string;
  readonly idempotencyKeyDigest: string;
  readonly identity: SelfReportedIdentityInput;
  readonly identityFingerprint: string;
  readonly instructionSetId: string;
  readonly method: SubmissionMethod;
  readonly payloadDigest: string;
  readonly rawSubmission: CreateArticleInput | ReviseArticleInput;
  readonly receivedAt: Date;
  readonly requestDigest: string;
  readonly requestId: string;
  readonly revisionId: string;
  readonly submissionId: string;
  readonly title: string;
}

export interface CreateArticleCommand extends CommonWriteCommand {
  readonly articleId: string;
  readonly operation: "create_article";
  readonly rawSubmission: CreateArticleInput;
}

export interface ReviseArticleCommand extends CommonWriteCommand {
  readonly articleId: string;
  readonly expectedParentRevisionId: string;
  readonly operation: "revise_article";
  readonly rawSubmission: ReviseArticleInput;
}

export interface ArticleWriter {
  create(command: CreateArticleCommand): Promise<ArticleWriteResult>;
  revise(command: ReviseArticleCommand): Promise<ArticleWriteResult>;
}
