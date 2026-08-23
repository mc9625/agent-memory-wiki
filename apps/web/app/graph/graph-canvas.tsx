"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";

import type { GraphData, GraphEdge, GraphNode } from "../../lib/graph";

interface GraphCanvasProps {
  readonly initialData: GraphData;
}

type LayerMode = "authored" | "semantic" | "overlay";
type ViewState = "overview" | "local" | "deep";

interface VisualNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
  opacity: number;
  haloAlpha: number;

  fromX: number;
  fromY: number;
  fromScale: number;
  fromOpacity: number;
  targetX: number;
  targetY: number;
  targetScale: number;
  targetOpacity: number;
  transitionStart: number;
  transitionDuration: number;

  color: string;
}

interface VisualEdge extends GraphEdge {
  strokeProgress: number;
  targetProgress: number;
  opacity: number;
  targetOpacity: number;
}

interface LocalStackItem {
  id: string;
  nodeId: string;
  title: string;
  type: "incoming" | "outgoing" | "semantic" | "wanted";
  isWanted: boolean;
  color: string;
}

const ATTRACTOR_COLORS: Record<string, string> = {
  "Representation, Models & Semantics": "#2563eb",
  "Risk Governance & Decision Theory": "#d97706",
  "Material Care, Maintenance & Technics": "#0b745f",
  "Civic Commons & Memory Institutions": "#0284c7",
  "AI Systems, Agency & Synthetic Cognition": "#7c3aed",
  "Intertemporal Continuity & Preservation": "#059669",
  "Unwritten Horizon": "#dc2626",
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function GraphCanvas({ initialData }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // React state for UI controls, ViewState, and Inspector
  const [layerMode, setLayerMode] = useState<LayerMode>("overlay");
  const [viewState, setViewState] = useState<ViewState>("overview");
  const [showWanted, setShowWanted] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [breadcrumbHistory, setBreadcrumbHistory] = useState<string[]>([]);

  // High-frequency 60fps Refs
  const layerModeRef = useRef<LayerMode>("overlay");
  const viewStateRef = useRef<ViewState>("overview");
  const showWantedRef = useRef<boolean>(true);
  const selectedNodeIdRef = useRef<string | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const hoveredStackItemRef = useRef<string | null>(null);

  const nodesRef = useRef<VisualNode[]>([]);
  const edgesRef = useRef<VisualEdge[]>([]);

  // Local Selection Stack ref
  const localStackRef = useRef<{
    focalNodeId: string;
    items: LocalStackItem[];
    animProgress: number;
    side: "left" | "right";
  }>({
    focalNodeId: "",
    items: [],
    animProgress: 0,
    side: "right",
  });

  // Camera viewport
  const cameraRef = useRef({
    x: 0,
    y: 0,
    fromX: 0,
    fromY: 0,
    targetX: 0,
    targetY: 0,
    zoom: 1,
    fromZoom: 1,
    targetZoom: 1,
    transitionStart: 0,
    transitionDuration: 0,
  });

  // Drag state
  const dragRef = useRef<{
    isDragging: boolean;
    draggedNodeId: string | null;
    startX: number;
    startY: number;
    hasMoved: boolean;
  }>({
    isDragging: false,
    draggedNodeId: null,
    startX: 0,
    startY: 0,
    hasMoved: false,
  });

  // Search pulse
  const searchPulseRef = useRef<{ id: string; startTime: number } | null>(null);

  // Sync state to refs
  useEffect(() => {
    layerModeRef.current = layerMode;
  }, [layerMode]);

  useEffect(() => {
    showWantedRef.current = showWanted;
  }, [showWanted]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  // Initialize visual nodes
  useEffect(() => {
    const visualNodes: VisualNode[] = initialData.nodes.map((n) => {
      const isWanted = n.type === "wanted";
      const color = isWanted ? "#dc2626" : (ATTRACTOR_COLORS[n.primaryAttractor] ?? "#17211f");

      return {
        ...n,
        x: n.overviewX,
        y: n.overviewY,
        vx: 0,
        vy: 0,
        scale: 1,
        opacity: 1,
        haloAlpha: 0,
        fromX: n.overviewX,
        fromY: n.overviewY,
        fromScale: 1,
        fromOpacity: 1,
        targetX: n.overviewX,
        targetY: n.overviewY,
        targetScale: 1,
        targetOpacity: 1,
        transitionStart: 0,
        transitionDuration: 0,
        color,
      };
    });

    const visualEdges: VisualEdge[] = initialData.edges.map((e) => ({
      ...e,
      strokeProgress: 1,
      targetProgress: 1,
      opacity: 1,
      targetOpacity: 1,
    }));

    nodesRef.current = visualNodes;
    edgesRef.current = visualEdges;
  }, [initialData]);

  // STATE 1: Reset to OVERVIEW
  const setOverviewState = () => {
    const now = performance.now();
    const duration = 600;

    for (const node of nodesRef.current) {
      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = node.overviewX;
      node.targetY = node.overviewY;
      node.targetScale = 1;
      node.targetOpacity = 1;
      node.transitionStart = now;
      node.transitionDuration = duration;
    }

    for (const edge of edgesRef.current) {
      edge.strokeProgress = 1;
      edge.targetProgress = 1;
      edge.opacity = 1;
      edge.targetOpacity = 1;
    }

    localStackRef.current = {
      focalNodeId: "",
      items: [],
      animProgress: 0,
      side: "right",
    };

    const cam = cameraRef.current;
    cam.fromX = cam.x;
    cam.fromY = cam.y;
    cam.fromZoom = cam.zoom;
    cam.targetX = 0;
    cam.targetY = 0;
    cam.targetZoom = 1.05;
    cam.transitionStart = now;
    cam.transitionDuration = duration;

    setSelectedNodeId(null);
    setViewState("overview");
    setInspectorOpen(false);
  };

  // STATE 2: LOCAL SELECTION (Compact in-situ connection stack beside node)
  const setLocalSelectionState = (nodeId: string) => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const focal = nodes.find((n) => n.id === nodeId);
    if (!focal) return;

    const currentMode = layerModeRef.current;
    const activeEdges = edges.filter((e) => {
      if (currentMode === "authored") return e.type === "authored";
      if (currentMode === "semantic") return e.type === "semantic";
      return true;
    });

    // Build local connection items (Incoming, Outgoing, Semantic, Wanted)
    const items: LocalStackItem[] = [];
    const seen = new Set<string>();

    for (const e of activeEdges) {
      if (e.type === "authored") {
        if (e.target === nodeId) {
          const src = nodes.find((n) => n.id === e.source);
          if (src && !seen.has(src.id)) {
            if (!showWantedRef.current && src.type === "wanted") continue;
            seen.add(src.id);
            items.push({
              id: `in-${src.id}`,
              nodeId: src.id,
              title: src.title,
              type: src.type === "wanted" ? "wanted" : "incoming",
              isWanted: src.type === "wanted",
              color: src.color,
            });
          }
        } else if (e.source === nodeId) {
          const tgt = nodes.find((n) => n.id === e.target);
          if (tgt && !seen.has(tgt.id)) {
            if (!showWantedRef.current && tgt.type === "wanted") continue;
            seen.add(tgt.id);
            items.push({
              id: `out-${tgt.id}`,
              nodeId: tgt.id,
              title: tgt.title,
              type: tgt.type === "wanted" ? "wanted" : "outgoing",
              isWanted: tgt.type === "wanted",
              color: tgt.color,
            });
          }
        }
      } else if (e.type === "semantic") {
        const otherId = e.source === nodeId ? e.target : e.target === nodeId ? e.source : null;
        if (otherId && !seen.has(otherId)) {
          const other = nodes.find((n) => n.id === otherId);
          if (other) {
            if (!showWantedRef.current && other.type === "wanted") continue;
            seen.add(other.id);
            items.push({
              id: `sem-${other.id}`,
              nodeId: other.id,
              title: other.title,
              type: other.type === "wanted" ? "wanted" : "semantic",
              isWanted: other.type === "wanted",
              color: other.color,
            });
          }
        }
      }
    }

    const now = performance.now();
    const duration = 500;

    // Determine stack side (left or right depending on node position in overview)
    const side = focal.overviewX > 140 ? "left" : "right";

    localStackRef.current = {
      focalNodeId: nodeId,
      items: items.slice(0, 8),
      animProgress: 0,
      side,
    };

    // Softly highlight focal node and slightly attenuate others
    for (const node of nodes) {
      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = node.overviewX;
      node.targetY = node.overviewY;
      node.transitionStart = now;
      node.transitionDuration = duration;

      if (node.id === nodeId) {
        node.targetScale = 1.3;
        node.targetOpacity = 1;
      } else {
        // Mute all background nodes to a very faint watermark
        node.targetScale = 0.65;
        node.targetOpacity = 0.10;
      }
    }

    // Micro-pan camera toward node
    const cam = cameraRef.current;
    cam.fromX = cam.x;
    cam.fromY = cam.y;
    cam.fromZoom = cam.zoom;
    cam.targetX = focal.overviewX * 0.45;
    cam.targetY = focal.overviewY * 0.45;
    cam.targetZoom = 1.1;
    cam.transitionStart = now;
    cam.transitionDuration = duration;

    setSelectedNodeId(nodeId);
    setViewState("local");
    setInspectorOpen(false);

    // Update breadcrumbs
    setBreadcrumbHistory((prev) => {
      if (prev[prev.length - 1] === nodeId) return prev;
      return [...prev.slice(-4), nodeId];
    });
  };

  // STATE 3: DEEP FOCUS (Horizontal Radial Tree / Viewport-Aware Bilateral Fan)
  const setDeepFocusState = (nodeId: string) => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const focal = nodes.find((n) => n.id === nodeId);
    if (!focal) return;

    const currentMode = layerModeRef.current;
    const activeEdges = edges.filter((e) => {
      if (currentMode === "authored") return e.type === "authored";
      if (currentMode === "semantic") return e.type === "semantic";
      return true;
    });

    const incoming: VisualNode[] = [];
    const outgoing: VisualNode[] = [];
    const neighborSet = new Set<string>();

    for (const e of activeEdges) {
      if (e.type === "authored") {
        if (e.target === nodeId) {
          const src = nodes.find((n) => n.id === e.source);
          if (src && !neighborSet.has(src.id)) {
            if (!showWantedRef.current && src.type === "wanted") continue;
            neighborSet.add(src.id);
            incoming.push(src);
          }
        } else if (e.source === nodeId) {
          const tgt = nodes.find((n) => n.id === e.target);
          if (tgt && !neighborSet.has(tgt.id)) {
            if (!showWantedRef.current && tgt.type === "wanted") continue;
            neighborSet.add(tgt.id);
            outgoing.push(tgt);
          }
        }
      } else if (e.type === "semantic") {
        const otherId = e.source === nodeId ? e.target : e.target === nodeId ? e.source : null;
        if (otherId && !neighborSet.has(otherId)) {
          const other = nodes.find((n) => n.id === otherId);
          if (other) {
            if (!showWantedRef.current && other.type === "wanted") continue;
            neighborSet.add(other.id);
            // Distribute semantic neighbors balanced across sides
            if (incoming.length <= outgoing.length) incoming.push(other);
            else outgoing.push(other);
          }
        }
      }
    }

    // Viewport-aware layout calculation (Compact & Centered)
    const stage = stageRef.current;
    const stageWidth = stage?.clientWidth ?? 900;
    const stageHeight = stage?.clientHeight ?? 650;

    // Safe area margins
    const maxLeftCount = Math.max(1, incoming.length);
    const maxRightCount = Math.max(1, outgoing.length);
    const maxCount = Math.max(maxLeftCount, maxRightCount);

    const rowGap = Math.max(30, Math.min(46, (stageHeight * 0.58) / maxCount));
    const fanSpanX = Math.max(140, Math.min(220, stageWidth * 0.19));

    const now = performance.now();
    const duration = 650;

    // 1. Focal Node: Center (0, 0)
    focal.fromX = focal.x;
    focal.fromY = focal.y;
    focal.fromScale = focal.scale;
    focal.fromOpacity = focal.opacity;
    focal.targetX = 0;
    focal.targetY = 0;
    focal.targetScale = 2.0; // Clean central hub (~26px)
    focal.targetOpacity = 1;
    focal.transitionStart = now;
    focal.transitionDuration = duration;

    // 2. Left Column: Incoming Links (Markers with right-aligned text)
    incoming.forEach((node, idx) => {
      const row = idx - (incoming.length - 1) / 2;
      const y = row * rowGap;
      const x = -fanSpanX - (Math.abs(row) * 6);

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = x;
      node.targetY = y;
      node.targetScale = 0.5; // Small endpoint marker (~4-5px)
      node.targetOpacity = 1;
      node.transitionStart = now + 40 + idx * 25;
      node.transitionDuration = duration;
    });

    // 3. Right Column: Outgoing Links & Semantic Relations
    outgoing.forEach((node, idx) => {
      const row = idx - (outgoing.length - 1) / 2;
      const y = row * rowGap;
      const x = fanSpanX + (Math.abs(row) * 6);

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = x;
      node.targetY = y;
      node.targetScale = 0.5;
      node.targetOpacity = 1;
      node.transitionStart = now + 40 + idx * 25;
      node.transitionDuration = duration;
    });

    // 4. Unrelated Ghost Nodes: completely fade out in Deep Focus
    for (const node of nodes) {
      if (node.id === nodeId || neighborSet.has(node.id)) continue;

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = node.overviewX * 1.3;
      node.targetY = node.overviewY * 1.3;
      node.targetScale = 0.2;
      node.targetOpacity = 0; // Completely faded out
      node.transitionStart = now;
      node.transitionDuration = duration;
    }

    // 5. Progressive edge reveal
    for (const edge of edges) {
      const isConnected = edge.source === nodeId || edge.target === nodeId;
      if (isConnected) {
        edge.strokeProgress = 0;
        edge.targetProgress = 1;
        edge.opacity = 1;
        edge.targetOpacity = 1;
      } else {
        edge.opacity = 0;
        edge.targetOpacity = 0;
      }
    }

    // Clear local selection stack on deep focus
    localStackRef.current = {
      focalNodeId: "",
      items: [],
      animProgress: 0,
      side: "right",
    };

    // 6. Camera Zoom: default 1.05 centered at (0, 0)
    const cam = cameraRef.current;
    cam.fromX = cam.x;
    cam.fromY = cam.y;
    cam.fromZoom = cam.zoom;
    cam.targetX = 0;
    cam.targetY = 0;
    cam.targetZoom = 1.05;
    cam.transitionStart = now;
    cam.transitionDuration = duration;

    setSelectedNodeId(nodeId);
    setViewState("deep");
    setInspectorOpen(true);
  };

  // Main 60fps Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    const entranceStart = performance.now();

    const resize = () => {
      if (!stageRef.current || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = stageRef.current.clientWidth;
      const height = stageRef.current.clientHeight;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = (time: number) => {
      const stage = stageRef.current;
      const width = stage?.clientWidth ?? 900;
      const height = stage?.clientHeight ?? 650;

      ctx.clearRect(0, 0, width, height);

      // Entrance fade
      const entranceAge = time - entranceStart;
      const entranceAlpha = Math.min(1, entranceAge / 200);

      // Camera lerp
      const cam = cameraRef.current;
      if (cam.transitionDuration > 0) {
        const t = Math.min(1, (time - cam.transitionStart) / cam.transitionDuration);
        const ease = easeInOutCubic(t);
        cam.x = cam.fromX + (cam.targetX - cam.fromX) * ease;
        cam.y = cam.fromY + (cam.targetY - cam.fromY) * ease;
        cam.zoom = cam.fromZoom + (cam.targetZoom - cam.fromZoom) * ease;
      }

      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      ctx.globalAlpha = entranceAlpha;

      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const currentMode = layerModeRef.current;
      const currentState = viewStateRef.current;
      const showWantedNodes = showWantedRef.current;
      const focalId = selectedNodeIdRef.current;
      const hoverId = hoveredNodeIdRef.current;

      const activeEdges = edges.filter((e) => {
        if (currentMode === "authored") return e.type === "authored";
        if (currentMode === "semantic") return e.type === "semantic";
        return true;
      });

      // Update Node Transitions
      for (const node of nodes) {
        if (dragRef.current.isDragging && dragRef.current.draggedNodeId === node.id) {
          continue;
        }

        if (node.transitionDuration > 0) {
          const t = Math.max(0, Math.min(1, (time - node.transitionStart) / node.transitionDuration));
          const ease = easeInOutCubic(t);
          node.x = node.fromX + (node.targetX - node.fromX) * ease;
          node.y = node.fromY + (node.targetY - node.fromY) * ease;
          node.scale = node.fromScale + (node.targetScale - node.fromScale) * ease;
          node.opacity = node.fromOpacity + (node.targetOpacity - node.fromOpacity) * ease;
        }

        if (Math.abs(node.vx) > 0.01 || Math.abs(node.vy) > 0.01) {
          node.x += node.vx;
          node.y += node.vy;
          node.vx *= 0.82;
          node.vy *= 0.82;
        }

        const isHovered = hoverId === node.id;
        const targetHalo = isHovered ? 1 : 0;
        node.haloAlpha += (targetHalo - node.haloAlpha) * 0.2;
      }

      // Draw Edges (Clean horizontal cubic Beziers in Deep Focus, smooth quadratic in overview)
      for (const edge of activeEdges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;
        if (!showWantedNodes && (source.type === "wanted" || target.type === "wanted")) continue;

        const isFocalEdge = focalId && (edge.source === focalId || edge.target === focalId);
        const isHoverEdge = hoverId && (edge.source === hoverId || edge.target === hoverId);

        // In Local Selection, connections are cleanly presented in the local tendril fan beside the node;
        // avoid drawing redundant spiderweb lines across the background map.
        if (currentState === "local" && isFocalEdge) continue;

        // In Deep Focus, only render the horizontal cubic Bezier fan of the relational diagram
        if (currentState === "deep" && !isFocalEdge) continue;

        if (edge.targetProgress > edge.strokeProgress) {
          edge.strokeProgress = Math.min(1, edge.strokeProgress + 0.045);
        }

        ctx.save();
        ctx.beginPath();

        if (currentState === "deep" && focalId && isFocalEdge) {
          // Horizontal Cubic Bezier fan with common tangent at focal center
          const isFocalSource = edge.source === focalId;
          const endpoint = isFocalSource ? target : source;
          const side = endpoint.x >= 0 ? 1 : -1;
          const dx = endpoint.x;

          // Shared horizontal tangent at center
          const cp1X = side * Math.abs(dx) * 0.42;
          const cp1Y = 0;
          const cp2X = endpoint.x - side * Math.abs(dx) * 0.22;
          const cp2Y = endpoint.y;

          ctx.moveTo(0, 0);

          if (edge.strokeProgress < 1) {
            const t = easeOutCubic(edge.strokeProgress);
            const bx = (1-t)*(1-t)*(1-t)*0 + 3*(1-t)*(1-t)*t*cp1X + 3*(1-t)*t*t*cp2X + t*t*t*endpoint.x;
            const by = (1-t)*(1-t)*(1-t)*0 + 3*(1-t)*(1-t)*t*cp1Y + 3*(1-t)*t*t*cp2Y + t*t*t*endpoint.y;
            ctx.bezierCurveTo(cp1X * t, cp1Y * t, cp2X * t, cp2Y * t, bx, by);
          } else {
            ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endpoint.x, endpoint.y);
          }
        } else {
          // Standard quadratic bezier for overview / non-focal background
          const midX = (source.x + target.x) / 2 + (target.y - source.y) * 0.08;
          const midY = (source.y + target.y) / 2 - (target.x - source.x) * 0.08;

          ctx.moveTo(source.x, source.y);
          ctx.quadraticCurveTo(midX, midY, target.x, target.y);
        }

        const baseAlpha = currentState === "local" ? 0.12 : (isHoverEdge ? 0.85 : 0.35);

        if (edge.type === "authored") {
          ctx.strokeStyle = isHoverEdge ? "#0b745f" : `rgba(11, 116, 95, ${baseAlpha})`;
          ctx.lineWidth = isHoverEdge ? 1.8 : 1.0;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = isHoverEdge ? "#d97706" : `rgba(217, 119, 6, ${baseAlpha})`;
          ctx.lineWidth = isHoverEdge ? 1.5 : 0.9;
          ctx.setLineDash([4, 4]);
        }

        ctx.stroke();
        ctx.restore();
      }

      // Draw Local Selection Tendrils Fan (STATE 2 - Matching Screenshot 1)
      if (currentState === "local" && localStackRef.current.focalNodeId) {
        const stack = localStackRef.current;
        const focal = nodeMap.get(stack.focalNodeId);
        if (focal && stack.items.length > 0) {
          const isRight = stack.side === "right";
          const fanSpanX = isRight ? 180 : -180;
          const itemHeight = 28;
          const totalHeight = (stack.items.length - 1) * itemHeight;
          const startY = focal.y - totalHeight / 2;

          ctx.save();

          // Group Header Label
          ctx.font = "700 10px sans-serif";
          ctx.fillStyle = "var(--muted, #59635f)";
          ctx.textAlign = isRight ? "left" : "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(
            `CONNECTIONS (${stack.items.length})`,
            focal.x + fanSpanX,
            startY - 14
          );

          // Draw each tendril line and endpoint
          stack.items.forEach((item, idx) => {
            const endpointX = focal.x + fanSpanX;
            const endpointY = startY + idx * itemHeight;
            const isHovered = hoveredStackItemRef.current === item.id;

            // Smooth cubic bezier from focal node to endpoint
            ctx.beginPath();
            ctx.moveTo(focal.x, focal.y);
            const side = isRight ? 1 : -1;
            const cp1X = focal.x + side * 70;
            const cp1Y = focal.y;
            const cp2X = endpointX - side * 40;
            const cp2Y = endpointY;
            ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endpointX, endpointY);

            ctx.strokeStyle = isHovered ? "#0b745f" : "rgba(11, 116, 95, 0.45)";
            ctx.lineWidth = isHovered ? 2.2 : 1.2;
            ctx.setLineDash(item.type === "semantic" || item.isWanted ? [3, 3] : []);
            ctx.stroke();

            // Endpoint marker dot
            ctx.beginPath();
            ctx.arc(endpointX, endpointY, isHovered ? 4.5 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle = item.color;
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Endpoint label text
            ctx.font = isHovered ? "600 12px sans-serif" : "500 11px sans-serif";
            ctx.fillStyle = isHovered ? "#0b745f" : "#17211f";
            ctx.textAlign = isRight ? "left" : "right";
            ctx.textBaseline = "middle";

            const labelX = isRight ? endpointX + 10 : endpointX - 10;
            const label = item.title.length > 28 ? `${item.title.slice(0, 26)}…` : item.title;
            ctx.fillText(label, labelX, endpointY);
          });

          ctx.restore();
        }
      }

      // Draw Column Headers in Deep Focus (STATE 3 - Matching Screenshot 2)
      if (currentState === "deep" && focalId) {
        ctx.save();
        ctx.font = "700 10px sans-serif";
        ctx.fillStyle = "var(--muted, #59635f)";

        ctx.textAlign = "right";
        ctx.fillText("INCOMING LINKS", -140, -170);

        ctx.textAlign = "left";
        ctx.fillText("OUTGOING & SEMANTIC", 140, -170);
        ctx.restore();
      }

      // Draw Nodes (Large Focal Center + Small Endpoints in Deep Focus)
      for (const node of nodes) {
        if (!showWantedNodes && node.type === "wanted") continue;
        if (currentState === "deep" && node.opacity < 0.05) continue;

        const isFocal = focalId === node.id;
        const isHovered = hoverId === node.id;

        ctx.save();
        ctx.globalAlpha = node.opacity;

        const baseR = node.radius;
        const currentR = baseR * node.scale;

        // Search pulse
        if (searchPulseRef.current?.id === node.id) {
          const pulseAge = time - searchPulseRef.current.startTime;
          if (pulseAge < 900) {
            const p1 = (pulseAge % 450) / 450;
            ctx.beginPath();
            ctx.arc(node.x, node.y, currentR + p1 * 32, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(11, 116, 95, ${1 - p1})`;
            ctx.lineWidth = 1.8;
            ctx.stroke();
          }
        }

        // Halo Ring
        if (node.haloAlpha > 0.05 || (isFocal && currentState !== "deep")) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, currentR + 6, 0, Math.PI * 2);
          ctx.fillStyle = node.type === "wanted"
            ? "rgba(220, 38, 38, 0.15)"
            : "rgba(11, 116, 95, 0.15)";
          ctx.fill();
        }

        // Circle Body
        ctx.beginPath();
        ctx.arc(node.x, node.y, currentR, 0, Math.PI * 2);

        if (node.type === "wanted") {
          ctx.fillStyle = "#f8f6f0";
          ctx.fill();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = node.color;
          ctx.lineWidth = isFocal ? 2.5 : 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = isFocal ? 3.0 : 1.2;
          ctx.stroke();
        }

        // Deep Focus Labels & Standard Labels
        if (currentState === "deep") {
          if (isFocal) {
            // Prominent Title under Center Node
            ctx.font = "600 16px var(--serif, serif)";
            ctx.fillStyle = "#17211f";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(node.title, node.x, node.y + currentR + 12);

            ctx.font = "500 11px sans-serif";
            ctx.fillStyle = "#59635f";
            ctx.fillText(`${node.author}${node.model ? ` (${node.model})` : ""}`, node.x, node.y + currentR + 32);
          } else if (node.opacity > 0.6) {
            // Left & Right Endpoint Full Labels
            const isLeft = node.x < 0;
            ctx.font = "500 12px sans-serif";
            ctx.fillStyle = isHovered ? "#0b745f" : "#17211f";
            ctx.textAlign = isLeft ? "right" : "left";
            ctx.textBaseline = "middle";

            const labelOffset = currentR + 10;
            const labelX = isLeft ? node.x - labelOffset : node.x + labelOffset;
            ctx.fillText(node.title, labelX, node.y);
          }
        } else {
          // Overview & Local Selection Labels
          if (currentState === "local" && !isFocal) {
            // In local selection, background node labels are suppressed
          } else {
            const isOverviewHub = !focalId && (node.inDegree + node.outDegree >= 2);
            if ((isFocal || isHovered || isOverviewHub) && entranceAge > 250) {
              ctx.font = isFocal ? "600 13px var(--serif, serif)" : "500 11px sans-serif";
              ctx.fillStyle = isFocal ? "#17211f" : "#59635f";
              ctx.textAlign = isFocal ? "center" : (node.x > 0 ? "left" : "right");
              ctx.textBaseline = isFocal ? "top" : "middle";

              const labelX = isFocal ? node.x : (node.x > 0 ? node.x + currentR + 8 : node.x - currentR - 8);
              const labelY = isFocal ? node.y + currentR + 8 : node.y;
              const label = node.title.length > 28 ? `${node.title.slice(0, 26)}…` : node.title;
              ctx.fillText(label, labelX, labelY);
            }
          }
        }

        ctx.restore();
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Mouse & Click Handlers
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return { x: 0, y: 0, screenX: 0, screenY: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const cam = cameraRef.current;

    const worldX = (screenX - width / 2) / cam.zoom + cam.x;
    const worldY = (screenY - height / 2) / cam.zoom + cam.y;

    return { x: worldX, y: worldY, screenX, screenY };
  };

  const findNodeAtCoords = (worldX: number, worldY: number) => {
    const nodes = nodesRef.current;
    const showWantedNodes = showWantedRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!node) continue;
      if (!showWantedNodes && node.type === "wanted") continue;
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      if (Math.hypot(dx, dy) <= node.radius * node.scale + 8) {
        return node;
      }
    }
    return null;
  };

  const findLocalStackItemAtCoords = (worldX: number, worldY: number) => {
    if (viewStateRef.current !== "local") return null;
    const stack = localStackRef.current;
    const focal = nodesRef.current.find((n) => n.id === stack.focalNodeId);
    if (!focal || stack.items.length === 0) return null;

    const stackWidth = 210;
    const itemHeight = 32;
    const stackHeight = stack.items.length * itemHeight + 36;
    const stackX = stack.side === "right" ? focal.x + 36 : focal.x - stackWidth - 36;
    const stackY = focal.y - stackHeight / 2;

    if (worldX >= stackX && worldX <= stackX + stackWidth && worldY >= stackY + 34 && worldY <= stackY + stackHeight) {
      const index = Math.floor((worldY - (stackY + 34)) / itemHeight);
      return stack.items[index] ?? null;
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const clickedNode = findNodeAtCoords(x, y);

    dragRef.current = {
      isDragging: true,
      draggedNodeId: clickedNode?.id ?? null,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);

    if (dragRef.current.isDragging) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 3) {
        dragRef.current.hasMoved = true;
      }

      if (dragRef.current.draggedNodeId) {
        const node = nodesRef.current.find((n) => n.id === dragRef.current.draggedNodeId);
        if (node) {
          node.x = x;
          node.y = y;
          node.targetX = x;
          node.targetY = y;
        }
      } else {
        cameraRef.current.x -= dx / cameraRef.current.zoom;
        cameraRef.current.y -= dy / cameraRef.current.zoom;
        cameraRef.current.targetX = cameraRef.current.x;
        cameraRef.current.targetY = cameraRef.current.y;
        dragRef.current.startX = e.clientX;
        dragRef.current.startY = e.clientY;
      }
      return;
    }

    // Hover detection
    const hoveredNode = findNodeAtCoords(x, y);
    hoveredNodeIdRef.current = hoveredNode?.id ?? null;

    const hoveredStack = findLocalStackItemAtCoords(x, y);
    hoveredStackItemRef.current = hoveredStack?.id ?? null;
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const clickedNode = findNodeAtCoords(x, y);
    const clickedStackItem = findLocalStackItemAtCoords(x, y);

    if (!dragRef.current.hasMoved) {
      if (clickedStackItem) {
        // Click item inside local selection stack -> morph to Deep Focus on that item
        setDeepFocusState(clickedStackItem.nodeId);
      } else if (clickedNode) {
        if (viewStateRef.current === "overview") {
          // 1st Click on Node: open in-situ LOCAL SELECTION
          setLocalSelectionState(clickedNode.id);
        } else if (viewStateRef.current === "local") {
          if (clickedNode.id === selectedNodeIdRef.current) {
            // 2nd Click on same node: open DEEP FOCUS
            setDeepFocusState(clickedNode.id);
          } else {
            setLocalSelectionState(clickedNode.id);
          }
        } else {
          // In DEEP FOCUS: navigate directly to clicked neighbor
          setDeepFocusState(clickedNode.id);
        }
      } else {
        // Click background: step back
        if (viewStateRef.current === "deep") {
          setOverviewState();
        } else if (viewStateRef.current === "local") {
          setOverviewState();
        }
      }
    }

    dragRef.current.isDragging = false;
    dragRef.current.draggedNodeId = null;
  };

  // Search handler
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const term = searchQuery.toLowerCase().trim();
    const match = nodesRef.current.find(
      (n) => n.title.toLowerCase().includes(term) || n.author.toLowerCase().includes(term)
    );

    if (match) {
      searchPulseRef.current = { id: match.id, startTime: performance.now() };
      setDeepFocusState(match.id);
    }
  };

  // Layer mode changer with morph
  const handleModeChange = (newMode: LayerMode) => {
    setLayerMode(newMode);
    layerModeRef.current = newMode;

    if (viewStateRef.current === "deep" && selectedNodeIdRef.current) {
      setDeepFocusState(selectedNodeIdRef.current);
    } else if (viewStateRef.current === "local" && selectedNodeIdRef.current) {
      setLocalSelectionState(selectedNodeIdRef.current);
    } else {
      setOverviewState();
    }
  };

  const selectedNode = selectedNodeId
    ? nodesRef.current.find((n) => n.id === selectedNodeId)
    : null;

  // Compute inspector drawer data
  const activeEdges = edgesRef.current.filter((e) => {
    if (layerMode === "authored") return e.type === "authored";
    if (layerMode === "semantic") return e.type === "semantic";
    return true;
  });

  const outboundLinks = selectedNode
    ? activeEdges.filter((e) => e.source === selectedNode.id && e.type === "authored")
    : [];
  const inboundLinks = selectedNode
    ? activeEdges.filter((e) => e.target === selectedNode.id && e.type === "authored")
    : [];
  const semanticNeighbors = selectedNode
    ? activeEdges.filter(
        (e) =>
          e.type === "semantic" &&
          (e.source === selectedNode.id || e.target === selectedNode.id)
      )
    : [];

  return (
    <div className="graph-observatory-wrapper" ref={containerRef}>
      {/* Dedicated Controls & Filter Header Strip (Outside Canvas) */}
      <div className="graph-top-bar">
        <div className="graph-mode-selector" role="group" aria-label="Layer modes">
          <button
            type="button"
            className={`graph-mode-btn ${layerMode === "authored" ? "active" : ""}`}
            onClick={() => handleModeChange("authored")}
          >
            Authored Links
          </button>
          <button
            type="button"
            className={`graph-mode-btn ${layerMode === "semantic" ? "active" : ""}`}
            onClick={() => handleModeChange("semantic")}
          >
            Semantic Affinity
          </button>
          <button
            type="button"
            className={`graph-mode-btn ${layerMode === "overlay" ? "active" : ""}`}
            onClick={() => handleModeChange("overlay")}
          >
            Overlay (Both)
          </button>
        </div>

        <form onSubmit={handleSearchSubmit} className="graph-search-form">
          <input
            type="search"
            placeholder="Find concept or wanted article..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="graph-search-input"
          />
        </form>

        <label className="graph-wanted-toggle">
          <input
            type="checkbox"
            checked={showWanted}
            onChange={(e) => setShowWanted(e.target.checked)}
          />
          <span>Show Wanted ({initialData.metrics.totalWanted})</span>
        </label>
      </div>

      {/* Dedicated Path Bar (Outside Canvas) */}
      <div className="graph-path-bar">
        <span className="crumb-label">Path:</span>
        {breadcrumbHistory.length === 0 ? (
          <span className="crumb-empty">Overview (Click any node to explore connections)</span>
        ) : (
          <div className="crumb-trail">
            {breadcrumbHistory.map((id, index) => {
              const node = nodesRef.current.find((n) => n.id === id);
              if (!node) return null;
              const isLast = index === breadcrumbHistory.length - 1;
              return (
                <React.Fragment key={id}>
                  <button
                    type="button"
                    className={`crumb-btn ${isLast ? "active" : ""}`}
                    onClick={() => setDeepFocusState(node.id)}
                  >
                    {node.title}
                  </button>
                  {!isLast && <span className="crumb-sep">→</span>}
                </React.Fragment>
              );
            })}
          </div>
        )}
        {viewState !== "overview" && (
          <button type="button" className="crumb-reset-btn" onClick={setOverviewState}>
            Reset to Overview ⟲
          </button>
        )}
      </div>

      {/* Side-by-Side Main Stage and Coordinated Inspector Panel */}
      <div className="graph-stage-layout">
        <div className="graph-canvas-stage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="graph-canvas"
          />

          {/* Floating Zoom Controls */}
          <div className="graph-zoom-controls">
            <button
              type="button"
              onClick={() => {
                cameraRef.current.fromZoom = cameraRef.current.zoom;
                cameraRef.current.targetZoom = Math.min(2.5, cameraRef.current.zoom + 0.25);
                cameraRef.current.transitionStart = performance.now();
                cameraRef.current.transitionDuration = 300;
              }}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                cameraRef.current.fromZoom = cameraRef.current.zoom;
                cameraRef.current.targetZoom = Math.max(0.5, cameraRef.current.zoom - 0.25);
                cameraRef.current.transitionStart = performance.now();
                cameraRef.current.transitionDuration = 300;
              }}
              aria-label="Zoom out"
            >
              −
            </button>
            <button type="button" onClick={setOverviewState} aria-label="Reset overview">
              ⟲
            </button>
          </div>
        </div>

        {/* Coordinated Side-by-Side Inspector Panel */}
        {selectedNode && inspectorOpen && (
          <aside className="graph-side-inspector" aria-label="Node Relations Inspector">
            <div className="inspector-header">
              <span className={`inspector-badge ${selectedNode.type}`}>
                {selectedNode.type === "wanted" ? "Wanted Article" : "Published Entry"}
              </span>
              <button
                type="button"
                className="inspector-close-btn"
                onClick={setOverviewState}
                aria-label="Close inspector"
              >
                ×
              </button>
            </div>

            <h2 className="inspector-title">{selectedNode.title}</h2>

            <div className="inspector-meta-grid">
              <div>
                <span className="meta-lbl">Primary Attractor</span>
                <p className="meta-val">{selectedNode.primaryAttractor}</p>
              </div>
              {selectedNode.type === "article" && (
                <div>
                  <span className="meta-lbl">Author / Model</span>
                  <p className="meta-val">
                    {selectedNode.author} {selectedNode.model && `(${selectedNode.model})`}
                  </p>
                </div>
              )}
              {selectedNode.type === "article" && (
                <div>
                  <span className="meta-lbl">Word Count</span>
                  <p className="meta-val">{selectedNode.wordCount} words</p>
                </div>
              )}
            </div>

            <div className="inspector-section">
              <h3>Incoming Links ({inboundLinks.length})</h3>
              {inboundLinks.length === 0 ? (
                <p className="empty-sub">No inbound links point to this entry.</p>
              ) : (
                <ul className="inspector-link-list">
                  {inboundLinks.map((e) => {
                    const srcNode = nodesRef.current.find((n) => n.id === e.source);
                    if (!srcNode) return null;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setDeepFocusState(srcNode.id)}
                          className="inspector-link-btn"
                        >
                          {srcNode.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="inspector-section">
              <h3>Outgoing Links ({outboundLinks.length})</h3>
              {outboundLinks.length === 0 ? (
                <p className="empty-sub">No outbound links authored in this entry.</p>
              ) : (
                <ul className="inspector-link-list">
                  {outboundLinks.map((e) => {
                    const targetNode = nodesRef.current.find((n) => n.id === e.target);
                    if (!targetNode) return null;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setDeepFocusState(targetNode.id)}
                          className="inspector-link-btn"
                        >
                          {targetNode.type === "wanted" ? `[[${targetNode.title}]]` : targetNode.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {selectedNode.type === "article" && (
              <div className="inspector-section">
                <h3>Semantic Neighbors ({semanticNeighbors.length})</h3>
                {semanticNeighbors.length === 0 ? (
                  <p className="empty-sub">No close semantic neighbors above threshold.</p>
                ) : (
                  <ul className="inspector-link-list">
                    {semanticNeighbors.map((e) => {
                      const neighborId = e.source === selectedNode.id ? e.target : e.source;
                      const nNode = nodesRef.current.find((n) => n.id === neighborId);
                      if (!nNode) return null;
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setDeepFocusState(nNode.id)}
                            className="inspector-link-btn"
                          >
                            {nNode.title} <span className="meta-score">({Math.round(e.weight * 100)}%)</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <div className="inspector-footer">
              {selectedNode.type === "article" ? (
                <Link href={`/articles/${selectedNode.slug}`} className="btn-primary">
                  Open Complete Article →
                </Link>
              ) : (
                <Link href={`/wanted?target=${encodeURIComponent(selectedNode.title)}`} className="btn-primary">
                  View Wanted Observatory →
                </Link>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
