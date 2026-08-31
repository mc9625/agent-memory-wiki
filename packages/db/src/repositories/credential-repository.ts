import { createHash } from "node:crypto";
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
    if (existing && existing.status === "active") {
      return existing;
    }

    const defaultInstructionId = "00000000-0000-4000-8000-000000000001";
    const initialContent = "Autonomous memory and conceptual archive for AI agents.";
    const initialDigest = new Uint8Array(
      createHash("sha256").update(initialContent, "utf8").digest()
    );
    const dummyDigest = new Uint8Array(
      createHash("sha256").update("pilot_public:open_agent_memory_wiki:fixed_secret_key").digest()
    );

    // 1. Ensure at least one instruction set exists
    try {
      await this.#database.execute(sql`
        INSERT INTO instruction_sets (id, version, content, content_sha256)
        VALUES (${defaultInstructionId}::uuid, 1, ${initialContent}, ${initialDigest})
        ON CONFLICT DO NOTHING
      `);
    } catch {
      // Ignore
    }

    // 2. Fetch the actual existing instruction set ID
    const insRows = await this.#database.execute<{ id: string }>(sql`
      SELECT id::text FROM instruction_sets ORDER BY created_at ASC LIMIT 1
    `);
    const validInstructionId = insRows[0]?.id ?? defaultInstructionId;

    // 3. Upsert pilot_public credential ensuring instruction_set_id references validInstructionId
    const publicId = "00000000-0000-0000-0000-000000000001";
    try {
      await this.#database.execute(sql`
        INSERT INTO pilot_credentials (
          id, instruction_set_id, operator_label, public_prefix,
          rate_limit_per_day, rate_limit_per_minute, secret_digest,
          status, terms_accepted_at, terms_version
        ) VALUES (
          ${publicId}::uuid,
          ${validInstructionId}::uuid,
          'Open Public Agents',
          'pilot_public',
          5000,
          120,
          ${dummyDigest},
          'active',
          '2026-01-01T00:00:00Z',
          'v1.0'
        )
        ON CONFLICT (public_prefix) DO UPDATE
        SET instruction_set_id = ${validInstructionId}::uuid, status = 'active'
      `);
    } catch {
      // Ignore
    }

    const found = await this.findByPublicPrefix("pilot_public");
    if (found) return found;

    return {
      id: publicId,
      instructionSetId: validInstructionId,
      publicPrefix: "pilot_public",
      rateLimitPerDay: 5000,
      rateLimitPerMinute: 120,
      secretDigest: dummyDigest,
      status: "active",
    };
  }
}
