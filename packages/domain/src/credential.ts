import { DomainInvariantError } from "./errors";

export type PilotCredential =
  | Readonly<{
      id: string;
      instructionSetId: string;
      status: "active";
    }>
  | Readonly<{
      id: string;
      instructionSetId: string;
      status: "revoked";
      revokedAt: Date;
    }>;

type PilotCredentialInput =
  | Readonly<{
      id: string;
      instructionSetId: string;
      status: "active";
      revokedAt?: never;
    }>
  | Readonly<{
      id: string;
      instructionSetId: string;
      status: "revoked";
      revokedAt: Date;
    }>;

export const createPilotCredential = (input: PilotCredentialInput): PilotCredential => {
  if (!input.id || !input.instructionSetId) {
    throw new DomainInvariantError("A credential requires ids");
  }

  return Object.freeze({ ...input });
};

export const assertCredentialCanWrite = (
  credential: PilotCredential,
): Extract<PilotCredential, { status: "active" }> => {
  if (credential.status === "revoked") {
    throw new DomainInvariantError("The pilot credential is revoked", "CREDENTIAL_REVOKED");
  }

  return credential;
};

export const revokeCredential = (
  credential: PilotCredential,
  revokedAt: Date,
): Extract<PilotCredential, { status: "revoked" }> => {
  if (credential.status === "revoked") {
    throw new DomainInvariantError("The pilot credential is already revoked");
  }

  return Object.freeze({ ...credential, status: "revoked" as const, revokedAt });
};
