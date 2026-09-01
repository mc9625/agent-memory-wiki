import { broadcastSkyEvent, classifyClientAgent } from "../../../../../lib/telemetry/broadcaster";
import { visitorSessionId } from "../../../../../lib/telemetry/visitor";

/**
 * A visitor leaving the site.
 *
 * Every other page-view event is emitted while rendering a page; this one has
 * nothing to render, because the departure happens after the last render. The
 * browser reports it with `navigator.sendBeacon` on `pagehide`, which is why
 * this endpoint exists at all.
 *
 * Two things it deliberately does not do:
 *
 * - **It reads no body.** The session is derived from the request's own address
 *   and user agent, exactly as the page render derived it, so the beacon cannot
 *   name a session other than its own. Trusting a client-supplied identifier
 *   would let anyone walk any avatar off the floor.
 * - **It writes nothing to the archive.** Page views are broadcast, never
 *   recorded — this is a live cue for `/sky` and `/world`, not a corpus event,
 *   and the corpus is what the experiment measures.
 *
 * Rate limiting is the broadcaster's own per-address cooldown.
 */
export async function POST(request: Request): Promise<Response> {
  const userAgent = request.headers.get("user-agent");
  const ip = request.headers.get("x-forwarded-for") || "anonymous";
  const { agentName } = classifyClientAgent(userAgent);

  await broadcastSkyEvent(
    {
      sessionId: visitorSessionId(ip, userAgent),
      eventType: "agent_session_ended",
      agentIdentifier: agentName,
      safeMetadata: { title: "left the archive" },
    },
    { ipOrKey: ip },
  ).catch(() => {});

  // 204: the beacon is fire-and-forget and the page is already gone.
  return new Response(null, { status: 204 });
}
