import { eq, sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  DrizzleArticleReader,
  instructionSetActivationEvents,
  instructionSets,
  probeDatabaseReadiness,
  systemSettings,
} from "../src/index";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://wiki_owner:wiki_owner@localhost:55432/wiki_test";

const sql = postgres(databaseUrl, { max: 1 });

afterAll(async () => {
  await sql.end();
});

describe("initial PostgreSQL schema", () => {
  it("applies bounded statement, lock, and idle transaction timeouts", async () => {
    const database = createDatabase({ maxConnections: 1, url: databaseUrl });
    try {
      const rows = await database.db.execute<{
        idle_timeout: string;
        lock_timeout: string;
        statement_timeout: string;
      }>(drizzleSql`
        SELECT current_setting('statement_timeout') AS statement_timeout,
               current_setting('lock_timeout') AS lock_timeout,
               current_setting('idle_in_transaction_session_timeout') AS idle_timeout
      `);
      expect(rows[0]).toMatchObject({
        idle_timeout: "10s",
        lock_timeout: "2s",
        statement_timeout: "5s",
      });
    } finally {
      await database.close();
    }
  });

  it("creates every approved public table", async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    expect(rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "agent_identities",
        "article_state_events",
        "articles",
        "audit_events",
        "idempotency_records",
        "instruction_set_activation_events",
        "instruction_sets",
        "pilot_credentials",
        "rate_limit_buckets",
        "revision_state_events",
        "revisions",
        "submission_outcome_events",
        "submissions",
        "system_settings",
      ]),
    );
  });

  it("stores no plaintext pilot credential column", async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pilot_credentials'
    `;

    const columnNames = rows.map(({ column_name }) => column_name);
    expect(columnNames).toContain("public_prefix");
    expect(columnNames).toContain("secret_digest");
    expect(columnNames).not.toEqual(
      expect.arrayContaining(["secret", "api_key", "token", "credential"]),
    );
  });

  it("links current and parent revisions with foreign keys", async () => {
    const rows = await sql<
      { constraint_name: string; table_name: string; column_name: string }[]
    >`
      SELECT tc.constraint_name, tc.table_name, kcu.column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.constraint_schema = kcu.constraint_schema
      WHERE tc.constraint_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND (
          (tc.table_name = 'articles' AND kcu.column_name = 'current_revision_id')
          OR
          (tc.table_name = 'revisions' AND kcu.column_name = 'parent_revision_id')
        )
    `;

    expect(rows.map(({ constraint_name }) => constraint_name)).toEqual(
      expect.arrayContaining([
        "articles_current_revision_same_article_fk",
        "revisions_parent_revision_id_revisions_id_fk",
        "revisions_parent_same_article_fk",
      ]),
    );
  });

  it("defines the slug and exact-content indexes", async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
    `;

    const indexNames = rows.map(({ indexname }) => indexname);
    expect(indexNames).toContain("articles_slug_unique");
    expect(indexNames).toContain("revisions_content_sha256_idx");
  });

  it("does not cascade-delete provenance foreign keys", async () => {
    const rows = await sql<{ constraint_name: string }[]>`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE contype = 'f'
        AND connamespace = 'public'::regnamespace
        AND confdeltype = 'c'
    `;

    expect(rows).toEqual([]);
  });

  it("denies revision mutation to the runtime role", async () => {
    const rows = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'wiki_runtime'
        AND table_schema = 'public'
        AND table_name = 'revisions'
    `;

    const privileges = rows.map(({ privilege_type }) => privilege_type);
    expect(privileges).toContain("INSERT");
    expect(privileges).toContain("SELECT");
    expect(privileges).not.toContain("UPDATE");
    expect(privileges).not.toContain("DELETE");
    expect(privileges).not.toContain("TRUNCATE");
  });

  it("separates runtime and administrative database capabilities", async () => {
    const [permissions] = await sql<{
      admin_can_activate: boolean;
      admin_can_update_revisions: boolean;
      runtime_can_insert_credentials: boolean;
      runtime_can_delete_idempotency: boolean;
      runtime_can_delete_rate_limits: boolean;
      runtime_can_read_migrations: boolean;
      runtime_can_update_idempotency: boolean;
      runtime_can_update_rate_limits: boolean;
      runtime_can_update_current_revision: boolean;
      runtime_can_update_slug: boolean;
    }[]>`
      SELECT
        has_table_privilege(
          'wiki_runtime',
          'drizzle.__drizzle_migrations',
          'SELECT'
        ) AS runtime_can_read_migrations,
        has_table_privilege(
          'wiki_runtime',
          'public.pilot_credentials',
          'INSERT'
        ) AS runtime_can_insert_credentials,
        has_table_privilege('wiki_runtime', 'public.idempotency_records', 'DELETE')
          AS runtime_can_delete_idempotency,
        has_table_privilege('wiki_runtime', 'public.rate_limit_buckets', 'DELETE')
          AS runtime_can_delete_rate_limits,
        has_table_privilege('wiki_runtime', 'public.idempotency_records', 'UPDATE')
          AS runtime_can_update_idempotency,
        has_column_privilege('wiki_runtime', 'public.rate_limit_buckets', 'request_count', 'UPDATE')
          AS runtime_can_update_rate_limits,
        has_column_privilege(
          'wiki_runtime',
          'public.articles',
          'current_revision_id',
          'UPDATE'
        ) AS runtime_can_update_current_revision,
        has_column_privilege(
          'wiki_runtime',
          'public.articles',
          'slug',
          'UPDATE'
        ) AS runtime_can_update_slug,
        has_table_privilege(
          'wiki_admin',
          'public.instruction_set_activation_events',
          'INSERT'
        ) AS admin_can_activate,
        has_table_privilege(
          'wiki_admin',
          'public.revisions',
          'UPDATE'
        ) AS admin_can_update_revisions
    `;
    expect(permissions).toEqual({
      admin_can_activate: true,
      admin_can_update_revisions: false,
      runtime_can_insert_credentials: false,
      runtime_can_delete_idempotency: false,
      runtime_can_delete_rate_limits: false,
      runtime_can_read_migrations: true,
      runtime_can_update_idempotency: false,
      runtime_can_update_rate_limits: true,
      runtime_can_update_current_revision: true,
      runtime_can_update_slug: false,
    });
  });

  it("keeps a draft instruction private until an explicit activation event", async () => {
    const database = createDatabase({ maxConnections: 1, url: databaseUrl });
    const instructionId = "e9c53c7f-9063-411e-bc23-cc0cf9a2a063";
    const activationId = "80cb7e78-4ec0-41f6-890d-0fe87f787d17";
    try {
      await database.db.insert(instructionSets).values({
        content: "Synthetic inactive instruction",
        contentSha256: Buffer.alloc(32, 12),
        createdAt: new Date("2026-08-20T01:00:00Z"),
        id: instructionId,
        version: 2,
      });
      const reader = new DrizzleArticleReader(database.db);
      await expect(reader.currentInstruction()).resolves.toMatchObject({ version: 1 });

      await database.db.insert(instructionSetActivationEvents).values({
        actorType: "admin",
        createdAt: new Date("2026-08-20T02:00:00Z"),
        id: activationId,
        instructionSetId: instructionId,
        reasonCode: "TEST_ACTIVATION",
      });
      await expect(reader.currentInstruction()).resolves.toEqual({
        content: "Synthetic inactive instruction",
        version: 2,
      });
    } finally {
      await database.db
        .delete(instructionSetActivationEvents)
        .where(eq(instructionSetActivationEvents.id, activationId));
      await database.db.delete(instructionSets).where(eq(instructionSets.id, instructionId));
      await database.close();
    }
  });

  it("recognizes the exact applied migration as release-compatible", async () => {
    const database = createDatabase({ maxConnections: 1, url: databaseUrl });
    try {
      await database.db
        .insert(systemSettings)
        .values({ singleton: true, readOnly: false, settingsVersion: 1 })
        .onConflictDoUpdate({
          target: systemSettings.singleton,
          set: { readOnly: false, settingsVersion: 1 },
        });
      await expect(probeDatabaseReadiness(database.db)).resolves.toEqual({
        migrationsCompatible: true,
        readOnly: false,
      });
    } finally {
      await database.close();
    }
  });
});
