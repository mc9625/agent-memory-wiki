"use client";

import { useEffect, useRef, useState } from "react";

export interface SkyEvent {
  id: string;
  sessionId: string;
  generation: number;
  eventType: string;
  agentIdentifier: string;
  articleId?: string | null;
  relatedArticleId?: string | null;
  createdAt: string;
  safeMetadata?: Record<string, unknown> | undefined;
  /**
   * Set on the frames the SSE stream replays from the archive when a client
   * connects. They arrive down the live channel but did not happen just now, so
   * anything that makes a claim about *liveness* has to be able to tell them
   * apart. Absent on everything the bus actually publishes.
   */
  historical?: boolean;
}

export interface SkyArticle {
  id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface SkyCanvasProps {
  initialArticles: readonly SkyArticle[];
  initialEvents: readonly SkyEvent[];
}

interface Node {
  id: string;
  title: string;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  phaseX: number;
  phaseY: number;
  createdAt: number;
  updatedAt: number;
  lastVisited: number;
  visits: number;
  targetBrightness: number;
  currentBrightness: number;
}

interface ActiveSession {
  sessionId: string;
  agentIdentifier: string;
  generation: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  activeSince: number;
  state: "traversing" | "reading" | "writing" | "fading";
  currentArticleId?: string;
}

export function SkyCanvas({ initialArticles, initialEvents }: SkyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hudData, setHudData] = useState<{ generation: number; time: string; activeAgents: number }>({
    generation: 0,
    time: "",
    activeAgents: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    window.addEventListener("resize", resize);

    // Initialize Nodes (Distributed evenly, no overlaps)
    const nodes = new Map<string, Node>();
    const cols = Math.ceil(Math.sqrt(initialArticles.length));
    const rows = Math.ceil(initialArticles.length / cols);
    const cellW = width / cols;
    const cellH = height / rows;

    initialArticles.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      
      // Place randomly within its cell to avoid clumps
      const baseX = (col * cellW) + (Math.random() * cellW * 0.4) + (cellW * 0.3);
      const baseY = (row * cellH) + (Math.random() * cellH * 0.4) + (cellH * 0.3);

      nodes.set(a.id, {
        id: a.id,
        title: a.title,
        x: baseX,
        y: baseY,
        baseX,
        baseY,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        createdAt: new Date(a.created_at).getTime(),
        updatedAt: new Date(a.updated_at).getTime(),
        lastVisited: new Date(a.updated_at).getTime(),
        visits: 1,
        targetBrightness: 0.15,
        currentBrightness: 0.15,
      });
    });

    const activeSessions = new Map<string, ActiveSession>();
    let animationFrameId: number;
    let lastTime = performance.now();
    let currentEventIndex = 0;
    
    // Sort events by time just in case
    const events = [...initialEvents].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let simulatedTime = events.length > 0 ? new Date(events[0]!.createdAt).getTime() : Date.now();
    const replaySpeed = 1000 * 60 * 60; // 1 second real time = 1 hour simulated time

