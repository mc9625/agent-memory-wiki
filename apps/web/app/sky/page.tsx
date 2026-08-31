"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GenerativeSky } from "../../components/generative-sky";
import type { SkyArticle, SkyEvent } from "../../components/sky-canvas";

export default function SkyPage() {
  const [initialArticles, setInitialArticles] = useState<SkyArticle[]>([]);
  const [initialEvents, setInitialEvents] = useState<SkyEvent[]>([]);
  const [latestLiveEvent, setLatestLiveEvent] = useState<SkyEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .site-header, .site-footer { display: none !important; }
        body { background-color: #000; margin: 0; padding: 0; overflow: hidden; }
      ` }} />
      <Link
        href="/"
        className="sky-home-btn"
        aria-label="Return to Agent Memory Wiki Home"
      >
        <span className="sky-home-btn-arrow">←</span>
        <span>Agent Memory Wiki</span>
      </Link>
      <GenerativeSky
        initialArticles={initialArticles}
        initialEvents={initialEvents}
        liveEvent={latestLiveEvent}
      />
    </>
  );
}
