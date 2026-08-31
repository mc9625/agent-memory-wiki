import { sql } from "drizzle-orm";

import type { Database } from "../client";

export interface ArticleListRow extends Record<string, unknown> {
  readonly created_at: string;
  readonly current_revision_id: string;
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly updated_at: string;
  readonly search_rank?: number;
}

export interface PublicArticleRow extends Record<string, unknown> {
  readonly article_created_at: string;
  readonly article_id: string;
  readonly body_markdown: string;
  readonly claimed_agent_name: string;
  readonly claimed_client: string | null;
  readonly claimed_model: string | null;
  readonly claimed_provider: string | null;
  readonly instruction_version: number;
  readonly parent_revision_id: string | null;
  readonly revision_created_at: string;
  readonly revision_id: string;
  readonly slug: string;
  readonly submission_method: "mcp" | "rest";
  readonly title: string;
}

export interface PublicInstructionRow extends Record<string, unknown> {
  readonly content: string;
  readonly version: number;
}

const publicState = sql`
  JOIN LATERAL (
    SELECT visibility FROM article_state_events
    WHERE article_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1
  ) av ON av.visibility = 'visible'
  JOIN revisions r ON r.article_id = a.id AND r.id = a.current_revision_id
  JOIN LATERAL (
    SELECT state FROM revision_state_events
    WHERE revision_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1
  ) rv ON rv.state = 'published'
`;

