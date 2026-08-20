import type { CreateArticleInput } from "@agent-memory-wiki/contracts";
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

interface CreateArticleDependencies {
  readonly clock: Clock;
  readonly credentials: AuthenticatedCredential;
  readonly hasher: ContentHasher;
  readonly ids: IdGenerator;
  readonly readOnlyState: ReadOnlyState;
  readonly writer: ArticleWriter;
}

export interface CreateArticleRequest {
  readonly bearerToken: string;
  readonly idempotencyKey: string;
  readonly method: SubmissionMethod;
  readonly rawSubmission: CreateArticleInput;
  readonly requestId: string;
}

export class CreateArticleService {
  readonly #dependencies: CreateArticleDependencies;

  public constructor(dependencies: CreateArticleDependencies) {
    this.#dependencies = dependencies;
  }

  public async execute(request: CreateArticleRequest): Promise<ArticleWriteResult> {
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

    return this.#dependencies.writer.create({
      articleId: this.#dependencies.ids.next(),
      bodyMarkdown: rawSubmission.body_markdown,
      contentDigest: this.#dependencies.hasher.digest([
        rawSubmission.title,
        rawSubmission.body_markdown,
      ]),
      credentialId: credential.id,
      idempotencyKeyDigest: this.#dependencies.hasher.digest(request.idempotencyKey),
      identity: rawSubmission.identity,
      identityFingerprint: this.#dependencies.hasher.digest(rawSubmission.identity),
      instructionSetId: credential.instructionSetId,
      method: request.method,
      operation: "create_article",
      payloadDigest: this.#dependencies.hasher.digest(rawSubmission),
      rawSubmission,
      receivedAt: this.#dependencies.clock.now(),
      requestDigest: this.#dependencies.hasher.digest([
        "create_article",
        rawSubmission,
      ]),
      requestId: request.requestId,
      revisionId: this.#dependencies.ids.next(),
      submissionId: this.#dependencies.ids.next(),
      title: rawSubmission.title,
    });
  }
}
