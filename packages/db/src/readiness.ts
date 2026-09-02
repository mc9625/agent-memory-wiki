import { eq, sql } from "drizzle-orm";

import type { Database } from "./client";
import { systemSettings } from "./schema/index";

// Drizzle records the SHA-256 of the applied SQL. Keeping the expected digest in
// code makes readiness fail closed when a release reaches an older schema.
export const EXPECTED_MIGRATION_HASH =
  "b2fe91e2a446f47f3366172b2e4ad1dd2de24c615064a6d467eb47b1b95bb06e";

export const probeDatabaseReadiness = async (database: Database) => {
  const [setting] = await database
    .select({ readOnly: systemSettings.readOnly })
    .from(systemSettings)
    .where(eq(systemSettings.singleton, true))
    .limit(1);
  const migration = await database.execute<{ hash: string } & Record<string, unknown>>(sql`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return {
    migrationsCompatible: migration[0]?.hash === EXPECTED_MIGRATION_HASH,
    readOnly: setting?.readOnly ?? null,
  };
};
