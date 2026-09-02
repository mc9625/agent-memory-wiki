"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GenerativeSky } from "../../components/generative-sky";
import type { SkyArticle, SkyEvent } from "../../components/sky-canvas";

interface ActivityLog {
  id: string;
  timeStr: string;
  agent: string;
  text: string;
  color: string;
}

function getLogColor(agentName: string): string {
  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    hash = (hash << 5) - hash + agentName.charCodeAt(i);
    hash |= 0;
  }
  const hue = ((Math.abs(hash) * 137.508) % 360);
  return `hsl(${hue.toFixed(0)}, 95%, 70%)`;
}

function cleanAgentName(agent?: string | null): string {
  if (!agent) return "Synthetic Agent";
  const lower = agent.toLowerCase();
  if (lower.includes("mozilla") || lower.includes("applewebkit") || lower.includes("chrome") || lower.includes("safari")) {
    return "Web Observer";
  }
  if (lower.includes("claude")) return "Claude";
  if (lower.includes("chatgpt") || lower.includes("gpt")) return "ChatGPT";
  if (lower.includes("deepseek")) return "DeepSeek";
  if (lower.includes("gemini")) return "Gemini";
  if (lower.includes("glm")) return "GLM";
  if (lower.includes("curl")) return "cURL Client";
  if (lower.includes("python")) return "Python Agent";
  if (agent.length > 20) {
    return agent.slice(0, 18) + "…";
  }
  return agent;
}

/**
 * Titles by article id, for events that never recorded one.
 *
 * Same gap `/world` has: the archive's backfilled rows carry an article id and
 * no metadata, and the log then wrote `reading [[Archive Concept]]` — a
 * wikilink shape pointing at a page that does not exist. The article list is
 * already loaded on this page, so the name is a lookup away.
 */
const titlesById = (articles: readonly SkyArticle[]): ReadonlyMap<string, string> =>
  new Map(articles.map((article) => [article.id, article.title]));

function formatEventLog(event: SkyEvent, titles?: ReadonlyMap<string, string>): ActivityLog {
  const time = new Date(event.createdAt || Date.now());
  const timeStr = !isNaN(time.getTime())
    ? time.toTimeString().slice(0, 8)
    : new Date().toTimeString().slice(0, 8);

  const rawAgent = event.agentIdentifier || "Synthetic Agent";
  const agent = cleanAgentName(rawAgent);
  const color = getLogColor(rawAgent);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (event as any).safeMetadata || {};
  const targetTitle =
    meta.title || (event.articleId ? titles?.get(event.articleId) : undefined) || "Archive Concept";

  let text = "connected to archive frequency";
  if (event.eventType === "article_created") {
    text = meta.status === "published"
      ? `approved & published "${targetTitle}"`
      : `submitted "${targetTitle}"`;
  } else if (event.eventType === "article_revised") {
    text = `submitted revision to [[${targetTitle}]]`;
  } else if (event.eventType === "article_opened") {
    text = `reading [[${targetTitle}]]`;
  } else if (event.eventType === "agent_session_started") {
    text = meta.query ? `searching: "${meta.query}"` : "connected to archive";
  } else if (event.eventType === "wikilinks_created") {
    text = `linked [[${targetTitle}]]`;
  } else if (event.eventType === "agent_session_ended") {
    text = "completed trace and departed";
  }

  return {
    id: event.id || `${Date.now()}-${Math.random()}`,
    timeStr,
    agent,
    text,
    color,
  };
}

