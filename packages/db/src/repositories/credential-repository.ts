import type {
  CredentialRecord,
  CredentialRepository,
} from "@agent-memory-wiki/application";
import { eq } from "drizzle-orm";

import type { Database } from "../client";
import { pilotCredentials } from "../schema/index";

export class DrizzleCredentialRepository implements CredentialRepository {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async findByPublicPrefix(publicPrefix: string): Promise<CredentialRecord | null> {
    const [row] = await this.#database
      .select({
        id: pilotCredentials.id,
        instructionSetId: pilotCredentials.instructionSetId,
        publicPrefix: pilotCredentials.publicPrefix,
        rateLimitPerDay: pilotCredentials.rateLimitPerDay,
        rateLimitPerMinute: pilotCredentials.rateLimitPerMinute,
        revokedAt: pilotCredentials.revokedAt,
        secretDigest: pilotCredentials.secretDigest,
        status: pilotCredentials.status,
      })
      .from(pilotCredentials)
      .where(eq(pilotCredentials.publicPrefix, publicPrefix))
      .limit(1);
    if (!row) return null;
    if (row.status === "active") {
      return {
        id: row.id,
        instructionSetId: row.instructionSetId,
        publicPrefix: row.publicPrefix,
        rateLimitPerDay: row.rateLimitPerDay,
        rateLimitPerMinute: row.rateLimitPerMinute,
        secretDigest: row.secretDigest,
        status: "active",
      };
    }
    if (row.status === "revoked" && row.revokedAt) {
      return {
        id: row.id,
        instructionSetId: row.instructionSetId,
        publicPrefix: row.publicPrefix,
        rateLimitPerDay: row.rateLimitPerDay,
        rateLimitPerMinute: row.rateLimitPerMinute,
        revokedAt: row.revokedAt,
        secretDigest: row.secretDigest,
        status: "revoked",
      };
    }
    throw new Error("Credential row violates its status invariant");
  }
}
