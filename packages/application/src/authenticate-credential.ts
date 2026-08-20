import { createHmac, timingSafeEqual } from "node:crypto";

import type { PilotCredential } from "@agent-memory-wiki/domain";

import { InvalidCredentialError } from "./errors.js";

export type CredentialRecord = Readonly<{
  id: string;
  instructionSetId: string;
  publicPrefix: string;
  rateLimitPerDay: number;
  rateLimitPerMinute: number;
  secretDigest: Uint8Array;
}> &
  (
    | Readonly<{ status: "active" }>
    | Readonly<{ revokedAt: Date; status: "revoked" }>
  );

export interface CredentialRepository {
  findByPublicPrefix(publicPrefix: string): Promise<CredentialRecord | null>;
}

interface CredentialAuthenticatorDependencies {
  readonly digestKey: Uint8Array;
  readonly repository: CredentialRepository;
}

const tokenPattern = /^(pilot_[A-Za-z0-9_-]{4,14})\.([A-Za-z0-9_-]{20,})$/u;

export class CredentialAuthenticator {
  readonly #digestKey: Uint8Array;
  readonly #repository: CredentialRepository;

  public constructor({ digestKey, repository }: CredentialAuthenticatorDependencies) {
    if (digestKey.byteLength < 32) throw new Error("Credential digest key must be 32 bytes.");
    this.#digestKey = digestKey;
    this.#repository = repository;
  }

  public async authenticate(bearerToken: string): Promise<PilotCredential> {
    const match = tokenPattern.exec(bearerToken);
    const publicPrefix = match?.[1] ?? "pilot_invalid";
    const record = match ? await this.#repository.findByPublicPrefix(publicPrefix) : null;
    const expected = record?.secretDigest ?? new Uint8Array(32);
    const actual = new Uint8Array(
      createHmac("sha256", this.#digestKey).update(bearerToken, "utf8").digest(),
    );
    const digestMatches =
      expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);

    if (!record || !digestMatches || record.status !== "active") {
      throw new InvalidCredentialError();
    }

    return Object.freeze({
      id: record.id,
      instructionSetId: record.instructionSetId,
      status: "active" as const,
    });
  }
}
