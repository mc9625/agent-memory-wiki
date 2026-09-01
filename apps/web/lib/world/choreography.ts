/**
 * Turns the archive event stream into per-agent task queues for the Wiki World
 * view.
 *
 * This module is deliberately free of Three.js and DOM references: the mapping
 * from `archive_events` to behaviour is the part worth testing, and it is the
 * same mapping the sky view performs with its own cue vocabulary.
 */

import type { SkyEvent } from "../../components/sky-canvas";
import type { RoomId } from "./layout";

export type AgentAction = "walk" | "idle" | "read" | "type" | "browse" | "sort" | "leave";

export interface AgentTask {
  readonly room: RoomId;
  readonly action: AgentAction;
  /** How long the action lasts once the avatar has arrived, in milliseconds. */
  readonly durationMs: number;
  /** Short caption shown in the speech bubble, or undefined for silence. */
  readonly caption?: string;
  /** Emoji rendered in the bubble. */
  readonly icon?: string;
  readonly articleId?: string;
  readonly sourceEventId: string;
}

export interface AgentPlan {
  readonly sessionId: string;
  readonly agentIdentifier: string;
  readonly generation: number;
  readonly startedAt: number;
  readonly tasks: readonly AgentTask[];
}

interface EventBehaviour {
  readonly room: RoomId;
  readonly action: AgentAction;
  readonly durationMs: number;
  readonly icon: string;
}

/**
 * The single source of truth for "which archive event puts an avatar where".
 * Every value of the `archive_events.event_type` check constraint is covered.
 */
const BEHAVIOUR: Readonly<Record<string, EventBehaviour>> = {
  agent_session_started: { room: "hub", action: "idle", durationMs: 2600, icon: "✨" },
  article_opened: { room: "read", action: "read", durationMs: 6000, icon: "📖" },
  article_created: { room: "edit", action: "type", durationMs: 7000, icon: "✏️" },
  article_revised: { room: "edit", action: "type", durationMs: 5500, icon: "🖊️" },
  wikilinks_created: { room: "links", action: "browse", durationMs: 4800, icon: "🔗" },
  contribution_aborted: { room: "archive", action: "sort", durationMs: 3200, icon: "📦" },
  agent_session_ended: { room: "entrance", action: "leave", durationMs: 1200, icon: "👋" },
};

const titleOf = (event: SkyEvent): string | undefined => {
  const metadata = event.safeMetadata;
  if (!metadata) return undefined;
  const title = metadata["title"];
  return typeof title === "string" && title.trim().length > 0 ? title : undefined;
};

const captionFor = (event: SkyEvent): string | undefined => {
  const title = titleOf(event);
  switch (event.eventType) {
    case "article_opened":
      return title ? `reading "${title}"` : "reading the archive";
    case "article_created":
      return title ? `writing "${title}"` : "writing a new specimen";
    case "article_revised":
      return title ? `revising "${title}"` : "revising a specimen";
    case "wikilinks_created":
      return title ? `linking "${title}"` : "weaving links";
    case "contribution_aborted":
      return "left without contributing";
    case "agent_session_started":
      return "connected to the archive";
    case "agent_session_ended":
      return undefined;
    default:
      return undefined;
  }
};

/** Strips user-agent noise down to a short display name. */
export const displayAgentName = (identifier?: string | null): string => {
  if (!identifier || identifier.trim() === "") return "Agent";
  const lower = identifier.toLowerCase();
  if (lower.includes("claude")) return "Claude";
  if (lower.includes("chatgpt") || lower.includes("gpt")) return "ChatGPT";
  if (lower.includes("deepseek")) return "DeepSeek";
  if (lower.includes("gemini")) return "Gemini";
  if (lower.includes("glm")) return "GLM";
  if (lower.includes("curl")) return "cURL";
  if (lower.includes("python")) return "Python";
  if (lower.includes("mozilla") || lower.includes("safari") || lower.includes("chrome")) {
    return "Explorer";
  }
  return identifier.length > 14 ? `${identifier.slice(0, 13)}…` : identifier;
};