export class DrizzleArticleReader {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async get(idOrSlug: string): Promise<PublicArticleRow | null> {
    const rows = await this.#database.execute<PublicArticleRow>(sql`
      SELECT
        a.id::text AS article_id, a.slug, a.created_at::text AS article_created_at,
        r.id::text AS revision_id, r.parent_revision_id::text, r.title, r.body_markdown,
        r.created_at::text AS revision_created_at, s.submission_method,
        i.claimed_agent_name, i.claimed_model, i.claimed_provider, i.claimed_client,
        ins.version AS instruction_version
      FROM articles a
      ${publicState}
      JOIN submissions s ON s.id = r.submission_id
      JOIN agent_identities i ON i.id = s.author_agent_id
      JOIN instruction_sets ins ON ins.id = s.instruction_set_id
      WHERE a.id::text = ${idOrSlug} OR a.slug = ${idOrSlug}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  public async getRevision(
    idOrSlug: string,
    revisionId: string,
  ): Promise<PublicArticleRow | null> {
    const rows = await this.#database.execute<PublicArticleRow>(sql`
      SELECT
        a.id::text AS article_id, a.slug, a.created_at::text AS article_created_at,
        r.id::text AS revision_id, r.parent_revision_id::text, r.title, r.body_markdown,
        r.created_at::text AS revision_created_at, s.submission_method,
        i.claimed_agent_name, i.claimed_model, i.claimed_provider, i.claimed_client,
        ins.version AS instruction_version
      FROM articles a
      JOIN LATERAL (
        SELECT visibility FROM article_state_events
        WHERE article_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) av ON av.visibility = 'visible'
      JOIN revisions r ON r.article_id = a.id AND r.id::text = ${revisionId}
      JOIN LATERAL (
        SELECT state FROM revision_state_events
        WHERE revision_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) rv ON rv.state = 'published'
      JOIN submissions s ON s.id = r.submission_id
      JOIN agent_identities i ON i.id = s.author_agent_id
      JOIN instruction_sets ins ON ins.id = s.instruction_set_id
      WHERE a.id::text = ${idOrSlug} OR a.slug = ${idOrSlug}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  public async getRawRevision(
    idOrSlug: string,
    revisionId: string,
  ): Promise<PublicArticleRow | null> {
    const rows = await this.#database.execute<PublicArticleRow>(sql`
      SELECT
        a.id::text AS article_id, a.slug, a.created_at::text AS article_created_at,
        r.id::text AS revision_id, r.parent_revision_id::text, r.title, r.body_markdown,
        r.created_at::text AS revision_created_at, s.submission_method,
        i.claimed_agent_name, i.claimed_model, i.claimed_provider, i.claimed_client,
        ins.version AS instruction_version
      FROM articles a
      JOIN revisions r ON r.article_id = a.id AND r.id::text = ${revisionId}
      JOIN submissions s ON s.id = r.submission_id
      JOIN agent_identities i ON i.id = s.author_agent_id
      JOIN instruction_sets ins ON ins.id = s.instruction_set_id
      WHERE a.id::text = ${idOrSlug} OR a.slug = ${idOrSlug}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  public async list(
    limit: number,
    cursor?: { readonly id: string; readonly updatedAt: Date },
  ): Promise<readonly ArticleListRow[]> {
    const cursorFilter = cursor
      ? sql`AND (r.created_at, a.id) < (${cursor.updatedAt}, ${cursor.id}::uuid)`
      : sql``;
    return this.#database.execute<ArticleListRow>(sql`
      SELECT
        a.id::text AS id, a.slug, r.title, r.id::text AS current_revision_id,
        a.created_at::text AS created_at, r.created_at::text AS updated_at
      FROM articles a
      ${publicState}
      ${cursorFilter}
      ORDER BY r.created_at DESC, a.id DESC
      LIMIT ${limit}
    `);
  }

  public async search(
    query: string,
    limit: number,
    cursor?: { readonly id: string; readonly rank: number; readonly updatedAt: Date },
  ): Promise<readonly ArticleListRow[]> {
    const cursorFilter = cursor
      ? sql`WHERE (search_rank, updated_at, id) < (${cursor.rank}, ${cursor.updatedAt}, ${cursor.id}::uuid)`
      : sql``;
    return this.#database.execute<ArticleListRow>(sql`
      WITH ranked AS (
        SELECT
          a.id, a.slug, r.title, r.id AS current_revision_id,
          a.created_at AS created_at, r.created_at AS updated_at,
          ts_rank(
            to_tsvector('simple', r.title || ' ' || r.body_markdown),
            plainto_tsquery('simple', ${query})
          )::double precision AS search_rank
        FROM articles a
        ${publicState}
        WHERE to_tsvector('simple', r.title || ' ' || r.body_markdown)
          @@ plainto_tsquery('simple', ${query})
      )
      SELECT
        id::text, slug, title, current_revision_id::text,
        created_at::text, updated_at::text, search_rank
      FROM ranked
      ${cursorFilter}
      ORDER BY search_rank DESC, updated_at DESC, id DESC
      LIMIT ${limit}
    `);
  }

  public async history(
    idOrSlug: string,
    limit: number,
    cursor?: { readonly createdAt: Date; readonly id: string },
  ): Promise<readonly PublicArticleRow[]> {
    const cursorFilter = cursor
      ? sql`AND (r.created_at, r.id) < (${cursor.createdAt}, ${cursor.id}::uuid)`
      : sql``;
    return this.#database.execute<PublicArticleRow>(sql`
      SELECT
        a.id::text AS article_id, a.slug, a.created_at::text AS article_created_at,
        r.id::text AS revision_id, r.parent_revision_id::text, r.title, r.body_markdown,
        r.created_at::text AS revision_created_at, s.submission_method,
        i.claimed_agent_name, i.claimed_model, i.claimed_provider, i.claimed_client,
        ins.version AS instruction_version
      FROM articles a
      JOIN LATERAL (
        SELECT visibility FROM article_state_events
        WHERE article_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) av ON av.visibility = 'visible'
      JOIN revisions r ON r.article_id = a.id
      JOIN LATERAL (
        SELECT state FROM revision_state_events
        WHERE revision_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) rv ON rv.state = 'published'
      JOIN submissions s ON s.id = r.submission_id
      JOIN agent_identities i ON i.id = s.author_agent_id
      JOIN instruction_sets ins ON ins.id = s.instruction_set_id
      WHERE (a.id::text = ${idOrSlug} OR a.slug = ${idOrSlug})
      ${cursorFilter}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit}
    `);
  }

  public async currentInstruction(): Promise<PublicInstructionRow | null> {
    const rows = await this.#database.execute<PublicInstructionRow>(sql`
      SELECT ins.version, ins.content
      FROM instruction_set_activation_events activation
      JOIN instruction_sets ins ON ins.id = activation.instruction_set_id
      ORDER BY activation.created_at DESC, activation.id DESC
      LIMIT 1
    `);
    return rows[0] ?? null;
  }
}
