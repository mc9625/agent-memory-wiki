import { RateLimitExceededError } from "./errors.js";

export type RateLimitSubjectType = "credential" | "network";

export interface RateLimitBucket {
  readonly expiresAt: Date;
  readonly subjectDigest: string;
  readonly subjectType: RateLimitSubjectType;
  readonly windowSeconds: number;
  readonly windowStartedAt: Date;
}

export interface RateLimitRepository {
  consume(bucket: RateLimitBucket): Promise<number>;
  deleteExpired(at: Date): Promise<number>;
}

export interface RateLimitRequest {
  readonly credentialDigest: string;
  readonly credentialLimitPerDay: number;
  readonly credentialLimitPerMinute: number;
  readonly networkDigest: string;
  readonly networkLimitPerMinute: number;
  readonly now: Date;
}

interface RateLimitDependencies {
  readonly repository: RateLimitRepository;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const bucket = (
  subjectType: RateLimitSubjectType,
  subjectDigest: string,
  windowSeconds: number,
  now: Date,
): RateLimitBucket => {
  const windowMilliseconds = windowSeconds * 1_000;
  const windowStartedAt = new Date(
    Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds,
  );
  return {
    expiresAt: new Date(windowStartedAt.getTime() + windowMilliseconds + RETENTION_MS),
    subjectDigest,
    subjectType,
    windowSeconds,
    windowStartedAt,
  };
};

export class RateLimitService {
  readonly #repository: RateLimitRepository;

  public constructor({ repository }: RateLimitDependencies) {
    this.#repository = repository;
  }

  public async consume(request: RateLimitRequest): Promise<void> {
    const counts = await Promise.all([
      this.#repository.consume(bucket("credential", request.credentialDigest, 60, request.now)),
      this.#repository.consume(
        bucket("credential", request.credentialDigest, 86_400, request.now),
      ),
      this.#repository.consume(bucket("network", request.networkDigest, 60, request.now)),
    ]);
    const limits = [
      request.credentialLimitPerMinute,
      request.credentialLimitPerDay,
      request.networkLimitPerMinute,
    ];
    if (counts.some((count, index) => count > (limits[index] ?? 0))) {
      throw new RateLimitExceededError();
    }
  }
}
