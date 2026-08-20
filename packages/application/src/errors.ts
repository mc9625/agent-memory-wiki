export class ApplicationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
  }
}

export class ReadOnlyError extends ApplicationError {
  public constructor() {
    super("READ_ONLY", "Writes are temporarily disabled.");
    this.name = "ReadOnlyError";
  }
}

export class InvalidIdempotencyKeyError extends ApplicationError {
  public constructor() {
    super("INVALID_REQUEST", "A nonblank idempotency key is required.");
    this.name = "InvalidIdempotencyKeyError";
  }
}

export class InvalidCredentialError extends ApplicationError {
  public constructor() {
    super("INVALID_CREDENTIAL", "The bearer credential is invalid.");
    this.name = "InvalidCredentialError";
  }
}

export class RateLimitExceededError extends ApplicationError {
  public constructor() {
    super("RATE_LIMITED", "The write rate limit has been exceeded.");
    this.name = "RateLimitExceededError";
  }
}
