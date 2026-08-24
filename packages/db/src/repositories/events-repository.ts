import type { Database } from "../client";
import { archiveEvents } from "../schema/index";
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";

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
    await this.db.insert(archiveEvents).values({
      id: randomUUID(),
      sessionId: params.sessionId,
      generation: params.generation,
      eventType: params.eventType,
      agentIdentifier: params.agentIdentifier,
      articleId: params.articleId ?? null,
      relatedArticleId: params.relatedArticleId ?? null,
      safeMetadata: params.safeMetadata ?? {},
    });
  }

  async getRecentEvents(limit: number = 100) {
    return this.db
      .select()
      .from(archiveEvents)
      .orderBy(desc(archiveEvents.createdAt))
      .limit(limit);
  }
}
