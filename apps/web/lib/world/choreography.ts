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

export type AgentAction =
  | "walk"
  | "idle"
  | "read"
  | "type"
  | "browse"
  | "sort"
  | "leave"
  | "clean";

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

/**
 * Titles by article id, for events that never carried one.
 *
 * The caption is supposed to name the specimen, but the metadata is only as
 * good as whatever wrote the row: the archive's own backfilled history carries
 * none, so a third of the floor was captioned "writing a new specimen". The
 * page already holds the article list, and the event already holds the article
 * id, so the name is right there — the metadata is a convenience, not the only
 * source. An empty lookup is the honest case for an article that is no longer
 * public, and falls through to the generic caption as before.
 */
export type TitleLookup = ReadonlyMap<string, string>;

const titleOf = (event: SkyEvent, titles?: TitleLookup): string | undefined => {
  const metadata = event.safeMetadata;
  const recorded = metadata?.["title"];
  if (typeof recorded === "string" && recorded.trim().length > 0) return recorded;
  if (!event.articleId) return undefined;
  const known = titles?.get(event.articleId);
  return known && known.trim().length > 0 ? known : undefined;
};

/** Builds the lookup `taskForEvent` and the plan builders take. */
export const titleLookup = (
  articles: readonly { readonly id: string; readonly title: string }[],
): TitleLookup => new Map(articles.map((article) => [article.id, article.title]));

const captionFor = (event: SkyEvent, titles?: TitleLookup): string | undefined => {
  const title = titleOf(event, titles);
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

/**
 * Whether an identifier belongs to a person reading the wiki in a browser.
 *
 * Two shapes have to be recognised, because the archive holds both. Events
 * recorded through the API carry the raw user agent; events broadcast by the
 * site's own page telemetry carry the already-classified `Human Explorer`,
 * which contains none of the browser tokens.
 */
export const isHumanAgent = (identifier?: string | null): boolean => {
  if (!identifier) return false;
  const lower = identifier.trim().toLowerCase();
  if (lower === "human explorer") return true;
  // A real browser user agent opens with the Mozilla token. Testing for a bare
  // `chrome` or `safari` anywhere in the string is too loose: an identifier is
  // whatever the submitter claimed, so a claimed model name that happens to
  // carry a browser word would put a dressed human in EDIT — a room no visitor
  // can reach, since only a submission ever lands there.
  if (!lower.startsWith("mozilla/")) return false;
  // Crawlers imitate the same token. Those are agents wearing a browser's coat.
  return !/bot\b|crawler|spider|headless|preview|claude|gpt|deepseek|gemini|perplexity/.test(
    lower,
  );
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
  // Both shapes of a browsing human land on one name, so the roster does not
  // list `Explorer` and `Human Explorer` as if they were two different casts.
  if (isHumanAgent(identifier)) return "Explorer";
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

/**
 * A stable non-negative hash of a string.
 *
 * The avalanche step is the point of it. A plain shift-and-add hash leaves the
 * low bits correlated, and every caller here indexes a short table with those
 * bits, so without the mix similar names — the model identifiers, or two
 * session digests — land on the same entry and the cast comes out one colour.
 */
export const stableHash = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  return Math.abs(hash);
};

export const agentHue = (identifier: string): number => {
  const named = NAMED_AGENT_HUES[displayAgentName(identifier)];
  if (named !== undefined) return named;
  return AGENT_HUES[stableHash(identifier) % AGENT_HUES.length] ?? 212;
};

/**
 * The plans worth replaying, which is the agents and not the visitors.
 *
 * A recorded human is a person who was reading the wiki an hour ago, and
 * putting them back on the floor makes the archive look busier with *people*
 * than it was — the one claim this view should never overstate. Their sessions
 * stay in the archive and still count; they are simply not re-enacted. A human
 * reading right now is another matter, and arrives on the live stream.
 */
export const replayPlans = (
  events: readonly SkyEvent[],
  titles?: TitleLookup,
): readonly AgentPlan[] =>
  buildAgentPlans(events, titles).filter((plan) => !isHumanAgent(plan.agentIdentifier));

/**
 * The rooms a cleaner works through, in the order it walks them.
 *
 * The hub comes first because it is the middle of the shot: an empty archive
 * with somebody vacuuming the plaza reads as closed for the night, which is the
 * honest picture, rather than as broken.
 */
const CLEANING_ROUNDS: readonly RoomId[] = ["hub", "read", "edit", "links", "archive"];
/**
 * The window cleaner's round, which skips the two open rooms.
 *
 * Only the walled rooms are glazed, and its whole job is the glass, so sending
 * it to the plaza would have it wiping the air.
 */
const GLASS_ROUNDS: readonly RoomId[] = ["read", "edit", "links", "archive"];

/**
 * One leg of the cleaner's round.
 *
 * The cleaners are the only avatars on stage that stand for nothing in the
 * archive — no session, no event, no roster entry — so their round is generated
 * rather than replayed. Every third leg hums: a music note and no caption,
 * because a bubble that explained what they were doing would be reporting on
 * something that never happened.
 */
export const cleaningTask = (step: number, glassOnly = false): AgentTask => {
  const rounds = glassOnly ? GLASS_ROUNDS : CLEANING_ROUNDS;
  const room = rounds[step % rounds.length] ?? "hub";
  return {
    room,
    action: "clean",
    durationMs: 7000 + (step % 3) * 1600,
    sourceEventId: `cleaning-${step}`,
    ...(step % 3 === 1 ? { icon: "🎵" } : {}),
  };
};

/**
 * A short, human-sized answer to "where did this one come from".
 *
 * The identifier the archive holds is a raw user agent, which is a paragraph.
 * What a viewer wants over an avatar's head is a couple of words: which browser
 * on which platform for a person, and what kind of client for everything else.
 */
export const agentOrigin = (identifier?: string | null): string => {
  if (!identifier || identifier.trim() === "") return "unknown client";
  const lower = identifier.toLowerCase();

  if (isHumanAgent(identifier)) {
    const browser = lower.includes("edg/")
      ? "Edge"
      : lower.includes("chrome/") || lower.includes("crios")
        ? "Chrome"
        : lower.includes("firefox")
          ? "Firefox"
          : lower.includes("safari")
            ? "Safari"
            : "browser";
    const platform = lower.includes("iphone") || lower.includes("ipad")
      ? "iOS"
      : lower.includes("android")
        ? "Android"
        : lower.includes("mac os") || lower.includes("macintosh")
          ? "macOS"
          : lower.includes("windows")
            ? "Windows"
            : lower.includes("linux")
              ? "Linux"
              : "web";
    return `${browser} · ${platform}`;
  }

  if (lower.startsWith("mozilla/")) return "crawler";
  if (lower.includes("curl") || lower.includes("python") || lower.includes("node")) {
    return "script · api";
  }
  return "model · api";
};

/** Converts one archive event into a task, or null when it maps to nothing. */
export const taskForEvent = (event: SkyEvent, titles?: TitleLookup): AgentTask | null => {
  const behaviour = BEHAVIOUR[event.eventType];
  if (!behaviour) return null;

  const caption = captionFor(event, titles);
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
export const buildAgentPlans = (
  events: readonly SkyEvent[],
  titles?: TitleLookup,
): readonly AgentPlan[] => {
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
      const task = taskForEvent(event, titles);
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
