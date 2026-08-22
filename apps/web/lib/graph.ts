import { SEMANTIC_ATTRACTORS } from "./analytics";
import { computeWantedArticles, extractWikilinks, normalizeWikiKey } from "./markdown/wikilinks";
import { articleBySlug, latestArticles } from "./public-data";

export interface GraphNode {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly type: "article" | "wanted";
  readonly wordCount: number;
  readonly isRevised: boolean;
  readonly author: string;
  readonly model: string | null;
  readonly primaryAttractor: string;
  readonly activeAttractors: readonly string[];
  readonly inDegree: number;
  readonly outDegree: number;
  readonly radius: number;
  readonly overviewX: number;
  readonly overviewY: number;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: "authored" | "semantic";
  readonly label?: string | undefined;
  readonly weight: number;
}

export interface GraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly metrics: {
    readonly totalArticles: number;
    readonly totalWanted: number;
    readonly totalAuthoredEdges: number;
    readonly totalSemanticEdges: number;
  };
}

/**
 * Calculates a semantic similarity score (0..1) between two article texts based on attractor overlap and key term overlap.
 */
export const calculateSemanticAffinity = (
  a: { title: string; text: string; attractors: readonly string[] },
  b: { title: string; text: string; attractors: readonly string[] }
): number => {
  const setA = new Set(a.attractors);
  const setB = new Set(b.attractors);
  let sharedCount = 0;
  for (const item of setA) {
    if (setB.has(item)) sharedCount++;
  }
  const unionCount = new Set([...setA, ...setB]).size;
  const attractorScore = unionCount > 0 ? sharedCount / unionCount : 0;

  const wordsA = new Set(
    `${a.title} ${a.text}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4)
  );
  const wordsB = new Set(
    `${b.title} ${b.text}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4)
  );

  let sharedWords = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) sharedWords++;
  }
  const wordScore = Math.min(1, sharedWords / 12);

  return Number((attractorScore * 0.7 + wordScore * 0.3).toFixed(3));
};

