"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";

import type { GraphData, GraphEdge, GraphNode } from "../../lib/graph";

interface GraphCanvasProps {
  readonly initialData: GraphData;
}

type LayerMode = "authored" | "semantic" | "overlay";

interface VisualNode extends GraphNode {
  // Current animated render coordinates
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
  opacity: number;
  haloAlpha: number;

  // Transition state
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
  strokeProgress: number; // 0..1 reveal from source/center to target
  targetProgress: number;
  opacity: number;
  targetOpacity: number;
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

  // React state for UI controls and Inspector drawer only
  const [mode, setMode] = useState<LayerMode>("overlay");
  const [showWanted, setShowWanted] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState<boolean>(false);
  const [breadcrumbHistory, setBreadcrumbHistory] = useState<string[]>([]);

  // Refs for high-frequency 60fps animation state (no React re-renders during loop)
  const modeRef = useRef<LayerMode>("overlay");
  const showWantedRef = useRef<boolean>(true);
  const selectedNodeIdRef = useRef<string | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);

  const nodesRef = useRef<VisualNode[]>([]);
  const edgesRef = useRef<VisualEdge[]>([]);

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

  // Drag interaction
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

  // Search pulse animation
  const searchPulseRef = useRef<{ id: string; startTime: number } | null>(null);

  // Tooltip state (ref-driven)
  const tooltipRef = useRef<{
    visible: boolean;
    x: number;
    y: number;
    node: GraphNode | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    node: null,
  });
  const tooltipElRef = useRef<HTMLDivElement | null>(null);

  // Synchronize React state to refs
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    showWantedRef.current = showWanted;
  }, [showWanted]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  // Initialize visual nodes with deterministic overview positions
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

  // Core layout calculator for Butterfly / Bilateral Fan in Focus Mode
  const computeFocusLayout = (focalId: string, currentMode: LayerMode) => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const focalNode = nodes.find((n) => n.id === focalId);
    if (!focalNode) return;

    const activeEdges = edges.filter((e) => {
      if (currentMode === "authored") return e.type === "authored";
      if (currentMode === "semantic") return e.type === "semantic";
      return true;
    });

    // Partition 1st-degree neighbors
    const incomingAuthored: VisualNode[] = [];
    const outgoingAuthored: VisualNode[] = [];
    const semanticNeighbors: VisualNode[] = [];
    const wantedOrbiters: VisualNode[] = [];
    const neighborSet = new Set<string>();

    for (const e of activeEdges) {
      if (e.type === "authored") {
        if (e.target === focalId) {
          const src = nodes.find((n) => n.id === e.source);
          if (src && !neighborSet.has(src.id)) {
            neighborSet.add(src.id);
            if (src.type === "wanted") wantedOrbiters.push(src);
            else incomingAuthored.push(src);
          }
        } else if (e.source === focalId) {
          const tgt = nodes.find((n) => n.id === e.target);
          if (tgt && !neighborSet.has(tgt.id)) {
            neighborSet.add(tgt.id);
            if (tgt.type === "wanted") wantedOrbiters.push(tgt);
            else outgoingAuthored.push(tgt);
          }
        }
      } else if (e.type === "semantic") {
        const otherId = e.source === focalId ? e.target : e.target === focalId ? e.source : null;
        if (otherId && !neighborSet.has(otherId)) {
          const other = nodes.find((n) => n.id === otherId);
          if (other) {
            neighborSet.add(other.id);
            if (other.type === "wanted") wantedOrbiters.push(other);
            else semanticNeighbors.push(other);
          }
        }
      }
    }

    const now = performance.now();
    const duration = 650;

    // 1. Position Central Focal Node
    focalNode.fromX = focalNode.x;
    focalNode.fromY = focalNode.y;
    focalNode.fromScale = focalNode.scale;
    focalNode.fromOpacity = focalNode.opacity;
    focalNode.targetX = 0;
    focalNode.targetY = 0;
    focalNode.targetScale = 1.35;
    focalNode.targetOpacity = 1;
    focalNode.transitionStart = now;
    focalNode.transitionDuration = duration;

    // 2. Position Left Fan: Incoming Authored Links (What Points To It)
    const inTotal = incomingAuthored.length;
    incomingAuthored.forEach((node, idx) => {
      const row = idx - (inTotal - 1) / 2;
      const x = -260 - Math.abs(row) * 22;
      const y = row * 58;

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = x;
      node.targetY = y;
      node.targetScale = 1.05;
      node.targetOpacity = 1;
      node.transitionStart = now + 60 + idx * 25; // 25ms stagger
      node.transitionDuration = duration;
    });

    // 3. Position Right Fan: Outgoing Authored Links (What It Points To)
    const outTotal = outgoingAuthored.length;
    outgoingAuthored.forEach((node, idx) => {
      const row = idx - (outTotal - 1) / 2;
      const x = 260 + Math.abs(row) * 22;
      const y = row * 58;

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = x;
      node.targetY = y;
      node.targetScale = 1.05;
      node.targetOpacity = 1;
      node.transitionStart = now + 60 + idx * 25;
      node.transitionDuration = duration;
    });

    // 4. Position Semantic Neighbors (Top/Bottom Arcs)
    const semTotal = semanticNeighbors.length;
    semanticNeighbors.forEach((node, idx) => {
      const col = idx - (semTotal - 1) / 2;
      const isTop = idx % 2 === 0;
      const x = col * 120;
      const y = isTop ? -210 - Math.abs(col) * 15 : 210 + Math.abs(col) * 15;

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = x;
      node.targetY = y;
      node.targetScale = 0.95;
      node.targetOpacity = 0.9;
      node.transitionStart = now + 100 + idx * 25;
      node.transitionDuration = duration;
    });

    // 5. Position Wanted Orbiters (Dashed rings in outer arc)
    const wTotal = wantedOrbiters.length;
    wantedOrbiters.forEach((node, idx) => {
      const angle = Math.PI * 0.5 + (idx - (wTotal - 1) / 2) * 0.45;
      const x = Math.cos(angle) * 320;
      const y = Math.sin(angle) * 240;

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = x;
      node.targetY = y;
      node.targetScale = 0.9;
      node.targetOpacity = 0.85;
      node.transitionStart = now + 120 + idx * 25;
      node.transitionDuration = duration;
    });

    // 6. Unrelated Nodes: Push outward gently and fade to ghost opacity
    for (const node of nodes) {
      if (node.id === focalId || neighborSet.has(node.id)) continue;

      const angle = Math.atan2(node.overviewY, node.overviewX || 1);
      const pushDist = 580 + (Math.abs(node.overviewX) % 100);

      node.fromX = node.x;
      node.fromY = node.y;
      node.fromScale = node.scale;
      node.fromOpacity = node.opacity;
      node.targetX = Math.cos(angle) * pushDist;
      node.targetY = Math.sin(angle) * pushDist;
      node.targetScale = 0.75;
      node.targetOpacity = 0.12;
      node.transitionStart = now;
      node.transitionDuration = duration;
    }

    // 7. Edge stroke reveals from center outward
    for (const edge of edges) {
      const isConnected = edge.source === focalId || edge.target === focalId;
      if (isConnected) {
        edge.strokeProgress = 0;
        edge.targetProgress = 1;
        edge.opacity = 1;
        edge.targetOpacity = 1;
      } else {
        edge.opacity = 0.1;
        edge.targetOpacity = 0.08;
      }
    }

    // 8. Camera pan to position selected node at ~42% width (leaving room for right drawer)
    const container = containerRef.current;
    const width = container?.clientWidth ?? 1200;
    const cam = cameraRef.current;
    cam.fromX = cam.x;
    cam.fromY = cam.y;
    cam.fromZoom = cam.zoom;
    // Shift camera slightly to the right in world space so focal node (at 0,0) renders at 42% screen width
    cam.targetX = (width * 0.08);
    cam.targetY = 0;
    cam.targetZoom = 1.25;
    cam.transitionStart = now;
    cam.transitionDuration = duration;
  };

  // Reset to Overview layout
  const resetToOverview = () => {
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
    setDrawerVisible(false);
  };

  // Switch node focus with continuous camera and node migration
  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    computeFocusLayout(nodeId, modeRef.current);

    // Update breadcrumbs
    setBreadcrumbHistory((prev) => {
      if (prev[prev.length - 1] === nodeId) return prev;
      return [...prev.slice(-4), nodeId];
    });

    // Drawer coordinated appearance: begins ~120ms after click
    setTimeout(() => {
      setDrawerVisible(true);
    }, 120);
  };

  // Main 60fps Canvas Loop (pure ref-driven, no React state dependency)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    const entranceStart = performance.now();

    const resize = () => {
      if (!containerRef.current || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = (time: number) => {
      const width = containerRef.current?.clientWidth ?? 1200;
      const height = containerRef.current?.clientHeight ?? 800;

      ctx.clearRect(0, 0, width, height);

      // Entrance animation progression (0..900ms)
      const entranceAge = time - entranceStart;
      const entranceAlpha = Math.min(1, entranceAge / 250);

      // Camera interpolation
      const cam = cameraRef.current;
      if (cam.transitionDuration > 0) {
        const t = Math.min(1, (time - cam.transitionStart) / cam.transitionDuration);
        const ease = easeInOutCubic(t);
        cam.x = cam.fromX + (cam.targetX - cam.fromX) * ease;
        cam.y = cam.fromY + (cam.targetY - cam.fromY) * ease;
        cam.zoom = cam.fromZoom + (cam.targetZoom - cam.fromZoom) * ease;
      }

      ctx.save();
      // Center canvas world origin at (width/2, height/2)
      ctx.translate(width / 2, height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      ctx.globalAlpha = entranceAlpha;

      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const currentMode = modeRef.current;
      const showWantedNodes = showWantedRef.current;
      const focalId = selectedNodeIdRef.current;
      const hoverId = hoveredNodeIdRef.current;

      // Filter active edges for mode
      const activeEdges = edges.filter((e) => {
        if (currentMode === "authored") return e.type === "authored";
        if (currentMode === "semantic") return e.type === "semantic";
        return true;
      });

      // Find 1st degree neighbors of hover node (for hover highlight)
      const hoverNeighborSet = new Set<string>();
      if (hoverId) {
        hoverNeighborSet.add(hoverId);
        for (const e of activeEdges) {
          if (e.source === hoverId) hoverNeighborSet.add(e.target);
          else if (e.target === hoverId) hoverNeighborSet.add(e.source);
        }
      }

      // Update Node Positions & Transitions
      for (const node of nodes) {
        // Dragging physics
        if (dragRef.current.isDragging && dragRef.current.draggedNodeId === node.id) {
          // Node is pinned to mouse
          continue;
        }

        // Interpolated transition to target
        if (node.transitionDuration > 0) {
          const t = Math.max(0, Math.min(1, (time - node.transitionStart) / node.transitionDuration));
          const ease = easeInOutCubic(t);
          node.x = node.fromX + (node.targetX - node.fromX) * ease;
          node.y = node.fromY + (node.targetY - node.fromY) * ease;
          node.scale = node.fromScale + (node.targetScale - node.fromScale) * ease;
          node.opacity = node.fromOpacity + (node.targetOpacity - node.fromOpacity) * ease;
        }

        // Apply velocity decay after drag release
        if (Math.abs(node.vx) > 0.01 || Math.abs(node.vy) > 0.01) {
          node.x += node.vx;
          node.y += node.vy;
          node.vx *= 0.82;
          node.vy *= 0.82;
        }

        // Hover micro-scaling (120-160ms smooth lerp)
        const isHovered = hoverId === node.id;
        const targetHalo = isHovered ? 1 : 0;
        node.haloAlpha += (targetHalo - node.haloAlpha) * 0.2;
      }

      // Draw Edges (curved, static when idle, progressive reveal on focus)
      for (const edge of activeEdges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;
        if (!showWantedNodes && (source.type === "wanted" || target.type === "wanted")) continue;

        const isFocalEdge = focalId && (edge.source === focalId || edge.target === focalId);
        const isHoverEdge = hoverId && (edge.source === hoverId || edge.target === hoverId);

        // Edge stroke reveal interpolation
        if (edge.targetProgress > edge.strokeProgress) {
          edge.strokeProgress = Math.min(1, edge.strokeProgress + 0.04);
        }

        ctx.save();
        ctx.beginPath();

        const midX = (source.x + target.x) / 2 + (target.y - source.y) * 0.1;
        const midY = (source.y + target.y) / 2 - (target.x - source.x) * 0.1;

        ctx.moveTo(source.x, source.y);

        if (edge.strokeProgress < 1) {
          // Partial quadratic bezier reveal from source to target
          const t = easeOutCubic(edge.strokeProgress);
          const currX = (1 - t) * (1 - t) * source.x + 2 * (1 - t) * t * midX + t * t * target.x;
          const currY = (1 - t) * (1 - t) * source.y + 2 * (1 - t) * t * midY + t * t * target.y;
          ctx.quadraticCurveTo(
            (1 - t) * source.x + t * midX,
            (1 - t) * source.y + t * midY,
            currX,
            currY
          );
        } else {
          ctx.quadraticCurveTo(midX, midY, target.x, target.y);
        }

        const baseAlpha = focalId ? (isFocalEdge ? 0.9 : 0.08) : (hoverId ? (isHoverEdge ? 0.9 : 0.2) : 0.4);

        if (edge.type === "authored") {
          ctx.strokeStyle = isFocalEdge || isHoverEdge ? "#0b745f" : `rgba(11, 116, 95, ${baseAlpha})`;
          ctx.lineWidth = isFocalEdge || isHoverEdge ? 2.2 : 1.1;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = isFocalEdge || isHoverEdge ? "#d97706" : `rgba(217, 119, 6, ${baseAlpha})`;
          ctx.lineWidth = isFocalEdge || isHoverEdge ? 1.8 : 0.9;
          ctx.setLineDash([4, 4]);
        }

        ctx.stroke();
        ctx.restore();
      }

      // Draw Nodes
      for (const node of nodes) {
        if (!showWantedNodes && node.type === "wanted") continue;

        const isFocal = focalId === node.id;
        const isHovered = hoverId === node.id;
        const isHoverNeighbor = hoverNeighborSet.has(node.id);

        let renderOpacity = node.opacity;
        if (hoverId && !isHovered && !isHoverNeighbor && !focalId) {
          renderOpacity *= 0.4;
        }

        ctx.save();
        ctx.globalAlpha = renderOpacity;

        const baseR = node.radius;
        const hoverScale = 1 + node.haloAlpha * 0.14;
        const currentR = baseR * node.scale * hoverScale;

        // Search pulse animation (2 concentric expanding rings)
        if (searchPulseRef.current?.id === node.id) {
          const pulseAge = time - searchPulseRef.current.startTime;
          if (pulseAge < 900) {
            const p1 = (pulseAge % 450) / 450;
            const r1 = currentR + p1 * 30;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r1, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(11, 116, 95, ${1 - p1})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }

        // Thin Halo Ring on hover or focus
        if (node.haloAlpha > 0.05 || isFocal) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, currentR + 5, 0, Math.PI * 2);
          ctx.fillStyle = node.type === "wanted"
            ? `rgba(220, 38, 38, ${0.15 * (isFocal ? 1 : node.haloAlpha)})`
            : `rgba(11, 116, 95, ${0.15 * (isFocal ? 1 : node.haloAlpha)})`;
          ctx.fill();
        }

        // Node Circle Body
        ctx.beginPath();
        ctx.arc(node.x, node.y, currentR, 0, Math.PI * 2);

        if (node.type === "wanted") {
          // Hollow dashed ring for wanted article
          ctx.fillStyle = "#f8f6f0";
          ctx.fill();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = node.color;
          ctx.lineWidth = isFocal ? 2.5 : 1.5;
          ctx.stroke();
        } else {
          // Solid node
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = isFocal ? 2.5 : 1.2;
          ctx.stroke();
        }

        // Node Label Selection & Rendering
        // Overview: top 5 structural hubs only; Focus: focal node + 1st-degree neighbors; Hover: hovered + neighbors
        const isImportantHub = !focalId && (node.inDegree + node.outDegree >= 2);
        const shouldShowLabel = isFocal || isHovered || isHoverNeighbor || (focalId && node.opacity > 0.6) || isImportantHub;

        if (shouldShowLabel && entranceAge > 300) {
          ctx.font = isFocal
            ? "600 14px var(--serif, serif)"
            : isHovered
            ? "600 12px sans-serif"
            : "500 11px sans-serif";
          ctx.fillStyle = isFocal ? "#17211f" : isHovered ? "#0b745f" : "#59635f";
          ctx.textAlign = isFocal ? "center" : (node.x > 0 ? "left" : "right");
          ctx.textBaseline = "middle";

          const labelOffset = currentR + 8;
          const labelX = isFocal ? node.x : (node.x > 0 ? node.x + labelOffset : node.x - labelOffset);
          const labelY = isFocal ? node.y + currentR + 12 : node.y;

          if (isFocal) {
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
          }

          const label = node.title.length > 32 ? `${node.title.slice(0, 30)}…` : node.title;
          ctx.fillText(label, labelX, labelY);
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

  // Canvas Mouse & Interaction Handlers
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, screenX: 0, screenY: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cam = cameraRef.current;

    // Invert camera transform centered at width/2, height/2
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
      if (Math.hypot(dx, dy) <= node.radius * node.scale + 6) {
        return node;
      }
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
    const { x, y, screenX, screenY } = getCanvasCoords(e);

    // Pan camera or drag node
    if (dragRef.current.isDragging) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 3) {
        dragRef.current.hasMoved = true;
      }

      if (dragRef.current.draggedNodeId) {
        const node = nodesRef.current.find((n) => n.id === dragRef.current.draggedNodeId);
        if (node) {
          const moveX = x - node.x;
          const moveY = y - node.y;
          node.x = x;
          node.y = y;
          node.targetX = x;
          node.targetY = y;

          // Subtle spring reaction on connected neighbors
          for (const edge of edgesRef.current) {
            const otherId = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
            if (otherId) {
              const other = nodesRef.current.find((n) => n.id === otherId);
              if (other && other.id !== node.id) {
                other.x += moveX * 0.12;
                other.y += moveY * 0.12;
              }
            }
          }
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

    // Hover detection (ref-driven)
    const hovered = findNodeAtCoords(x, y);
    if (hovered) {
      hoveredNodeIdRef.current = hovered.id;
      tooltipRef.current = {
        visible: true,
        x: screenX,
        y: screenY,
        node: hovered,
      };
      if (tooltipElRef.current) {
        tooltipElRef.current.style.display = "block";
        tooltipElRef.current.style.left = `${screenX + 14}px`;
        tooltipElRef.current.style.top = `${screenY + 14}px`;
        const titleEl = tooltipElRef.current.querySelector(".tooltip-title");
        const subEl = tooltipElRef.current.querySelector(".tooltip-sub");
        if (titleEl) titleEl.textContent = hovered.title;
        if (subEl) {
          subEl.textContent = hovered.type === "wanted"
            ? "Wanted Article · Not yet written"
            : `${hovered.author} · ${hovered.inDegree + hovered.outDegree} connections`;
        }
      }
    } else {
      hoveredNodeIdRef.current = null;
      tooltipRef.current.visible = false;
      if (tooltipElRef.current) {
        tooltipElRef.current.style.display = "none";
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const clickedNode = findNodeAtCoords(x, y);

    if (!dragRef.current.hasMoved) {
      if (clickedNode) {
        handleSelectNode(clickedNode.id);
      } else {
        // Deselect when clicking background: return to overview
        resetToOverview();
      }
    }

    dragRef.current.isDragging = false;
    dragRef.current.draggedNodeId = null;
  };

  // Search handler with concentric pulse and focus transition
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const term = searchQuery.toLowerCase().trim();
    const match = nodesRef.current.find(
      (n) => n.title.toLowerCase().includes(term) || n.author.toLowerCase().includes(term)
    );

    if (match) {
      searchPulseRef.current = { id: match.id, startTime: performance.now() };
      handleSelectNode(match.id);
    }
  };

  // Layer mode switcher with smooth morph transition
  const handleModeChange = (newMode: LayerMode) => {
    setMode(newMode);
    modeRef.current = newMode;

    if (selectedNodeIdRef.current) {
      computeFocusLayout(selectedNodeIdRef.current, newMode);
    } else {
      resetToOverview();
    }
  };

  const selectedNode = selectedNodeId
    ? nodesRef.current.find((n) => n.id === selectedNodeId)
    : null;

  // Selected node metadata and relations for Inspector Drawer
  const activeEdges = edgesRef.current.filter((e) => {
    if (mode === "authored") return e.type === "authored";
    if (mode === "semantic") return e.type === "semantic";
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
    <div className="graph-observatory-container" ref={containerRef}>
      {/* Top Floating Control Bar */}
      <div className="graph-hud-top">
        <div className="graph-mode-selector" role="group" aria-label="Layer modes">
          <button
            type="button"
            className={`graph-mode-btn ${mode === "authored" ? "active" : ""}`}
            onClick={() => handleModeChange("authored")}
          >
            Authored Links
          </button>
          <button
            type="button"
            className={`graph-mode-btn ${mode === "semantic" ? "active" : ""}`}
            onClick={() => handleModeChange("semantic")}
          >
            Semantic Affinity
          </button>
          <button
            type="button"
            className={`graph-mode-btn ${mode === "overlay" ? "active" : ""}`}
            onClick={() => handleModeChange("overlay")}
          >
            Overlay (Both)
          </button>
        </div>

        <form onSubmit={handleSearchSubmit} className="graph-search-form">
          <input
            type="search"
            placeholder="Search concept or wanted article..."
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

      {/* Breadcrumb Spatial Navigation Stack */}
      {breadcrumbHistory.length > 1 && (
        <nav className="graph-breadcrumbs" aria-label="Exploration trail">
          <span className="crumb-label">Path:</span>
          {breadcrumbHistory.map((id, index) => {
            const node = nodesRef.current.find((n) => n.id === id);
            if (!node) return null;
            const isLast = index === breadcrumbHistory.length - 1;
            return (
              <React.Fragment key={id}>
                <button
                  type="button"
                  className={`crumb-btn ${isLast ? "active" : ""}`}
                  onClick={() => handleSelectNode(node.id)}
                >
                  {node.title}
                </button>
                {!isLast && <span className="crumb-sep">→</span>}
              </React.Fragment>
            );
          })}
        </nav>
      )}

      {/* Interactive HTML5 Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="graph-canvas"
      />

      {/* Floating Zoom & Reset Tools */}
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
        <button type="button" onClick={resetToOverview} aria-label="Reset overview">
          ⟲
        </button>
      </div>

      {/* High Performance Direct DOM Tooltip */}
      <div ref={tooltipElRef} className="graph-tooltip" style={{ display: "none" }}>
        <p className="tooltip-title"></p>
        <p className="tooltip-sub"></p>
      </div>

      {/* Side Inspector Drawer (Coordinated Slide-in on Focus) */}
      {selectedNode && (
        <aside className={`graph-inspector-drawer ${drawerVisible ? "visible" : ""}`} aria-label="Node Details">
          <div className="inspector-header">
            <span className={`inspector-badge ${selectedNode.type}`}>
              {selectedNode.type === "wanted" ? "Wanted Article" : "Published Entry"}
            </span>
            <button
              type="button"
              className="inspector-close-btn"
              onClick={resetToOverview}
              aria-label="Close details and return to overview"
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
                        onClick={() => handleSelectNode(srcNode.id)}
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
                        onClick={() => handleSelectNode(targetNode.id)}
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
                          onClick={() => handleSelectNode(nNode.id)}
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
  );
}
