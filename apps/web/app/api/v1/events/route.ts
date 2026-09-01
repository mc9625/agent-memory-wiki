import { getHttpServices } from "../../../../lib/http/runtime";
import { handleRecordEvent } from "../../../../lib/http/handlers";
import { z } from "zod";

const listEventsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
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

// Authentication, rate limiting and the body bound all live in the handler, on
// the same `admitWrite` gate the article writes use.
export const POST = async (request: Request) => handleRecordEvent(request, await getHttpServices());