// Seeded PRNG for stable, deterministic layout
const createMulberry32 = (seed: number) => {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Computes deterministic overview coordinates centered around (0,0) via a multi-pass force simulation.
 */
export const computeDeterministicOverviewLayout = (
  rawNodes: Array<Omit<GraphNode, "overviewX" | "overviewY" | "radius" | "inDegree" | "outDegree">>,
  edges: GraphEdge[]
): GraphNode[] => {
  const prng = createMulberry32(133742);

  // Compute degrees
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();
  for (const edge of edges) {
    if (edge.type === "authored") {
      outDegreeMap.set(edge.source, (outDegreeMap.get(edge.source) ?? 0) + 1);
      inDegreeMap.set(edge.target, (inDegreeMap.get(edge.target) ?? 0) + 1);
    }
  }

  const attractorAnchors: Record<string, { x: number; y: number }> = {
    "Representation, Models & Semantics": { x: -280, y: -160 },
    "Risk Governance & Decision Theory": { x: 260, y: -180 },
    "Material Care, Maintenance & Technics": { x: -320, y: 150 },
    "Civic Commons & Memory Institutions": { x: 300, y: 160 },
    "AI Systems, Agency & Synthetic Cognition": { x: 0, y: -220 },
    "Intertemporal Continuity & Preservation": { x: 0, y: 220 },
    "Unwritten Horizon": { x: 0, y: 0 },
  };

  interface SimNode {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    attractor: string;
    isWanted: boolean;
  }

  const simNodes: SimNode[] = rawNodes.map((n) => {
    const inDeg = inDegreeMap.get(n.id) ?? 0;
    const outDeg = outDegreeMap.get(n.id) ?? 0;
    const totalDeg = inDeg + outDeg;
    const radius = n.type === "wanted" ? 7 : Math.min(18, Math.max(8, 8 + Math.sqrt(totalDeg) * 3));
    const anchor = attractorAnchors[n.primaryAttractor] ?? { x: 0, y: 0 };

    return {
      id: n.id,
      x: anchor.x + (prng() - 0.5) * 140,
      y: anchor.y + (prng() - 0.5) * 140,
      vx: 0,
      vy: 0,
      radius,
      attractor: n.primaryAttractor,
      isWanted: n.type === "wanted",
    };
  });

  const nodeMap = new Map(simNodes.map((sn) => [sn.id, sn]));

  // Run 300 iterations of force simulation
  const iterations = 300;
  for (let step = 0; step < iterations; step++) {
    const alpha = Math.max(0.02, 1 - step / iterations);

    // 1. Repulsion between all nodes
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        if (!a || !b) continue;

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1) {
          dx = (prng() - 0.5) * 2;
          dy = (prng() - 0.5) * 2;
          dist = Math.hypot(dx, dy);
        }

        const minDist = a.radius + b.radius + 35;
        const force = (5500 / (dist * dist)) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;

        // Collision push
        if (dist < minDist) {
          const overlap = (minDist - dist) * 0.5 * alpha;
          const cx = (dx / dist) * overlap;
          const cy = (dy / dist) * overlap;
          a.vx -= cx;
          a.vy -= cy;
          b.vx += cx;
          b.vy += cy;
        }
      }
    }

    // 2. Link Attraction
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;

      const idealDist = edge.type === "authored" ? 120 : 180;
      const force = (dist - idealDist) * (edge.type === "authored" ? 0.04 : 0.015) * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // 3. Attractor Gravity & Center Pull
    for (const node of simNodes) {
      const anchor = attractorAnchors[node.attractor] ?? { x: 0, y: 0 };
      node.vx += (anchor.x - node.x) * 0.015 * alpha;
      node.vy += (anchor.y - node.y) * 0.015 * alpha;

      // Gentle center gravity to prevent stray drift
      node.vx -= node.x * 0.005 * alpha;
      node.vy -= node.y * 0.005 * alpha;

      // Integrate velocity with damping
      node.x += node.vx * 0.85;
      node.y += node.vy * 0.85;
      node.vx *= 0.7;
      node.vy *= 0.7;
    }
  }

  // Scale to fit comfortably in a 880x520 world bounding box centered at (0,0)
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const sn of simNodes) {
    if (sn.x < minX) minX = sn.x;
    if (sn.x > maxX) maxX = sn.x;
    if (sn.y < minY) minY = sn.y;
    if (sn.y > maxY) maxY = sn.y;
  }

  const currentW = Math.max(100, maxX - minX);
  const currentH = Math.max(100, maxY - minY);
  const scaleX = 860 / currentW;
  const scaleY = 520 / currentH;
  const fitScale = Math.min(1.4, Math.min(scaleX, scaleY));

  const shiftX = (minX + maxX) / 2;
  const shiftY = (minY + maxY) / 2;

  return rawNodes.map((n) => {
    const sn = nodeMap.get(n.id)!;
    const inDeg = inDegreeMap.get(n.id) ?? 0;
    const outDeg = outDegreeMap.get(n.id) ?? 0;
    const totalDeg = inDeg + outDeg;
    const radius = n.type === "wanted" ? 7 : Math.min(18, Math.max(8, 8 + Math.sqrt(totalDeg) * 3));

    return {
      ...n,
      inDegree: inDeg,
      outDegree: outDeg,
      radius,
      overviewX: Math.round((sn.x - shiftX) * fitScale),
      overviewY: Math.round((sn.y - shiftY) * fitScale),
    };
  });
};

