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
import { MAX_CONCURRENT_AGENTS, WorldCanvas } from "../../components/world/world-canvas";
import type { SkyArticle, SkyEvent } from "../../components/sky-canvas";
import { agentHue, displayAgentName } from "../../lib/world/choreography";

interface RosterEntry {
  name: string;
  status: string;
  hue: number;
}

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
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const seenIdsRef = useRef(new Set<string>());

  const handleRoster = useCallback((next: readonly RosterEntry[]) => {
    setRoster((previous) => {
      if (
        previous.length === next.length &&
        previous.every(
          (entry, index) =>
            entry.name === next[index]?.name && entry.status === next[index]?.status,
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
      const key = event.id || `${event.eventType}-${event.createdAt}-${event.agentIdentifier}`;
      if (seenIdsRef.current.has(key)) return;
      seenIdsRef.current.add(key);
      if (seenIdsRef.current.size > 200) seenIdsRef.current.clear();

      setLiveEvent(event);
      setIsLive(true);

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
        .world-bubble::after {
          content: ""; position: absolute; bottom: -11px; left: 50%;
          margin-left: -6px; width: 0; height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid #23262e;
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
      `,
        }}
      />

      <WorldCanvas
        initialArticles={articles}
        initialEvents={events}
        liveEvent={liveEvent}
        onRosterChange={handleRoster}
      />

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
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "0.45rem" }}>
          <span className="world-panel-title">ACTIVE AGENTS</span>
          <span style={{ color: isLive ? "#5fdc7a" : "rgba(255,255,255,0.35)" }}>
            {isLive ? "● LIVE" : "○ REPLAY"}
          </span>
        </div>
        {roster.length === 0 ? (
          <div style={{ opacity: 0.35 }}>{loading ? "loading archive…" : "no agents on stage"}</div>
        ) : (
          roster.map((entry, index) => (
            <div key={`${entry.name}-${index}`} className="world-row">
              <span
                className="world-face"
                style={{ background: `hsl(${entry.hue.toFixed(0)}, 72%, 50%)` }}
              />
              <span className="world-row-name">{entry.name}</span>
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
    </>
  );
}
