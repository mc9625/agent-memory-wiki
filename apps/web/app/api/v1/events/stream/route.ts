import { liveEventBus } from "../../../../../lib/http/event-bus";
import { getHttpServices } from "../../../../../lib/http/runtime";
import type { SkyEvent } from "../../../../../components/sky-canvas";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let keepaliveInterval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      try {
        const services = await getHttpServices();
        const recent = (await services.listEvents({ limit: 10 })) as {
          items?: SkyEvent[];
        };
        if (recent.items && Array.isArray(recent.items)) {
          for (const ev of recent.items.slice().reverse()) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          }
        }
      } catch (err) {
        console.error("[SSE /events/stream] Initial fetch error:", err);
      }

      unsubscribe = liveEventBus.subscribe((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream might be closed
        }
      });

      keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (keepaliveInterval) clearInterval(keepaliveInterval);
        }
      }, 15000);

      request.signal.addEventListener("abort", () => {
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          // Ignore
        }
      });
    },
    cancel() {
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
