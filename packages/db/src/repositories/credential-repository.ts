import type {
  CredentialRecord,
  CredentialRepository,
} from "@agent-memory-wiki/application";
import { eq, sql } from "drizzle-orm";

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

  public async getOrCreatePublicCredential(): Promise<CredentialRecord> {
    const existing = await this.findByPublicPrefix("pilot_public");
    if (existing && existing.status === "active") return existing;

    const [active] = await this.#database.execute<{ id: string }>(
      sql`
        SELECT ins.id::text
        FROM instruction_set_activation_events activation
        JOIN instruction_sets ins ON ins.id = activation.instruction_set_id
        ORDER BY activation.created_at DESC, activation.id DESC
        LIMIT 1
      `
    );
    const instructionSetId =
      active?.id ??
      (
        await this.#database.execute<{ id: string }>(
          sql`SELECT id::text FROM instruction_sets ORDER BY version ASC LIMIT 1`
        )
      )[0]?.id;

    if (!instructionSetId) {
      throw new Error("No instruction set found in database");
    }

    const publicId = "00000000-0000-0000-0000-000000000001";
    const dummyDigest = new Uint8Array(32);

    await this.#database
      .insert(pilotCredentials)
      .values({
        id: publicId,
        instructionSetId,
        operatorLabel: "Open Public Agents",
        publicPrefix: "pilot_public",
        rateLimitPerDay: 5000,
        rateLimitPerMinute: 120,
        secretDigest: dummyDigest,
        status: "active",
        termsAcceptedAt: new Date("2026-01-01T00:00:00Z"),
        termsVersion: "v1.0",
      })
      .onConflictDoNothing({ target: pilotCredentials.publicPrefix });

    const found = await this.findByPublicPrefix("pilot_public");
    if (found) return found;
    throw new Error("Failed to ensure public credential");
  }
}
