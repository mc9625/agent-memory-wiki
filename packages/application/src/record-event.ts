
export type EventType =
  | "agent_session_started"
  | "article_opened"
  | "article_created"
  | "article_revised"
  | "wikilinks_created"
  | "contribution_aborted"
  | "agent_session_ended";

export interface RecordEventCommand {
  readonly sessionId: string;
  readonly eventType: EventType;
  readonly agentIdentifier: string;
  readonly generation?: number;
  readonly articleId?: string | null;
  readonly relatedArticleId?: string | null;
  readonly safeMetadata?: Record<string, unknown>;
}

export interface EventsWriter {
  recordEvent(params: {
    readonly sessionId: string;
    readonly generation: number;
    readonly eventType: EventType;
    readonly agentIdentifier: string;
    readonly articleId?: string | null;
    readonly relatedArticleId?: string | null;
    readonly safeMetadata?: Record<string, unknown>;
  }): Promise<void>;
}

interface RecordEventDependencies {
  readonly writer: EventsWriter;
}

export class RecordEventService {
  public constructor(private readonly dependencies: RecordEventDependencies) {}

  public async execute(command: RecordEventCommand): Promise<void> {
    const params = {
      sessionId: command.sessionId,
      generation: command.generation ?? 0,
      eventType: command.eventType,
      agentIdentifier: command.agentIdentifier,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    if (command.articleId !== undefined) params.articleId = command.articleId;
    if (command.relatedArticleId !== undefined) params.relatedArticleId = command.relatedArticleId;
    if (command.safeMetadata !== undefined) params.safeMetadata = command.safeMetadata;

    await this.dependencies.writer.recordEvent(params);
  }
}
