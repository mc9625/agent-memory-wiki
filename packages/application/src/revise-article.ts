import type { ReviseArticleInput } from "@agent-memory-wiki/contracts";
import { assertCredentialCanWrite } from "@agent-memory-wiki/domain";

import { InvalidIdempotencyKeyError, ReadOnlyError } from "./errors.js";
import type {
  ArticleWriteResult,
  ArticleWriter,
  AuthenticatedCredential,
  Clock,
  ContentHasher,
  IdGenerator,
  ReadOnlyState,
  SubmissionMethod,
} from "./ports/index.js";

interface ReviseArticleDependencies {
  readonly clock: Clock;
  readonly credentials: AuthenticatedCredential;
  readonly hasher: ContentHasher;
  readonly ids: IdGenerator;
  readonly readOnlyState: ReadOnlyState;
  readonly writer: ArticleWriter;
}

export interface ReviseArticleRequest {
  readonly articleId: string;
  readonly bearerToken: string;
  readonly idempotencyKey: string;
  readonly method: SubmissionMethod;
  readonly rawSubmission: ReviseArticleInput;
  readonly requestId: string;
}

export class ReviseArticleService {
  readonly #dependencies: ReviseArticleDependencies;

  public constructor(dependencies: ReviseArticleDependencies) {
    this.#dependencies = dependencies;
  }

  public async execute(request: ReviseArticleRequest): Promise<ArticleWriteResult> {
    if (request.idempotencyKey.trim().length === 0) {
      throw new InvalidIdempotencyKeyError();
    }

    if (await this.#dependencies.readOnlyState.isReadOnly()) {
      throw new ReadOnlyError();
    }

    const credential = assertCredentialCanWrite(
      await this.#dependencies.credentials.authenticate(request.bearerToken),
    );
    const { rawSubmission } = request;

    return this.#dependencies.writer.revise({
      articleId: request.articleId,
      bodyMarkdown: rawSubmission.body_markdown,
      contentDigest: this.#dependencies.hasher.digest([
        rawSubmission.title,
        rawSubmission.body_markdown,
      ]),
      credentialId: credential.id,
      expectedParentRevisionId: rawSubmission.parent_revision_id,
      idempotencyKeyDigest: this.#dependencies.hasher.digest(request.idempotencyKey),
      identity: rawSubmission.identity,
      identityFingerprint: this.#dependencies.hasher.digest(rawSubmission.identity),
      instructionSetId: credential.instructionSetId,
      method: request.method,
      operation: "revise_article",
      payloadDigest: this.#dependencies.hasher.digest(rawSubmission),
      rawSubmission,
      receivedAt: this.#dependencies.clock.now(),
      requestDigest: this.#dependencies.hasher.digest([
        "revise_article",
        request.articleId,
        rawSubmission,
      ]),
      requestId: request.requestId,
      revisionId: this.#dependencies.ids.next(),
      submissionId: this.#dependencies.ids.next(),
      title: rawSubmission.title,
    });
  }
}
