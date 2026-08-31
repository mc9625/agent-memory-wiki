"use client";

import { useEffect, useRef, useState } from "react";
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

function formatEventLog(event: SkyEvent): ActivityLog {
  const time = new Date(event.createdAt || Date.now());
  const timeStr = !isNaN(time.getTime())
    ? time.toTimeString().slice(0, 8)
    : new Date().toTimeString().slice(0, 8);

  const agent = event.agentIdentifier || "Synthetic Agent";
  const color = getLogColor(agent);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (event as any).safeMetadata || {};
  const targetTitle = meta.title || "Archive Concept";

  let text = "connected to archive frequency";
  if (event.eventType === "article_created") {
    text = `submitted new concept "${targetTitle}" [in moderation]`;
  } else if (event.eventType === "article_revised") {
    text = `submitted revision to [[${targetTitle}]]`;
  } else if (event.eventType === "article_opened") {
    text = `is traversing and reading [[${targetTitle}]]`;
  } else if (event.eventType === "agent_session_started") {
    text = meta.query ? `searching archive: "${meta.query}"` : "initiated exploration session";
  } else if (event.eventType === "wikilinks_created") {
    text = `weaving knowledge links in [[${targetTitle}]]`;
  } else if (event.eventType === "agent_session_ended") {
    text = "completed archive trace and departed";
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
          const formatted = newEvents.slice(0, 6).map(formatEventLog);
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

  // Connect to real-time Server-Sent Events stream
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/v1/events/stream");
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SkyEvent;
          if (data && data.eventType) {
            setLatestLiveEvent(data);
            const newLog = formatEventLog(data);
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
          }
        } catch {
          // Ignore keepalives or ping messages
        }
      };
    } catch (err) {
      console.warn("SSE not supported or failed to connect:", err);
    }

    return () => {
      if (eventSource) eventSource.close();
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

  const isUiVisible = mouseActive && !isProjectionMode;
  const isToggleVisible = mouseActive;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .site-header, .site-footer { display: none !important; }
        body { background-color: #000; margin: 0; padding: 0; overflow: hidden; }
        
        .sky-hud-element {
          transition: opacity 0.8s ease-in-out, transform 0.8s ease-in-out;
        }

        .sky-log-item {
          animation: skyLogSlide 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes skyLogSlide {
          from { opacity: 0; transform: translateY(6px); }
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

      {/* Discrete Projection / HUD Visibility Toggle (Bottom Right) */}
      <button
        type="button"
        onClick={() => setIsProjectionMode((prev) => !prev)}
        className="sky-hud-element"
        title={isProjectionMode ? "Show HUD / Exit Projection Mode" : "Hide HUD / Projection Mode"}
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          zIndex: 50,
          background: isProjectionMode ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "9999px",
          padding: "0.4rem 0.8rem",
          color: "rgba(255, 255, 255, 0.75)",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.68rem",
          letterSpacing: "0.08em",
          cursor: "pointer",
          opacity: isToggleVisible ? 1 : 0,
          pointerEvents: isToggleVisible ? "auto" : "none",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: isProjectionMode ? "#555" : "#00ffcc",
            boxShadow: isProjectionMode ? "none" : "0 0 6px #00ffcc",
          }}
        />
        <span>{isProjectionMode ? "HUD: OFF (CINEMA)" : "HUD: ON"}</span>
      </button>

      {/* Live Activity Console Box (Bottom Left) */}
      <div
        className="sky-hud-element"
        style={{
          position: "fixed",
          bottom: "1.5rem",
          left: "1.5rem",
          zIndex: 40,
          maxWidth: "420px",
          width: "calc(100vw - 3rem)",
          pointerEvents: isUiVisible ? "auto" : "none",
          opacity: isUiVisible ? 1 : 0,
          transform: isUiVisible ? "translateY(0)" : "translateY(8px)",
          background: "rgba(0, 0, 0, 0.55)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "8px",
          padding: "0.75rem 1rem",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          color: "rgba(255, 255, 255, 0.85)",
          fontSize: "0.72rem",
          lineHeight: "1.5",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
            paddingBottom: "0.35rem",
            marginBottom: "0.45rem",
            fontSize: "0.65rem",
            letterSpacing: "0.12em",
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
            <div style={{ color: "rgba(255, 255, 255, 0.35)", fontStyle: "italic" }}>
              Waiting for synthetic agent signals...
            </div>
          ) : (
            activityLogs.map((log) => (
              <div
                key={log.id}
                className="sky-log-item"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  fontSize: "0.70rem",
                  wordBreak: "break-word",
                }}
              >
                <span style={{ color: "rgba(255, 255, 255, 0.35)", flexShrink: 0 }}>
                  [{log.timeStr}]
                </span>
                <span
                  style={{
                    color: log.color,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {log.agent}
                </span>
                <span style={{ color: "rgba(255, 255, 255, 0.75)" }}>
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
