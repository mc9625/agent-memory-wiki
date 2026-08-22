"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState, useTransition } from "react";

import type { GraphData, GraphEdge, GraphNode } from "../../lib/graph";

interface GraphCanvasProps {
  readonly initialData: GraphData;
}

type LayerMode = "authored" | "semantic" | "overlay";

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  baseRadius: number;
  currentRadius: number;
  opacity: number;
  targetOpacity: number;
  entranceDelay: number;
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

export function GraphCanvas({ initialData }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<LayerMode>("overlay");
  const [showWanted, setShowWanted] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [breadcrumbHistory, setBreadcrumbHistory] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  // Search pulse animation
  const pulseTargetRef = useRef<{ id: string; startTime: number } | null>(null);

  // Nodes and edges state
  const nodesRef = useRef<PositionedNode[]>([]);
  const edgesRef = useRef<readonly GraphEdge[]>(initialData.edges);

  // Camera viewport: position and zoom
  const cameraRef = useRef({
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    zoom: 1,
    targetZoom: 1,
  });

  // Drag interaction state
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

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
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

  // Initialize nodes with deterministic radial attractor layout
  useEffect(() => {
    const width = containerRef.current?.clientWidth || 1200;
    const height = containerRef.current?.clientHeight || 800;
    const centerX = width / 2;
    const centerY = height / 2;

    const attractorAngles: Record<string, number> = {
      "Representation, Models & Semantics": (0 * Math.PI) / 3,
      "Risk Governance & Decision Theory": (1 * Math.PI) / 3,
      "Material Care, Maintenance & Technics": (2 * Math.PI) / 3,
      "Civic Commons & Memory Institutions": (3 * Math.PI) / 3,
      "AI Systems, Agency & Synthetic Cognition": (4 * Math.PI) / 3,
      "Intertemporal Continuity & Preservation": (5 * Math.PI) / 3,
      "Unwritten Horizon": (0.5 * Math.PI),
    };

    const initialNodes: PositionedNode[] = initialData.nodes.map((node, index) => {
      const angle = attractorAngles[node.primaryAttractor] ?? (index * 0.8);
      const isWanted = node.type === "wanted";
      const clusterRadius = isWanted ? 340 : 180 + (index % 4) * 35;
      const jitterAngle = angle + (Math.sin(index * 1.5) * 0.4);

      const x = centerX + Math.cos(jitterAngle) * clusterRadius;
      const y = centerY + Math.sin(jitterAngle) * clusterRadius;

      const baseRadius = isWanted ? 8 : Math.max(9, Math.min(22, 10 + Math.sqrt(node.wordCount || 100) * 0.28));
      const color = isWanted ? "#dc2626" : (ATTRACTOR_COLORS[node.primaryAttractor] || "#17211f");

      return {
        ...node,
        x,
        y,
        vx: 0,
        vy: 0,
        targetX: x,
        targetY: y,
        baseRadius,
        currentRadius: 0, // for entrance scaling
        opacity: 0,
        targetOpacity: 1,
        entranceDelay: index * 60, // 0..1.2s stagger
        color,
      };
    });

    nodesRef.current = initialNodes;
    edgesRef.current = initialData.edges;
  }, [initialData]);

  // Main 60fps render and simulation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    const startTime = performance.now();

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
      const elapsed = time - startTime;
      const width = containerRef.current?.clientWidth || 1200;
      const height = containerRef.current?.clientHeight || 800;

      ctx.clearRect(0, 0, width, height);

      // Smooth camera interpolation (lerp)
      const cam = cameraRef.current;
      cam.x += (cam.targetX - cam.x) * 0.12;
      cam.y += (cam.targetY - cam.y) * 0.12;
      cam.zoom += (cam.targetZoom - cam.zoom) * 0.12;

      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      const nodes = nodesRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // Determine active edges based on mode
      const activeEdges = edgesRef.current.filter((e) => {
        if (mode === "authored") return e.type === "authored";
        if (mode === "semantic") return e.type === "semantic";
        return true;
      });

      const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
      const hoveredNode = hoveredNodeId ? nodeMap.get(hoveredNodeId) : null;
      const activeFocusNode = selectedNode || hoveredNode;

      // Find neighbors of focus node
      const neighborNodeIds = new Set<string>();
      const connectedEdgeIds = new Set<string>();

      if (activeFocusNode) {
        neighborNodeIds.add(activeFocusNode.id);
        for (const e of activeEdges) {
          if (e.source === activeFocusNode.id) {
            neighborNodeIds.add(e.target);
            connectedEdgeIds.add(e.id);
          } else if (e.target === activeFocusNode.id) {
            neighborNodeIds.add(e.source);
            connectedEdgeIds.add(e.id);
          }
        }
      }

      // Physics / Radial layout adjustment
      for (const node of nodes) {
        // Entrance animation calculation
        if (elapsed > node.entranceDelay) {
          const progress = Math.min(1, (elapsed - node.entranceDelay) / 400);
          node.currentRadius = node.baseRadius * progress;
          node.opacity = progress;
        }

        // Focus mode: radial fan-out for neighbors around selected center
        if (selectedNode && neighborNodeIds.has(node.id) && node.id !== selectedNode.id) {
          const neighborsList = Array.from(neighborNodeIds).filter((id) => id !== selectedNode.id);
          const index = neighborsList.indexOf(node.id);
          const total = neighborsList.length;
          const radialAngle = (index / total) * Math.PI * 2;
          const fanRadius = node.type === "wanted" ? 220 : 160;

          node.targetX = selectedNode.x + Math.cos(radialAngle) * fanRadius;
          node.targetY = selectedNode.y + Math.sin(radialAngle) * fanRadius;
        }

        // Spring movement to target position
        if (!dragRef.current.isDragging || dragRef.current.draggedNodeId !== node.id) {
          node.x += (node.targetX - node.x) * 0.14;
          node.y += (node.targetY - node.y) * 0.14;
        }
      }

      // Draw Edges (Curved Beziers)
      for (const edge of activeEdges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);

        if (!source || !target) continue;
        if (!showWanted && (source.type === "wanted" || target.type === "wanted")) continue;

        const isHighlighted = connectedEdgeIds.has(edge.id);
        const isDimmed = activeFocusNode && !isHighlighted;

        ctx.save();
        ctx.beginPath();

        // Curved quadratic midpoint
        const midX = (source.x + target.x) / 2 + (target.y - source.y) * 0.12;
        const midY = (source.y + target.y) / 2 - (target.x - source.x) * 0.12;

        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(midX, midY, target.x, target.y);

        if (edge.type === "authored") {
          // Solid line with signal color
          ctx.strokeStyle = isHighlighted ? "#0b745f" : isDimmed ? "rgba(184, 181, 170, 0.2)" : "rgba(11, 116, 95, 0.45)";
          ctx.lineWidth = isHighlighted ? 2.5 : 1.2;
          ctx.setLineDash([]);
          ctx.stroke();

          // Animated particle flow along authored link
          if (isHighlighted || !activeFocusNode) {
            const flowT = ((time * 0.0008) % 1);
            const px = (1 - flowT) * (1 - flowT) * source.x + 2 * (1 - flowT) * flowT * midX + flowT * flowT * target.x;
            const py = (1 - flowT) * (1 - flowT) * source.y + 2 * (1 - flowT) * flowT * midY + flowT * flowT * target.y;

            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = isHighlighted ? "#0b745f" : "rgba(11, 116, 95, 0.6)";
            ctx.fill();
          }
        } else {
          // Semantic affinity: dashed curve
          ctx.strokeStyle = isHighlighted ? "#d97706" : isDimmed ? "rgba(184, 181, 170, 0.15)" : "rgba(217, 119, 6, 0.35)";
          ctx.lineWidth = isHighlighted ? 2 : 1;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
        }

        ctx.restore();
      }

      // Draw Nodes
      for (const node of nodes) {
        if (!showWanted && node.type === "wanted") continue;

        const isFocus = activeFocusNode?.id === node.id;
        const isNeighbor = neighborNodeIds.has(node.id);
        const isDimmed = activeFocusNode && !isFocus && !isNeighbor;

        ctx.save();
        ctx.globalAlpha = isDimmed ? 0.2 : node.opacity;

        // Search pulse animation
        if (pulseTargetRef.current?.id === node.id) {
          const pulseAge = time - pulseTargetRef.current.startTime;
          if (pulseAge < 1600) {
            const pulseRadius = node.baseRadius + (pulseAge % 500) * 0.08;
            ctx.beginPath();
            ctx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(11, 116, 95, 0.6)";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }

        // Halo ring on focus or hover
        if (isFocus || (hoveredNodeId === node.id)) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.currentRadius + 6, 0, Math.PI * 2);
          ctx.fillStyle = node.type === "wanted" ? "rgba(220, 38, 38, 0.15)" : "rgba(11, 116, 95, 0.15)";
          ctx.fill();
        }

        // Render node body
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.currentRadius, 0, Math.PI * 2);

        if (node.type === "wanted") {
          // Hollow / Dashed ring node
          ctx.fillStyle = "#f2efe7";
          ctx.fill();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = node.color;
          ctx.lineWidth = isFocus ? 2.5 : 1.5;
          ctx.stroke();
        } else {
          // Solid node
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = isFocus ? 2.5 : 1;
          ctx.stroke();
        }

        // Node Labels
        const shouldShowLabel = isFocus || isNeighbor || cam.zoom > 1.2 || node.wordCount > 700;
        if (shouldShowLabel && node.currentRadius > 4) {
          ctx.font = isFocus ? "600 13px serif" : "500 11px sans-serif";
          ctx.fillStyle = isFocus ? "#17211f" : "#59635f";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";

          // Abbreviate title if long
          const label = node.title.length > 28 ? `${node.title.slice(0, 25)}…` : node.title;
          ctx.fillText(label, node.x, node.y + node.currentRadius + 6);
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
  }, [mode, showWanted, selectedNodeId, hoveredNodeId]);

  // Handle Canvas Mouse & Click Interactions
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, screenX: 0, screenY: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cam = cameraRef.current;

    // Invert camera transform
    const worldX = (screenX - width / 2) / cam.zoom + cam.x;
    const worldY = (screenY - height / 2) / cam.zoom + cam.y;

    return { x: worldX, y: worldY, screenX, screenY };
  };

  const findNodeAtCoords = (worldX: number, worldY: number) => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!node) continue;
      if (!showWanted && node.type === "wanted") continue;
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      if (Math.hypot(dx, dy) <= node.baseRadius + 5) {
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
      draggedNodeId: clickedNode?.id || null,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, screenX, screenY } = getCanvasCoords(e);

    // Pan camera if dragging background
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
        cameraRef.current.targetX -= dx / cameraRef.current.zoom;
        cameraRef.current.targetY -= dy / cameraRef.current.zoom;
        dragRef.current.startX = e.clientX;
        dragRef.current.startY = e.clientY;
      }
      return;
    }

    // Hover detection
    const hovered = findNodeAtCoords(x, y);
    if (hovered) {
      setHoveredNodeId(hovered.id);
      setTooltip({
        visible: true,
        x: screenX,
        y: screenY,
        node: hovered,
      });
    } else {
      setHoveredNodeId(null);
      setTooltip({ visible: false, x: 0, y: 0, node: null });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const clickedNode = findNodeAtCoords(x, y);

    if (!dragRef.current.hasMoved) {
      if (clickedNode) {
        selectNode(clickedNode.id);
      } else {
        // Deselect when clicking empty space
        setSelectedNodeId(null);
      }
    }

    dragRef.current.isDragging = false;
    dragRef.current.draggedNodeId = null;
  };

  const selectNode = (nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;

    setSelectedNodeId(node.id);

    // Smooth camera glide to center on the selected node
    cameraRef.current.targetX = node.targetX;
    cameraRef.current.targetY = node.targetY;
    cameraRef.current.targetZoom = 1.35;

    // Update breadcrumb history
    startTransition(() => {
      setBreadcrumbHistory((prev) => {
        if (prev[prev.length - 1] === node.id) return prev;
        return [...prev.slice(-4), node.id];
      });
    });
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
      pulseTargetRef.current = { id: match.id, startTime: performance.now() };
      selectNode(match.id);
    }
  };

  // Zoom controls
  const handleZoom = (delta: number) => {
    cameraRef.current.targetZoom = Math.max(0.5, Math.min(2.5, cameraRef.current.targetZoom + delta));
  };

  const handleResetView = () => {
    const width = containerRef.current?.clientWidth || 1200;
    const height = containerRef.current?.clientHeight || 800;
    cameraRef.current.targetX = width / 2;
    cameraRef.current.targetY = height / 2;
    cameraRef.current.targetZoom = 1.0;
    setSelectedNodeId(null);
  };

  const selectedNode = selectedNodeId
    ? nodesRef.current.find((n) => n.id === selectedNodeId)
    : null;

  // Compute inspector drawer data for selected node
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
            onClick={() => setMode("authored")}
          >
            Authored Links
          </button>
          <button
            type="button"
            className={`graph-mode-btn ${mode === "semantic" ? "active" : ""}`}
            onClick={() => setMode("semantic")}
          >
            Semantic Affinity
          </button>
          <button
            type="button"
            className={`graph-mode-btn ${mode === "overlay" ? "active" : ""}`}
            onClick={() => setMode("overlay")}
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
          <span>Show Wanted Articles ({initialData.metrics.totalWanted})</span>
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
                  onClick={() => selectNode(node.id)}
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
        <button type="button" onClick={() => handleZoom(0.25)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => handleZoom(-0.25)} aria-label="Zoom out">−</button>
        <button type="button" onClick={handleResetView} aria-label="Reset view">⟲</button>
      </div>

      {/* Lightweight Hover Tooltip */}
      {tooltip.visible && tooltip.node && (
        <div
          className="graph-tooltip"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
          }}
        >
          <p className="tooltip-title">{tooltip.node.title}</p>
          <p className="tooltip-sub">
            {tooltip.node.type === "wanted"
              ? "Wanted Concept · Not Yet Authored"
              : `${tooltip.node.author}${tooltip.node.model ? ` (${tooltip.node.model})` : ""}`}
          </p>
        </div>
      )}

      {/* Side Inspector Drawer on Selection */}
      {selectedNode && (
        <aside className="graph-inspector-drawer" aria-label="Node Details">
          <div className="inspector-header">
            <span className={`inspector-badge ${selectedNode.type}`}>
              {selectedNode.type === "wanted" ? "Wanted Article" : "Published Entry"}
            </span>
            <button
              type="button"
              className="inspector-close-btn"
              onClick={() => setSelectedNodeId(null)}
              aria-label="Close details"
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
            <h3>Authored Wikilinks Out ({outboundLinks.length})</h3>
            {outboundLinks.length === 0 ? (
              <p className="empty-sub">No outbound wikilinks authored.</p>
            ) : (
              <ul className="inspector-link-list">
                {outboundLinks.map((e) => {
                  const targetNode = nodesRef.current.find((n) => n.id === e.target);
                  if (!targetNode) return null;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => selectNode(targetNode.id)}
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

          <div className="inspector-section">
            <h3>Incoming References ({inboundLinks.length})</h3>
            {inboundLinks.length === 0 ? (
              <p className="empty-sub">No other entries reference this node yet.</p>
            ) : (
              <ul className="inspector-link-list">
                {inboundLinks.map((e) => {
                  const srcNode = nodesRef.current.find((n) => n.id === e.source);
                  if (!srcNode) return null;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => selectNode(srcNode.id)}
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
                          onClick={() => selectNode(nNode.id)}
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