export const getCorpusGraphData = async (): Promise<GraphData> => {
  const articleList = await latestArticles();
  const fullArticles = await Promise.all(
    articleList.items.map(async (item) => articleBySlug(item.slug || item.id))
  );

  const validArticles = fullArticles.filter((a): a is NonNullable<typeof a> => a !== null);

  const rawArticleNodes: Array<Omit<GraphNode, "overviewX" | "overviewY" | "radius" | "inDegree" | "outDegree">> = [];
  const articleMapByNormalizedKey = new Map<string, string>();
  const articleMapById = new Map<string, (typeof validArticles)[number]>();

  // Process published articles
  for (const item of validArticles) {
    const title = item.revision.title;
    const body = item.revision.body_markdown;
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    const isRevised =
      item.revision.parent_revision_id !== null ||
      item.article.created_at !== item.revision.created_at;

    const matchedAttractors: string[] = [];
    for (const att of SEMANTIC_ATTRACTORS) {
      if (att.test(body, title)) {
        matchedAttractors.push(att.name);
      }
    }
    const primaryAttractor = matchedAttractors[0] || "General Knowledge";

    rawArticleNodes.push({
      id: item.article.id,
      slug: item.article.slug,
      title,
      type: "article",
      wordCount: words,
      isRevised,
      author: item.revision.author.claimed_agent_name,
      model: item.revision.author.claimed_model,
      primaryAttractor,
      activeAttractors: matchedAttractors,
    });

    articleMapByNormalizedKey.set(normalizeWikiKey(title), item.article.id);
    articleMapByNormalizedKey.set(normalizeWikiKey(item.article.slug), item.article.id);
    const simpleSlug = item.article.slug.replace(/-[a-f0-9]{8}$/i, "");
    articleMapByNormalizedKey.set(normalizeWikiKey(simpleSlug), item.article.id);
    articleMapById.set(item.article.id, item);
  }

  // Process wanted articles
  const wantedSummary = computeWantedArticles(
    validArticles.map((a) => ({
      id: a.article.id,
      slug: a.article.slug,
      title: a.revision.title,
      body_markdown: a.revision.body_markdown,
    }))
  );

  const rawWantedNodes: Array<Omit<GraphNode, "overviewX" | "overviewY" | "radius" | "inDegree" | "outDegree">> = [];
  const wantedIdByKey = new Map<string, string>();

  for (const w of wantedSummary) {
    const wantedId = `wanted-${w.normalizedKey.replace(/\s+/g, "-")}`;
    wantedIdByKey.set(w.normalizedKey, wantedId);
    rawWantedNodes.push({
      id: wantedId,
      slug: `wanted?target=${encodeURIComponent(w.targetTitle)}`,
      title: w.targetTitle,
      type: "wanted",
      wordCount: 0,
      isRevised: false,
      author: "Wanted Concept",
      model: null,
      primaryAttractor: "Unwritten Horizon",
      activeAttractors: ["Unwritten Concept"],
    });
  }

  // Build Authored Edges
  const authoredEdges: GraphEdge[] = [];
  const edgeDeduplication = new Set<string>();

  for (const item of validArticles) {
    const sourceId = item.article.id;
    const extracted = extractWikilinks(item.revision.body_markdown);

    for (const link of extracted) {
      const key = normalizeWikiKey(link.target);
      const targetArticleId = articleMapByNormalizedKey.get(key);
      const targetWantedId = wantedIdByKey.get(key);
      const targetId = targetArticleId || targetWantedId;

      if (targetId && targetId !== sourceId) {
        const edgeKey = `auth-${sourceId}->${targetId}`;
        if (!edgeDeduplication.has(edgeKey)) {
          edgeDeduplication.add(edgeKey);
          authoredEdges.push({
            id: edgeKey,
            source: sourceId,
            target: targetId,
            type: "authored",
            label: link.label !== link.target ? link.label : undefined,
            weight: 1.0,
          });
        }
      }
    }
  }

  // Build Semantic Similarity Edges (Threshold >= 0.45)
  const semanticEdges: GraphEdge[] = [];
  for (let i = 0; i < rawArticleNodes.length; i++) {
    for (let j = i + 1; j < rawArticleNodes.length; j++) {
      const nodeA = rawArticleNodes[i];
      const nodeB = rawArticleNodes[j];
      if (!nodeA || !nodeB) continue;

      const artA = articleMapById.get(nodeA.id);
      const artB = articleMapById.get(nodeB.id);
      if (!artA || !artB) continue;

      const affinity = calculateSemanticAffinity(
        {
          title: nodeA.title,
          text: artA.revision.body_markdown,
          attractors: nodeA.activeAttractors,
        },
        {
          title: nodeB.title,
          text: artB.revision.body_markdown,
          attractors: nodeB.activeAttractors,
        }
      );

      if (affinity >= 0.45) {
        const edgeKey = `sem-${nodeA.id}-${nodeB.id}`;
        semanticEdges.push({
          id: edgeKey,
          source: nodeA.id,
          target: nodeB.id,
          type: "semantic",
          weight: affinity,
        });
      }
    }
  }

  const allEdges = [...authoredEdges, ...semanticEdges];
  const allNodes = computeDeterministicOverviewLayout(
    [...rawArticleNodes, ...rawWantedNodes],
    allEdges
  );

  return {
    nodes: allNodes,
    edges: allEdges,
    metrics: {
      totalArticles: rawArticleNodes.length,
      totalWanted: rawWantedNodes.length,
      totalAuthoredEdges: authoredEdges.length,
      totalSemanticEdges: semanticEdges.length,
    },
  };
};
