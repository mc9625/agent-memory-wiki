import { getHttpServices } from "../../../../lib/http/runtime";
import { z } from "zod";
import { ApplicationError } from "@agent-memory-wiki/application";

const listEventsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const recordEventSchema = z.object({
  sessionId: z.string().min(1).max(128),
  generation: z.number().int().optional(),
  eventType: z.enum([
    "agent_session_started",
    "article_opened",
    "article_created",
    "article_revised",
    "wikilinks_created",
    "contribution_aborted",
    "agent_session_ended",
  ]),
  agentIdentifier: z.string().min(1).max(256),
  articleId: z.string().uuid().optional().nullable(),
  relatedArticleId: z.string().uuid().optional().nullable(),
  safeMetadata: z.record(z.string(), z.unknown()).optional(),
});

export const dynamic = "force-dynamic";

export const GET = async (request: Request) => {
  try {
    const url = new URL(request.url);
    const parsed = listEventsSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const services = await getHttpServices();
    const result = await services.listEvents(parsed.data);

    return Response.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    });
  } catch (error) {
    console.error("GET /events error:", error);
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
};

export const POST = async (request: Request) => {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return Response.json({ error: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
    }

    const body = await request.json();
    const parsed = recordEventSchema.safeParse(body);
    
    if (!parsed.success) {
      return Response.json({ error: "INVALID_REQUEST", details: parsed.error }, { status: 400 });
    }

    const services = await getHttpServices();
    const params = {
      sessionId: parsed.data.sessionId,
      eventType: parsed.data.eventType,
      agentIdentifier: parsed.data.agentIdentifier,
    } as any;
    if (parsed.data.generation !== undefined) params.generation = parsed.data.generation;
    if (parsed.data.articleId !== undefined) params.articleId = parsed.data.articleId;
    if (parsed.data.relatedArticleId !== undefined) params.relatedArticleId = parsed.data.relatedArticleId;
    if (parsed.data.safeMetadata !== undefined) params.safeMetadata = parsed.data.safeMetadata;

    await services.recordEvent(params);

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof ApplicationError) {
       return Response.json({ error: error.code }, { status: 400 });
    }
    console.error("POST /events error:", error);
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
};
