"use client";

import { useEffect, useState } from "react";
import { GenerativeSky } from "../../components/generative-sky";
import { SkyArticle, SkyEvent } from "../../components/sky-canvas";

export default function SkyPage() {
  const [initialArticles, setInitialArticles] = useState<SkyArticle[]>([]);
  const [initialEvents, setInitialEvents] = useState<SkyEvent[]>([]);
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

        setInitialArticles(articlesData.items || articlesData.articles || []);
        setInitialEvents(eventsData.items || eventsData.events || []);
      } catch (err: any) {
        setError(err.message || "An error occurred");
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
    const intervalId = setInterval(loadData, 10000);
    return () => clearInterval(intervalId);
  }, []);

  if (error) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-black text-white p-8">
        <h2 className="font-serif text-2xl">Signal Lost</h2>
        <p className="font-mono text-sm opacity-50">{error}</p>
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
      <GenerativeSky initialArticles={initialArticles} initialEvents={initialEvents} />
    </>
  );
}
