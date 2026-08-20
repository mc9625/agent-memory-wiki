import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://wiki_owner:wiki_owner@localhost:55432/wiki_test";

const sql = postgres(databaseUrl, { max: 1 });

afterAll(async () => {
  await sql.end();
});

describe("initial PostgreSQL schema", () => {
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
        "articles_current_revision_id_revisions_id_fk",
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
});