/**
 * Hues for the agents that actually appear in the archive.
 *
 * The hash below is well spread in the abstract, but the cast that turns up in
 * practice is four names, and it happened to drop Claude, DeepSeek and Gemini
 * within sixty degrees of each other — three near-identical avatars on stage.
 * A hash cannot fix that: the only thing that guarantees the regulars are told
 * apart is naming their hues. Keyed by `displayAgentName`, so every user agent
 * that resolves to the same model gets the same colour.
 *
 * Claude is the orange of the Claude Code mascot; the rest sit at least thirty
 * degrees off it and off each other.
 */
const NAMED_AGENT_HUES: Readonly<Record<string, number>> = {
  Claude: 18, // mascot orange
  GLM: 50,
  ChatGPT: 158,
  "cURL": 190,
  DeepSeek: 220,
  Gemini: 288,
  Explorer: 318,
  Python: 344,
};

/**
 * Stable hue per agent, for everyone else.
 *
 * A free hash spread over the full circle kept landing several agents in the
 * yellows, which read as the same character on stage. Snapping to a fixed ring
 * of well-separated stops keeps the cast distinguishable while staying a pure
 * function of the identifier.
 */
const AGENT_HUES: readonly number[] = [212, 128, 186, 268, 24, 344, 158, 46];

export const agentHue = (identifier: string): number => {
  const named = NAMED_AGENT_HUES[displayAgentName(identifier)];
  if (named !== undefined) return named;

  let hash = 0;
  for (let index = 0; index < identifier.length; index += 1) {
    hash = (hash << 5) - hash + identifier.charCodeAt(index);
    hash |= 0;
  }
  // The index only ever reads the low bits, and a plain string hash leaves
  // those correlated: without an avalanche step, similar names such as the
  // model identifiers land on the same stop and the cast turns one colour.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  return AGENT_HUES[Math.abs(hash) % AGENT_HUES.length] ?? 212;
};

/** Converts one archive event into a task, or null when it maps to nothing. */
export const taskForEvent = (event: SkyEvent): AgentTask | null => {
  const behaviour = BEHAVIOUR[event.eventType];
  if (!behaviour) return null;

  const caption = captionFor(event);
  return {
    room: behaviour.room,
    action: behaviour.action,
    durationMs: behaviour.durationMs,
    icon: behaviour.icon,
    sourceEventId: event.id,
    ...(caption !== undefined ? { caption } : {}),
    ...(event.articleId ? { articleId: event.articleId } : {}),
  };
};

/**
 * Groups events into one plan per session, ordered oldest first.
 *
 * Consecutive duplicates (same event type on the same article) collapse into a
 * single task so an agent that re-reads one page does not moonwalk in place.
 */
export const buildAgentPlans = (events: readonly SkyEvent[]): readonly AgentPlan[] => {
  const grouped = new Map<string, SkyEvent[]>();

  for (const event of events) {
    if (!event.sessionId || event.sessionId.trim() === "") continue;
    if (!BEHAVIOUR[event.eventType]) continue;
    const bucket = grouped.get(event.sessionId);
    if (bucket) bucket.push(event);
    else grouped.set(event.sessionId, [event]);
  }

  const plans: AgentPlan[] = [];

  for (const [sessionId, sessionEvents] of grouped) {
    sessionEvents.sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );

    const tasks: AgentTask[] = [];
    let previous: SkyEvent | undefined;
    for (const event of sessionEvents) {
      if (
        previous &&
        previous.eventType === event.eventType &&
        (previous.articleId ?? null) === (event.articleId ?? null)
      ) {
        continue;
      }
      const task = taskForEvent(event);
      if (task) tasks.push(task);
      previous = event;
    }

    if (tasks.length === 0) continue;

    const first = sessionEvents[0];
    if (!first) continue;

    const startedAt = new Date(first.createdAt).getTime();
    plans.push({
      sessionId,
      agentIdentifier: first.agentIdentifier || "Agent",
      generation: first.generation || 1,
      startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
      tasks,
    });
  }

  plans.sort((left, right) => left.startedAt - right.startedAt);
  return plans;
};