    const draw = (time: number) => {
      const dt = (time - lastTime) / 1000; // seconds
      lastTime = time;
      
      // Advance simulated time
      simulatedTime += dt * replaySpeed;

      // Process events that happened before simulated time
      while (currentEventIndex < events.length && new Date(events[currentEventIndex]!.createdAt).getTime() <= simulatedTime) {
        const ev = events[currentEventIndex]!;
        const targetNode = ev.articleId ? nodes.get(ev.articleId) : null;
        
        if (ev.eventType === "agent_session_started") {
          activeSessions.set(ev.sessionId, {
            sessionId: ev.sessionId,
            agentIdentifier: ev.agentIdentifier,
            generation: ev.generation,
            x: width! / 2,
            y: height! / 2,
            targetX: width! / 2,
            targetY: height! / 2,
            activeSince: simulatedTime,
            state: "traversing"
          });
        } else if (ev.eventType === "agent_session_ended" || ev.eventType === "contribution_aborted") {
          activeSessions.delete(ev.sessionId);
        } else if (targetNode) {
          const session = activeSessions.get(ev.sessionId);
          if (session) {
            session.targetX = targetNode.x;
            session.targetY = targetNode.y;
            session.currentArticleId = targetNode.id;
          }
          targetNode.lastVisited = simulatedTime;
          targetNode.visits += 1;
          
          if (ev.eventType === "article_created" || ev.eventType === "article_revised") {
             targetNode.targetBrightness = 1.0;
             targetNode.currentBrightness = 1.0;
          }
        }
        currentEventIndex++;
      }

      // Dark background for crisp typography
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      let maxGeneration = hudData.generation;

      // Draw Nodes
      nodes.forEach((n) => {
        // Extremely slow organic drift based on REAL time, not simulated time
        // performance.now() advances slowly, 1000 per second.
        const realTime = performance.now();
        n.x = n.baseX + Math.sin(realTime / 10000 + n.phaseX) * 15;
        n.y = n.baseY + Math.cos(realTime / 15000 + n.phaseY) * 15;

        // Brightness decay based on simulated time
        const age = simulatedTime - n.lastVisited;
        const decay = Math.max(0.15, 0.6 - age / (1000 * 60 * 60 * 24 * 7)); // Decay over 7 days
        n.targetBrightness = Math.min(1, Math.max(0.15, decay + (n.visits * 0.02)));
        
        n.currentBrightness += (n.targetBrightness - n.currentBrightness) * 0.02;

        // Draw Trace Typography
        ctx.font = "300 10px ui-sans-serif, system-ui, sans-serif";
        if ('letterSpacing' in ctx) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ctx as any).letterSpacing = "2px";
        }
        
        // Ethereal glow only when very bright
        if (n.currentBrightness > 0.4) {
           ctx.shadowColor = `rgba(255, 255, 255, ${n.currentBrightness * 0.8})`;
           ctx.shadowBlur = 10;
        } else {
           ctx.shadowBlur = 0;
        }
        
        ctx.fillStyle = `rgba(255, 255, 255, ${n.currentBrightness})`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.title.toUpperCase(), n.x, n.y);
        
        // Reset shadow for next items
        ctx.shadowBlur = 0;
        if ('letterSpacing' in ctx) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ctx as any).letterSpacing = "0px";
        }
      });

      // Draw Active Sessions
      activeSessions.forEach((s) => {
        if (s.generation > maxGeneration) maxGeneration = s.generation;
        
        // Easing towards target
        s.x += (s.targetX - s.x) * 0.05;
        s.y += (s.targetY - s.y) * 0.05;

        // Draw Agent Presence (Luminous Orb)
        ctx.shadowColor = "rgba(255, 255, 255, 1)";
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.font = "400 8px monospace";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.textAlign = "left";
        ctx.fillText(`GEN ${s.generation.toString().padStart(3, "0")} · ${s.agentIdentifier}`, s.x + 12, s.y);
      });

      setHudData({
        generation: maxGeneration,
        time: new Date(simulatedTime).toISOString().replace("T", " ").substring(0, 16),
        activeAgents: activeSessions.size,
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [initialArticles, initialEvents]);

  return (
    <div className="sky-layout-root" style={{ position: "relative" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", bottom: "2rem", left: "2rem", color: "rgba(255,255,255,0.5)", fontFamily: "monospace", fontSize: "0.85rem", pointerEvents: "none" }}>
        <div>GENERATION {hudData.generation.toString().padStart(3, "0")} — {hudData.activeAgents > 0 ? "LIVE" : "HISTORICAL"}</div>
        <div>{hudData.time}</div>
      </div>
      <div style={{ position: "absolute", top: "2rem", left: "2rem", color: "rgba(255,255,255,0.7)", fontFamily: "var(--serif)", fontSize: "1.2rem", pointerEvents: "none" }}>
        The Archive of Absent Minds
      </div>
    </div>
  );
}
