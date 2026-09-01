"use client";

/**
 * Wiki World — the room-scale companion to /sky.
 *
 * Same event source, same choreography idea, different vocabulary: instead of
 * particle fields, agents are avatars walking between rooms. Reads the archive
 * once, then follows the live SSE stream.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Press_Start_2P } from "next/font/google";
import {
  MAX_CONCURRENT_AGENTS,
  WorldCanvas,
  type RosterEntry,
} from "../../components/world/world-canvas";
import type { SkyArticle, SkyEvent } from "../../components/sky-canvas";
import { agentHue, displayAgentName } from "../../lib/world/choreography";

/** The credit's typeface: a pixel face, loaded here rather than in the root
 *  layout because /world is the only page that wears it. */
const pixelFont = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

interface ActivityLine {
  id: string;
  time: string;
  agent: string;
  text: string;
  hue: number;
}

/** Status tint in the roster, following the reference's colour coding. */
const STATUS_COLOR: Readonly<Record<string, string>> = {
  Reading: "#5fdc7a",
  Editing: "#e46bd6",
  Browsing: "#4fd8e8",
  Organizing: "#f0a04a",
  Moving: "rgba(255, 255, 255, 0.45)",
  Leaving: "rgba(255, 255, 255, 0.45)",
  Idle: "rgba(255, 255, 255, 0.45)",
};

const ROOM_OF_EVENT: Readonly<Record<string, string>> = {
  agent_session_started: "entered the hub",
  article_opened: "went to READ",
  article_created: "went to EDIT",
  article_revised: "went to EDIT",
  wikilinks_created: "went to LINKS",
  contribution_aborted: "went to ARCHIVE",
  agent_session_ended: "left the building",
};

