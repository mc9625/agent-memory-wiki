export type DomainErrorCode =
  | "DOMAIN_INVARIANT"
  | "REVISION_CONFLICT"
  | "CREDENTIAL_REVOKED";

export class DomainInvariantError extends Error {
  public readonly code: DomainErrorCode;

  public constructor(message: string, code: DomainErrorCode = "DOMAIN_INVARIANT") {
    super(message);
    this.name = "DomainInvariantError";
    this.code = code;
  }
}

export class RevisionConflictError extends DomainInvariantError {
  public constructor() {
    super(
      "The article has changed since the supplied parent revision.",
      "REVISION_CONFLICT",
    );
    this.name = "RevisionConflictError";
  }
}
