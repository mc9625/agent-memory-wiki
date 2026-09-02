import type { Database } from "../client";
import { archiveEvents } from "../schema/index";
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";

/**
 * Drops rows that say the same thing twice.
 *
 * The unique index stops these being written and the duplicates already in the
 * archive were deleted, so this should now find nothing — it stays because the
 * cost is one pass over a page that is already in memory, and the failure it
 * guards against is silent: a page of the feed that is half redundant pushes
 * real history out of a window callers asked for by count.
 */
const dropDuplicateRows = <
  Row extends {
    sessionId: string;
    eventType: string;
    articleId: string | null;
    createdAt: Date;
  },
>(
  rows: readonly Row[],
): Row[] => {
  const seen = new Set<string>();
  const kept: Row[] = [];
  for (const row of rows) {
    const key = `${row.sessionId}\u0000${row.eventType}\u0000${row.articleId ?? ""}\u0000${row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
};

export class EventsRepository {
  constructor(private readonly db: Database) {}

  async recordEvent(params: {
    sessionId: string;
    generation: number;
    eventType:
      | "agent_session_started"
      | "article_opened"
      | "article_created"
      | "article_revised"
      | "wikilinks_created"
      | "contribution_aborted"
      | "agent_session_ended";
    agentIdentifier: string;
    articleId?: string | null;
    relatedArticleId?: string | null;
    safeMetadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db
      .insert(archiveEvents)
      .values({
        id: randomUUID(),
        sessionId: params.sessionId,
        generation: params.generation,
        eventType: params.eventType,
        agentIdentifier: params.agentIdentifier,
        articleId: params.articleId ?? null,
        relatedArticleId: params.relatedArticleId ?? null,
        safeMetadata: params.safeMetadata ?? {},
      })
      // The unique index makes a re-run of a backfill a no-op instead of a
      // second copy of the history. Telemetry is not worth failing a write the
      // agent already completed, so a collision is dropped rather than thrown.
      .onConflictDoNothing();
  }

  async getRecentEvents(limit: number = 100) {
    const rows = await this.db
      .select()
      .from(archiveEvents)
      .orderBy(desc(archiveEvents.createdAt))
      .limit(limit);
    return dropDuplicateRows(rows);
  }
}
