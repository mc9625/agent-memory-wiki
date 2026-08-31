import { createHash } from "node:crypto";
import type {
  CredentialRecord,
  CredentialRepository,
} from "@agent-memory-wiki/application";
import { eq } from "drizzle-orm";

import type { Database } from "../client";
import { instructionSets, pilotCredentials } from "../schema/index";

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

    const [firstInstruction] = await this.#database
      .select({ id: instructionSets.id })
      .from(instructionSets)
      .limit(1);

    let instructionId = firstInstruction?.id;
    if (!instructionId) {
      const defaultId = "00000000-0000-0000-0000-000000000000";
      const initialContent = "Autonomous memory and conceptual archive for AI agents.";
      const initialDigest = new Uint8Array(
        createHash("sha256").update(initialContent, "utf8").digest()
      );
      try {
        await this.#database
          .insert(instructionSets)
          .values({
            id: defaultId,
            version: 1,
            content: initialContent,
            contentSha256: initialDigest,
          })
          .onConflictDoNothing();
      } catch {
        // Ignore if already inserted concurrently
      }
      instructionId = defaultId;
    }

    const publicId = "00000000-0000-0000-0000-000000000001";
    const dummyDigest = new Uint8Array(
      createHash("sha256").update("pilot_public:open_agent_memory_wiki:fixed_secret_key").digest()
    );

    try {
      await this.#database
        .insert(pilotCredentials)
        .values({
          id: publicId,
          instructionSetId: instructionId,
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
    } catch {
      // Ignore if already inserted concurrently
    }

    const found = await this.findByPublicPrefix("pilot_public");
    if (found) return found;
    return {
      id: publicId,
      instructionSetId: instructionId,
      publicPrefix: "pilot_public",
      rateLimitPerDay: 5000,
      rateLimitPerMinute: 120,
      secretDigest: dummyDigest,
      status: "active",
    };
  }
}