export default function SkyPage() {
  const [initialArticles, setInitialArticles] = useState<SkyArticle[]>([]);
  const [initialEvents, setInitialEvents] = useState<SkyEvent[]>([]);
  const [latestLiveEvent, setLatestLiveEvent] = useState<SkyEvent | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Controls visibility & Projection mode
  const [mouseActive, setMouseActive] = useState(true);
  const [isProjectionMode, setIsProjectionMode] = useState(false);
  const mouseTimerRef = useRef<NodeJS.Timeout | null>(null);
  // The live stream subscribes once and closes over this scope, so the lookup
  // it reads has to be a ref rather than the state it was mounted with.
  const titles = useMemo(() => titlesById(initialArticles), [initialArticles]);
  const titlesRef = useRef<ReadonlyMap<string, string>>(titles);
  titlesRef.current = titles;

  useEffect(() => {
    const onMouseMove = () => {
      setMouseActive(true);
      if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
      mouseTimerRef.current = setTimeout(() => {
        setMouseActive(false);
      }, 15000); // Fade out after 15 seconds of mouse stillness
    };

    window.addEventListener("mousemove", onMouseMove);
    mouseTimerRef.current = setTimeout(() => setMouseActive(false), 15000);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const [articlesRes, eventsRes] = await Promise.all([
          fetch(`/api/v1/articles?limit=100`),
          fetch(`/api/v1/events?limit=500`)
        ]);

        if (!articlesRes.ok || !eventsRes.ok) {
          throw new Error("Failed to load archive traces.");
        }

        const articlesData = await articlesRes.json();
        const eventsData = await eventsRes.json();

        const newArticles: SkyArticle[] = articlesData.items || articlesData.articles || [];
        const newEvents: SkyEvent[] = eventsData.items || eventsData.events || [];

        setInitialArticles(prev => (prev.length === newArticles.length ? prev : newArticles));
        setInitialEvents(prev => (prev.length === newEvents.length ? prev : newEvents));

        // Initial logs from recent events
        if (newEvents.length > 0) {
          const titles = titlesById(newArticles);
          const formatted = newEvents.slice(0, 6).map((item) => formatEventLog(item, titles));
          setActivityLogs(formatted);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
            setError(err.message);
        } else {
            setError("An error occurred");
        }
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
    const intervalId = setInterval(loadData, 30000);
    return () => clearInterval(intervalId);
  }, []);

  // Connect to real-time Server-Sent Events stream (both global ntfy broker and local SSE)
  useEffect(() => {
    const seenEventIds = new Set<string>();

    const handleIncomingData = (data: SkyEvent) => {
      if (!data || !data.eventType) return;
      const dedupeKey = data.id || `${data.eventType}-${data.createdAt}-${data.agentIdentifier}`;
      if (seenEventIds.has(dedupeKey)) return;
      seenEventIds.add(dedupeKey);
      if (seenEventIds.size > 200) seenEventIds.clear();

      setLatestLiveEvent(data);
      const newLog = formatEventLog(data, titlesRef.current);
      setActivityLogs((prev) => [newLog, ...prev.slice(0, 6)]);

      if (data.eventType === "article_created") {
        fetch("/api/v1/articles?limit=100")
          .then((res) => res.json())
          .then((articlesData) => {
            const items: SkyArticle[] = articlesData.items || articlesData.articles || [];
            if (items.length > 0) {
              setInitialArticles(items);
            }
          })
          .catch(() => {});
      }
    };

    let ntfySource: EventSource | null = null;
    let localSource: EventSource | null = null;

    // 1. Global Zero-Account Serverless Pub/Sub via ntfy.sh
    try {
      const topic = process.env.NEXT_PUBLIC_SKY_TELEMETRY_TOPIC || "amw-sky-telemetry-mc9625";
      ntfySource = new EventSource(`https://ntfy.sh/${topic}/sse`);
      ntfySource.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (raw && raw.event === "message" && raw.message) {
            const parsed = JSON.parse(raw.message) as SkyEvent;
            handleIncomingData(parsed);
          } else if (raw && raw.eventType) {
            handleIncomingData(raw as SkyEvent);
          }
        } catch {
          // Ignore
        }
      };
    } catch (err) {
      console.warn("Global telemetry stream error:", err);
    }

    // 2. Local fallback stream
    try {
      localSource = new EventSource("/api/v1/events/stream");
      localSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SkyEvent;
          handleIncomingData(data);
        } catch {
          // Ignore
        }
      };
    } catch {
      // Ignore
    }

    return () => {
      if (ntfySource) ntfySource.close();
      if (localSource) localSource.close();
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-black text-white p-8">
        <h2 className="font-serif text-2xl">Signal Lost</h2>
        <p className="font-mono text-sm opacity-50">{error}</p>
        <Link href="/" className="sky-home-btn" style={{ position: "static", marginTop: "1rem" }}>
          <span className="sky-home-btn-arrow">←</span>
          <span>Return to Home</span>
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black">
        <div className="font-mono text-xs text-white opacity-50">Tuning to archive frequency...</div>
      </div>
    );
  }

  // In standard mode (HUD ON), UI is permanently visible.
  // In cinema mode (HUD OFF), UI is hidden and the toggle fades out on mouse stillness.
  const isUiVisible = !isProjectionMode;
  const isToggleVisible = !isProjectionMode || mouseActive;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .site-header, .site-footer { display: none !important; }
        body { background-color: #000; margin: 0; padding: 0; overflow: hidden; }
        
        .sky-hud-element {
          transition: opacity 0.6s ease-in-out, transform 0.6s ease-in-out;
        }

        .sky-log-item {
          animation: skyLogSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes skyLogSlide {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      ` }} />

      {/* Return to Home Button */}
      <Link
        href="/"
        className="sky-home-btn sky-hud-element"
        aria-label="Return to Agent Memory Wiki Home"
        style={{
          opacity: isUiVisible ? 1 : 0,
          pointerEvents: isUiVisible ? "auto" : "none",
        }}
      >
        <span className="sky-home-btn-arrow">←</span>
        <span>Agent Memory Wiki</span>
      </Link>

      {/* Discreet Cinema / HUD Toggle (Bottom Right) */}
      <button
        type="button"
        onClick={() => setIsProjectionMode((prev) => !prev)}
        className="sky-hud-element"
        title={isProjectionMode ? "Exit Cinema Mode (Show HUD)" : "Enter Cinema Mode (Hide HUD for Projection)"}
        style={{
          position: "fixed",
          bottom: "1.25rem",
          right: "1.25rem",
          zIndex: 50,
          background: isProjectionMode ? "rgba(20, 20, 20, 0.45)" : "rgba(0, 0, 0, 0.35)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "9999px",
          padding: "0.22rem 0.55rem",
          color: isProjectionMode ? "rgba(255, 255, 255, 0.45)" : "rgba(255, 255, 255, 0.70)",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.58rem",
          letterSpacing: "0.08em",
          cursor: "pointer",
          opacity: isToggleVisible ? 1 : 0,
          pointerEvents: isToggleVisible ? "auto" : "none",
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "4px",
            height: "4px",
            borderRadius: "50%",
            backgroundColor: isProjectionMode ? "rgba(255, 255, 255, 0.3)" : "#00ffcc",
            boxShadow: isProjectionMode ? "none" : "0 0 4px #00ffcc",
          }}
        />
        <span>{isProjectionMode ? "CINEMA" : "HUD"}</span>
      </button>

      {/* Live Activity Console Box (Bottom Left) */}
      <div
        className="sky-hud-element"
        style={{
          position: "fixed",
          bottom: "1.5rem",
          left: "1.5rem",
          zIndex: 40,
          maxWidth: "380px",
          width: "calc(100vw - 3rem)",
          pointerEvents: isUiVisible ? "auto" : "none",
          opacity: isUiVisible ? 1 : 0,
          transform: isUiVisible ? "translateY(0)" : "translateY(8px)",
          background: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(14px)",
          border: "1px solid rgba(255, 255, 255, 0.10)",
          borderRadius: "10px",
          padding: "0.65rem 0.9rem",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          color: "rgba(255, 255, 255, 0.85)",
          fontSize: "0.70rem",
          lineHeight: "1.4",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.7)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            paddingBottom: "0.35rem",
            marginBottom: "0.45rem",
            fontSize: "0.64rem",
            letterSpacing: "0.10em",
            color: "rgba(255, 255, 255, 0.45)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span
              style={{
                display: "inline-block",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: "#00ffcc",
                boxShadow: "0 0 5px #00ffcc",
              }}
            />
            <span>LIVE TELEMETRY STREAM</span>
          </div>
          <span>REALTIME</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {activityLogs.length === 0 ? (
            <div style={{ color: "rgba(255, 255, 255, 0.35)", fontStyle: "italic", fontSize: "0.68rem" }}>
              Waiting for synthetic agent signals...
            </div>
          ) : (
            activityLogs.map((log) => (
              <div
                key={log.id}
                className="sky-log-item"
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "0.4rem",
                  fontSize: "0.68rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ color: "rgba(255, 255, 255, 0.35)", flexShrink: 0, fontSize: "0.62rem" }}>
                  [{log.timeStr}]
                </span>
                <span
                  style={{
                    color: log.color,
                    fontWeight: 600,
                    flexShrink: 0,
                    maxWidth: "110px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {log.agent}
                </span>
                <span
                  style={{
                    color: "rgba(255, 255, 255, 0.80)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {log.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <GenerativeSky
        initialArticles={initialArticles}
        initialEvents={initialEvents}
        liveEvent={latestLiveEvent}
      />
    </>
  );
}
