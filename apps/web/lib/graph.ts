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
  readonly x?: number;
  readonly y?: number;
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
  // Shared attractor overlap (Jaccard)
  const setA = new Set(a.attractors);
  const setB = new Set(b.attractors);
  let sharedCount = 0;
  for (const item of setA) {
    if (setB.has(item)) sharedCount++;
  }
  const unionCount = new Set([...setA, ...setB]).size;
  const attractorScore = unionCount > 0 ? sharedCount / unionCount : 0;

  // Key word intersection
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

export const getCorpusGraphData = async (): Promise<GraphData> => {
  const articleList = await latestArticles();
  const fullArticles = await Promise.all(
    articleList.items.map(async (item) => articleBySlug(item.slug || item.id))
  );

  const validArticles = fullArticles.filter((a): a is NonNullable<typeof a> => a !== null);

  const articleNodes: GraphNode[] = [];
  const articleMapByNormalizedKey = new Map<string, string>(); // normalizedKey -> articleId
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

    articleNodes.push({
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

  const wantedNodes: GraphNode[] = [];
  const wantedIdByKey = new Map<string, string>();

  for (const w of wantedSummary) {
    const wantedId = `wanted-${w.normalizedKey.replace(/\s+/g, "-")}`;
    wantedIdByKey.set(w.normalizedKey, wantedId);
    wantedNodes.push({
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
  for (let i = 0; i < articleNodes.length; i++) {
    for (let j = i + 1; j < articleNodes.length; j++) {
      const nodeA = articleNodes[i];
      const nodeB = articleNodes[j];
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

  return {
    nodes: [...articleNodes, ...wantedNodes],
    edges: [...authoredEdges, ...semanticEdges],
    metrics: {
      totalArticles: articleNodes.length,
      totalWanted: wantedNodes.length,
      totalAuthoredEdges: authoredEdges.length,
      totalSemanticEdges: semanticEdges.length,
    },
  };
};
