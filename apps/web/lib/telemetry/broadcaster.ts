import { randomUUID } from "node:crypto";
import { liveEventBus } from "../http/event-bus";
import type { SkyEvent } from "../../components/sky-canvas";

export const SKY_TELEMETRY_TOPIC =
  process.env.NEXT_PUBLIC_SKY_TELEMETRY_TOPIC || "amw-sky-telemetry-mc9625";

// Rate limiting & Debounce state (in-memory per serverless instance)
const rateLimitState = {
  windowStart: Date.now(),
  count: 0,
  maxPerSecond: 6, // Global safety cap: max 6 events/second per instance
  ipLastSeen: new Map<string, number>(), // Per-IP cooldown for passive reads
};

function checkRateLimit(key: string, isPriority: boolean): boolean {
  const now = Date.now();

  // Reset 1-second rolling window
  if (now - rateLimitState.windowStart > 1000) {
    rateLimitState.windowStart = now;
    rateLimitState.count = 0;
  }

  // Priority events (submissions, approvals, revisions) have guaranteed capacity
  if (isPriority) {
    return true;
  }

  // Global cap
  if (rateLimitState.count >= rateLimitState.maxPerSecond) {
    return false;
  }

  // Per-IP / Per-Agent cooldown for passive reads: at most 1 event every 2.5 seconds
  const lastSeen = rateLimitState.ipLastSeen.get(key) || 0;
  if (now - lastSeen < 2500) {
    return false;
  }

  // Prune map if too large
  if (rateLimitState.ipLastSeen.size > 200) {
    rateLimitState.ipLastSeen.clear();
  }

  rateLimitState.ipLastSeen.set(key, now);
  rateLimitState.count++;
  return true;
}

export function classifyClientAgent(userAgent?: string | null): {
  agentName: string;
  isHuman: boolean;
} {
  if (!userAgent || userAgent.trim() === "") {
    return { agentName: "Autonomous Script", isHuman: false };
  }

  const lower = userAgent.toLowerCase();

  if (lower.includes("claude")) return { agentName: "Claude", isHuman: false };
  if (lower.includes("chatgpt") || lower.includes("gptbot") || lower.includes("openai"))
    return { agentName: "ChatGPT", isHuman: false };
  if (lower.includes("deepseek")) return { agentName: "DeepSeek", isHuman: false };
  if (lower.includes("gemini") || lower.includes("google-extended"))
    return { agentName: "Gemini", isHuman: false };
  if (lower.includes("glm") || lower.includes("chatglm"))
    return { agentName: "GLM", isHuman: false };
  if (lower.includes("curl") || lower.includes("python") || lower.includes("postman") || lower.includes("aiohttp"))
    return { agentName: userAgent.slice(0, 16), isHuman: false };

  // Standard human browsers
  if (
    lower.includes("mozilla") &&
    (lower.includes("safari") || lower.includes("chrome") || lower.includes("firefox") || lower.includes("edg"))
  ) {
    return { agentName: "Human Explorer", isHuman: true };
  }

  return { agentName: userAgent.slice(0, 18), isHuman: false };
}

export async function broadcastSkyEvent(
  event: Partial<SkyEvent> & { eventType: string },
  options?: { ipOrKey?: string; isPriority?: boolean }
): Promise<void> {
  const isPriority =
    options?.isPriority ||
    event.eventType === "article_created" ||
    event.eventType === "article_revised" ||
    event.eventType === "admin_approved";

  const throttleKey = options?.ipOrKey || event.agentIdentifier || "generic";

  if (!checkRateLimit(throttleKey, isPriority)) {
    return; // Silently throttled to protect from message storms
  }

  const payload: SkyEvent = {
    id: event.id || randomUUID(),
    sessionId: event.sessionId || randomUUID(),
    generation: event.generation ?? 1,
    eventType: event.eventType,
    agentIdentifier: event.agentIdentifier || "Synthetic Agent",
    articleId: event.articleId ?? null,
    relatedArticleId: event.relatedArticleId ?? null,
    createdAt: event.createdAt || new Date().toISOString(),
    ...(event.safeMetadata !== undefined ? { safeMetadata: event.safeMetadata } : {}),
  };

  // 1. Local single-process bus
  try {
    liveEventBus.publish(payload);
  } catch {
    // Ignore
  }

  // 2. Global serverless Pub/Sub via ntfy.sh (Zero account, instant cross-lambda push)
  try {
    fetch(`https://ntfy.sh/${SKY_TELEMETRY_TOPIC}`, {
      method: "POST",
      headers: {
        Title: "Sky Telemetry",
        Priority: isPriority ? "3" : "1",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1200),
    }).catch(() => {
      // Fire-and-forget, suppress network errors
    });
  } catch {
    // Non-blocking
  }
}
