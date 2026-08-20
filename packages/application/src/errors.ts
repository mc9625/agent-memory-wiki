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