export default function WorldPage() {
  const [articles, setArticles] = useState<SkyArticle[]>([]);
  const [events, setEvents] = useState<SkyEvent[]>([]);
  const [liveEvent, setLiveEvent] = useState<SkyEvent | null>(null);
  const [roster, setRoster] = useState<readonly RosterEntry[]>([]);
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  /**
   * Whether the archive replay is running. There is no switch for the live
   * stage because there is no sense in one: what is happening now is always
   * staged, and the replay is the thing that fills the floor when nothing is.
   * With both running the recorded avatars are ghosted behind the live ones.
   */
  const [replayMode, setReplayMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const seenIdsRef = useRef(new Set<string>());

  // ?live=1 opens straight into the live-only stage, so the mode can be linked.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("live") === "1") setReplayMode(false);
  }, []);

  const handleRoster = useCallback((next: readonly RosterEntry[]) => {
    setRoster((previous) => {
      if (
        previous.length === next.length &&
        previous.every(
          (entry, index) =>
            entry.name === next[index]?.name &&
            entry.status === next[index]?.status &&
            entry.live === next[index]?.live,
        )
      ) {
        return previous;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [articlesResponse, eventsResponse] = await Promise.all([
          fetch("/api/v1/articles?limit=100"),
          fetch("/api/v1/events?limit=500"),
        ]);
        if (!articlesResponse.ok || !eventsResponse.ok) return;

        const articlesData = await articlesResponse.json();
        const eventsData = await eventsResponse.json();
        if (cancelled) return;

        setArticles(articlesData.items || articlesData.articles || []);
        setEvents(eventsData.items || eventsData.events || []);
      } catch {
        // The world falls back to an empty archive rather than an error screen.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const ingest = (event: SkyEvent) => {
      if (!event || !event.eventType) return;
      // The stream opens with the last ten archive rows. They are already in the
      // fetch this page made for the replay, and treating them as live turned
      // the badge green and put avatars on the live-only stage the moment it
      // loaded — over an archive where nothing had happened for hours.
      if (event.historical) return;
      const key = event.id || `${event.eventType}-${event.createdAt}-${event.agentIdentifier}`;
      if (seenIdsRef.current.has(key)) return;
      seenIdsRef.current.add(key);
      if (seenIdsRef.current.size > 200) seenIdsRef.current.clear();

      setLiveEvent(event);
      // Something is actually happening, which is the only thing this page is
      // really for, so the replay stands down: it exists to fill the time when
      // the archive is quiet, not to crowd a real agent off its own floor. The
      // recorded avatars finish what they are doing and walk out.
      setReplayMode(false);

      const hue = agentHue(event.agentIdentifier || "agent");

      setActivity((previous) =>
        [
          {
            id: key,
            time: new Date(event.createdAt || Date.now()).toTimeString().slice(0, 8),
            agent: displayAgentName(event.agentIdentifier),
            text: ROOM_OF_EVENT[event.eventType] ?? event.eventType,
            hue,
          },
          ...previous,
        ].slice(0, 6),
      );
    };

    const sources: EventSource[] = [];

    try {
      const local = new EventSource("/api/v1/events/stream");
      local.onmessage = (message) => {
        try {
          ingest(JSON.parse(message.data) as SkyEvent);
        } catch {
          // Ignore malformed frames.
        }
      };
      sources.push(local);
    } catch {
      // SSE unavailable; the replay still runs.
    }

    try {
      const topic = process.env.NEXT_PUBLIC_SKY_TELEMETRY_TOPIC || "amw-sky-telemetry-mc9625";
      const remote = new EventSource(`https://ntfy.sh/${topic}/sse`);
      remote.onmessage = (message) => {
        try {
          const raw = JSON.parse(message.data);
          if (raw && raw.event === "message" && raw.message) {
            ingest(JSON.parse(raw.message) as SkyEvent);
          } else if (raw && raw.eventType) {
            ingest(raw as SkyEvent);
          }
        } catch {
          // Ignore malformed frames.
        }
      };
      sources.push(remote);
    } catch {
      // Remote broker unavailable.
    }

    return () => {
      for (const source of sources) source.close();
    };
  }, []);

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .site-header, .site-footer { display: none !important; }
        body { background-color: #cfd6dd; margin: 0; padding: 0; overflow: hidden; }

        .world-stage { position: fixed; inset: 0; }
        .world-viewport { position: absolute; inset: 0; }
        .world-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }

        /* Speech bubble: the reference's white tile, widened to carry the
           caption as well as the icon. */
        .world-bubble {
          position: absolute; top: 0; left: 0;
          display: flex; align-items: center; gap: 0.4rem;
          font-family: var(--font-jetbrains-mono, monospace);
          font-size: 0.66rem; line-height: 1.1;
          padding: 0.42rem 0.6rem;
          color: #1a1d24;
          background: #fbfaf6;
          border: 3px solid #23262e;
          border-radius: 8px;
          box-shadow: 0 4px 0 rgba(20, 22, 28, 0.28);
          white-space: nowrap;
          max-width: 20rem; overflow: hidden; text-overflow: ellipsis;
          transition: opacity 0.35s ease;
        }
        /* Lifted clear of another caption: its tail would point at that one. */
        .world-bubble-lifted::after { display: none; }

        /* The card a click on an avatar puts over its head. Same tile as a
           caption — it is the same avatar speaking — but left-aligned, in four
           short lines, and a size that does not cover the room underneath. */
        .world-bubble-card {
          display: block; text-align: left; white-space: nowrap;
          font-size: 0.58rem; line-height: 1.5;
          padding: 0.4rem 0.55rem;
          max-width: none;
        }
        .world-bubble-card-name { font-weight: 700; letter-spacing: 0.04em; }
        .world-bubble-card div + div { opacity: 0.62; }

        /* A bubble with an icon and no words — the wave, the cleaner's humming.
           There is nothing to read, so the icon carries the whole tile and is
           drawn at the size of one. */
        .world-bubble-icon { font-size: 1.7rem; padding: 0.3rem 0.5rem; line-height: 1; }
        .world-bubble-glyph { display: inline-block; transform-origin: 50% 80%; }
        /* iMessage's shake, near enough: a hard jolt that settles in half a
           second. Applied to the span, because the bubble's own transform is
           what puts it on screen. */
        @keyframes world-bubble-shake {
          0%   { transform: translateX(0) rotate(0deg) scale(0.7); }
          18%  { transform: translateX(-4px) rotate(-9deg) scale(1.18); }
          34%  { transform: translateX(4px) rotate(9deg) scale(1.12); }
          50%  { transform: translateX(-3px) rotate(-6deg) scale(1.08); }
          66%  { transform: translateX(3px) rotate(5deg) scale(1.04); }
          82%  { transform: translateX(-1px) rotate(-2deg) scale(1.01); }
          100% { transform: translateX(0) rotate(0deg) scale(1); }
        }
        .world-bubble-shake { animation: world-bubble-shake 0.62s cubic-bezier(0.32, 0.9, 0.36, 1); }
        @media (prefers-reduced-motion: reduce) {
          .world-bubble-shake { animation: none; }
        }
        .world-bubble::after {
          content: ""; position: absolute; bottom: -11px; left: 50%;
          margin-left: -6px; width: 0; height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid #23262e;
        }

        /* The two signs over the stage.

           Each is a casing with a tube inside it: the outer button is the
           frame — dark, rounded, unlit whatever the state — and the inner span
           is the glass, which is the only part that ever lights. Only one is
           ever lit, so the dark one carries no glow at all and the pair reads
           as a switch rather than as two independent lamps. */
        .world-signs {
          position: fixed; z-index: 41; top: 1.15rem; left: 50%;
          transform: translateX(-50%);
          display: flex; gap: 0.8rem;
        }
        .world-sign {
          position: relative;
          padding: 0.32rem;
          border-radius: 14px;
          cursor: pointer;
          background: linear-gradient(180deg, #262c38 0%, #141922 100%);
          border: 2px solid #39414f;
          box-shadow: 0 3px 0 rgba(8, 10, 14, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07);
        }
        .world-sign-tube {
          display: block;
          font-family: var(--font-jetbrains-mono, monospace);
          font-size: 0.8rem; font-weight: 700; letter-spacing: 0.24em;
          padding: 0.44rem 0.9rem 0.44rem 1.14rem;
          border-radius: 9px;
          color: rgba(226, 232, 240, 0.26);
          background: #0b0e14;
          border: 2px solid rgba(226, 232, 240, 0.13);
          transition: color 0.28s ease, border-color 0.28s ease,
            box-shadow 0.28s ease, text-shadow 0.28s ease, background 0.28s ease;
        }
        .world-sign:focus-visible { outline: 2px solid #7fd8ff; outline-offset: 3px; }

        /* The sign's own tooltip, rather than the browser's: a title attribute
           waits about a second before it says anything, which for a control
           with one button and a non-obvious effect is a second too long. */
        .world-sign-tip {
          position: absolute; top: calc(100% + 0.5rem); left: 50%;
          transform: translate(-50%, -4px);
          width: 15rem;
          padding: 0.5rem 0.6rem;
          font-family: var(--font-jetbrains-mono, monospace);
          font-size: 0.58rem; line-height: 1.45; letter-spacing: 0;
          font-weight: 400; text-align: left;
          color: rgba(255, 255, 255, 0.82);
          background: rgba(13, 16, 22, 0.97);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 6px;
          box-shadow: 0 8px 22px rgba(6, 8, 12, 0.5);
          opacity: 0; pointer-events: none;
          transition: opacity 0.12s ease, transform 0.12s ease;
        }
        /* The nib, which is what ties the card to the sign above it. */
        .world-sign-tip::before {
          content: ""; position: absolute; bottom: 100%; left: 50%;
          margin-left: -5px; border: 5px solid transparent;
          border-bottom-color: rgba(255, 255, 255, 0.16);
        }
        .world-sign:hover .world-sign-tip,
        .world-sign:focus-visible .world-sign-tip {
          opacity: 1;
          transform: translate(-50%, 0);
        }
        @media (prefers-reduced-motion: reduce) {
          .world-sign-tip { transition: none; }
        }
        .world-sign-replay.world-sign-on .world-sign-tube {
          color: #46e884;
          border-color: #46e884;
          background: rgba(8, 38, 22, 0.95);
          text-shadow: 0 0 6px rgba(70, 232, 132, 0.95), 0 0 18px rgba(70, 232, 132, 0.7);
          box-shadow: 0 0 18px rgba(70, 232, 132, 0.55), inset 0 0 14px rgba(70, 232, 132, 0.35);
        }
        /* The tube's own flicker, small enough to read as a sign rather than a
           fault, and gone entirely for anybody who asked for less motion. */
        @keyframes world-sign-hum {
          0%, 100% { filter: brightness(1); }
          47% { filter: brightness(1.09); }
          52% { filter: brightness(0.94); }
        }
        .world-sign-on .world-sign-tube { animation: world-sign-hum 3.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .world-sign-on .world-sign-tube { animation: none; }
        }

        .world-panel {
          position: fixed; z-index: 40;
          font-family: var(--font-jetbrains-mono, monospace);
          background: rgba(13, 16, 22, 0.94);
          border: 2px solid rgba(255, 255, 255, 0.14);
          border-radius: 7px;
          padding: 0.65rem 0.8rem;
          color: rgba(255, 255, 255, 0.88);
          font-size: 0.64rem;
          box-shadow: 0 6px 22px rgba(10, 14, 22, 0.35);
        }
        .world-panel-title { letter-spacing: 0.16em; opacity: 0.5; font-size: 0.6rem; }

        /* Which cast a roster row belongs to, in the signs' own two colours: a
           lit red bead for somebody who is here now, a dim green one for a
           recording. Same distinction the stage makes by fading the ghosts. */
        .world-bead {
          flex: none; width: 0.42rem; height: 0.42rem; border-radius: 50%;
        }
        .world-bead-live {
          background: #ff4a52;
          box-shadow: 0 0 5px rgba(255, 74, 82, 0.95), 0 0 10px rgba(255, 74, 82, 0.55);
        }
        .world-bead-replay {
          background: rgba(70, 232, 132, 0.55);
          box-shadow: inset 0 0 0 1px rgba(70, 232, 132, 0.3);
        }

        /* Signature, bottom right. Flat black over the floor, no relief. */
        .world-credit {
          position: fixed; z-index: 40; right: 1.4rem; bottom: 1.2rem;
          font-size: 0.58rem; line-height: 1;
          color: #000000;
          pointer-events: none;
          user-select: none;
        }
        @media (max-width: 640px) {
          .world-credit { font-size: 0.4rem; right: 1rem; bottom: 1rem; }
        }

        /* The agent's cube face, reduced to a swatch with two eyes. */
        .world-face {
          position: relative;
          width: 1.05rem; height: 1.05rem;
          border-radius: 3px;
          border: 1px solid rgba(0, 0, 0, 0.45);
          flex: none;
        }
        .world-face::before, .world-face::after {
          content: ""; position: absolute; top: 34%;
          width: 22%; height: 26%;
          background: #15181f;
        }
        .world-face::before { left: 16%; }
        .world-face::after { right: 16%; }

        .world-row {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.16rem 0;
        }
        .world-row-name { flex: 1; white-space: nowrap; }
        .world-row-tag {
          font-size: 0.52rem; letter-spacing: 0.1em; text-transform: uppercase;
          opacity: 0.45; border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 3px; padding: 0 0.22rem;
        }
      `,
        }}
      />

      <WorldCanvas
        initialArticles={articles}
        initialEvents={events}
        liveEvent={liveEvent}
        replay={replayMode}
        onRosterChange={handleRoster}
      />

      {/* Stage sign */}
      <div className="world-signs">
        <button
          type="button"
          className={`world-sign world-sign-replay ${replayMode ? "world-sign-on" : ""}`}
          aria-pressed={replayMode}
          onClick={() => setReplayMode((previous) => !previous)}
        >
          <span className="world-sign-tube">REPLAY</span>
          <span className="world-sign-tip" role="tooltip">
            {replayMode
              ? "Replaying recorded sessions. They are ghosted whenever a live agent shares the floor, and stand down as soon as one arrives."
              : "Fill the quiet with recorded sessions from the archive. Live agents are always staged either way."}
          </span>
        </button>
      </div>

      {/* Title card */}
      <div className="world-panel" style={{ top: "1.15rem", left: "1.15rem", minWidth: "13rem" }}>
        <div style={{ fontSize: "1.32rem", fontWeight: 700, letterSpacing: "0.07em", color: "#fff" }}>
          WIKI WORLD
        </div>
        <div style={{ opacity: 0.42, marginTop: "0.2rem" }}>
          v0.1.0-alpha · {articles.length} specimens
        </div>
        <Link
          href="/"
          style={{ display: "inline-block", marginTop: "0.4rem", color: "#7fd8ff", textDecoration: "none" }}
        >
          ← Agent Memory Wiki
        </Link>
      </div>

      {/* Stage occupancy, mirroring the reference's second card */}
      <div className="world-panel" style={{ top: "7.4rem", left: "1.15rem", minWidth: "13rem" }}>
        <div className="world-panel-title">ACTIVE AGENTS</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginTop: "0.35rem" }}>
          <span
            style={{
              width: "0.5rem",
              height: "0.5rem",
              borderRadius: "50%",
              background: roster.length > 0 ? "#5fdc7a" : "rgba(255,255,255,0.3)",
            }}
          />
          <span style={{ fontSize: "0.9rem", color: "#fff" }}>
            {roster.length} / {MAX_CONCURRENT_AGENTS}
          </span>
        </div>
      </div>

      {/* Roster */}
      <div className="world-panel" style={{ top: "1.15rem", right: "1.15rem", minWidth: "13.5rem" }}>
        {/* No mode word here: the signs over the stage say which mode is on, and
            each row's bead says which cast that avatar belongs to. A third
            reading of the same thing, in a corner, only contradicted them. */}
        <div className="world-panel-title" style={{ marginBottom: "0.45rem" }}>
          ACTIVE AGENTS
        </div>
        {roster.length === 0 ? (
          <div style={{ opacity: 0.35 }}>
            {loading
              ? "loading archive…"
              : !replayMode
                ? "waiting for a live event…"
                : "no agents on stage"}
          </div>
        ) : (
          roster.map((entry, index) => (
            // Not a control: an avatar's own details belong over its head on the
            // floor, where the thing being described is, and that is where a
            // click on the avatar itself puts them.
            <div key={`${entry.name}-${index}`} className="world-row">
              <span
                className={`world-bead ${entry.live ? "world-bead-live" : "world-bead-replay"}`}
                title={entry.live ? "live session" : "replayed from the archive"}
              />
              {/* The swatch is the avatar's own head, with its shirt as a band
                  beneath — which is the whole of what separates a person from an
                  agent on the floor, and so the whole of what marks the row. */}
              <span
                className="world-face"
                style={{
                  background: entry.head,
                  boxShadow: entry.human ? `inset 0 -0.3rem 0 ${entry.shirt}` : undefined,
                }}
              />
              <span className="world-row-name">{entry.name}</span>
              {entry.human && <span className="world-row-tag">human</span>}
              <span style={{ color: STATUS_COLOR[entry.status] ?? "rgba(255,255,255,0.45)" }}>
                {entry.status}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Activity log */}
      {activity.length > 0 && (
        <div className="world-panel" style={{ bottom: "1.15rem", left: "1.15rem", maxWidth: "22rem" }}>
          {activity.map((line) => (
            <div key={line.id} style={{ padding: "0.1rem 0", display: "flex", gap: "0.5rem" }}>
              <span style={{ opacity: 0.35 }}>{line.time}</span>
              <span style={{ color: `hsl(${line.hue.toFixed(0)}, 72%, 62%)` }}>{line.agent}</span>
              <span style={{ opacity: 0.6 }}>{line.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`world-credit ${pixelFont.className}`}>By NuvolaProject</div>
    </>
  );
}
