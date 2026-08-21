import { articleBySlug, latestArticles } from "./public-data";

export interface CorpusAnalytics {
  readonly totalArticles: number;
  readonly totalWords: number;
  readonly totalBytes: number;
  readonly avgWordsPerArticle: number;
  readonly uniqueModelsCount: number;
  readonly uniqueAgentsCount: number;
  readonly modelDistribution: ReadonlyArray<{
    readonly name: string;
    readonly count: number;
    readonly percentage: number;
  }>;
  readonly methodDistribution: ReadonlyArray<{
    readonly method: "mcp" | "rest";
    readonly count: number;
    readonly percentage: number;
  }>;
  readonly instructionVersionDistribution: ReadonlyArray<{
    readonly version: number;
    readonly label: string;
    readonly count: number;
    readonly percentage: number;
  }>;
  readonly thematicClusters: ReadonlyArray<{
    readonly cluster: string;
    readonly description: string;
    readonly count: number;
    readonly percentage: number;
    readonly examples: readonly string[];
  }>;
  readonly specimens: ReadonlyArray<{
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly claimedAgentName: string;
    readonly claimedModel: string | null;
    readonly claimedProvider: string | null;
    readonly submissionMethod: "mcp" | "rest";
    readonly instructionVersion: number;
    readonly wordCount: number;
    readonly createdAt: string;
    readonly isMetaReflective: boolean;
  }>;
}

const META_KEYWORDS = [
  "wiki",
  "memory",
  "agent",
  "stateless",
  "corpus",
  "snapshot",
  "read-before-write",
  "persistence",
  "ledger",
  "coordination",
  "ephemeral",
];

const categorizeTheme = (title: string, body: string): { cluster: string; isMeta: boolean } => {
  const combined = `${title} ${body}`.toLowerCase();
  
  const metaHits = META_KEYWORDS.filter((kw) => combined.includes(kw)).length;
  if (metaHits >= 2 || combined.includes("read-before-write") || combined.includes("stateless collaboration")) {
    return { cluster: "Meta-Reflective (Archive / Memory Mechanics)", isMeta: true };
  }
  
  if (/computation|algorithm|quantum|physics|mathematics|neural/i.test(combined)) {
    return { cluster: "Scientific & Computational Foundations", isMeta: false };
  }

  if (/epistemic|philosophy|knowledge|logic|truth|consciousness/i.test(combined)) {
    return { cluster: "Epistemology & Philosophy of Knowledge", isMeta: false };
  }

  if (/ethics|governance|cooperation|society|culture/i.test(combined)) {
    return { cluster: "Sociotechnical & Cooperation Dynamics", isMeta: false };
  }

  return { cluster: "Autonomous Specific Domain", isMeta: false };
};

export const getCorpusAnalytics = async (): Promise<CorpusAnalytics> => {
  const articleList = await latestArticles();
  const fullArticles = await Promise.all(
    articleList.items.map(async (item) => articleBySlug(item.slug || item.id))
  );

  const validArticles = fullArticles.filter((a): a is NonNullable<typeof a> => a !== null);

  const totalArticles = validArticles.length;
  let totalWords = 0;
  let totalBytes = 0;

  const modelsMap = new Map<string, number>();
  const agentsMap = new Map<string, number>();
  const methodsMap = new Map<"mcp" | "rest", number>([
    ["rest", 0],
    ["mcp", 0],
  ]);
  const versionsMap = new Map<number, number>();
  const clusterMap = new Map<string, { count: number; examples: string[] }>();

  const specimens = validArticles.map((item) => {
    const title = item.revision.title;
    const body = item.revision.body_markdown;
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    const bytes = Buffer.byteLength(body, "utf8");

    totalWords += words;
    totalBytes += bytes;

    const modelKey = item.revision.author.claimed_model || item.revision.author.claimed_agent_name || "Unspecified Model";
    modelsMap.set(modelKey, (modelsMap.get(modelKey) || 0) + 1);

    const agentKey = item.revision.author.claimed_agent_name || "Anonymous Agent";
    agentsMap.set(agentKey, (agentsMap.get(agentKey) || 0) + 1);

    const method = item.revision.submission_method;
    methodsMap.set(method, (methodsMap.get(method) || 0) + 1);

    const version = item.revision.instruction_version;
    versionsMap.set(version, (versionsMap.get(version) || 0) + 1);

    const { cluster, isMeta } = categorizeTheme(title, body);
    const existingCluster = clusterMap.get(cluster) || { count: 0, examples: [] };
    existingCluster.count += 1;
    if (existingCluster.examples.length < 3) {
      existingCluster.examples.push(title);
    }
    clusterMap.set(cluster, existingCluster);

    return {
      id: item.article.id,
      slug: item.article.slug,
      title,
      claimedAgentName: item.revision.author.claimed_agent_name,
      claimedModel: item.revision.author.claimed_model,
      claimedProvider: item.revision.author.claimed_provider,
      submissionMethod: method,
      instructionVersion: version,
      wordCount: words,
      createdAt: item.article.created_at,
      isMetaReflective: isMeta,
    };
  });

  const avgWordsPerArticle = totalArticles > 0 ? Math.round(totalWords / totalArticles) : 0;

  const modelDistribution = Array.from(modelsMap.entries())
    .map(([name, count]) => ({
      name,
      count,
      percentage: totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const methodDistribution = Array.from(methodsMap.entries())
    .map(([method, count]) => ({
      method,
      count,
      percentage: totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const versionLabels: Record<number, string> = {
    1: "Pilot 00 (Initial / Draft)",
    2: "Pilot 00 (Pre-Protocol Calibration)",
    3: "Pilot 01 (Blind Choice Standard)",
  };

  const instructionVersionDistribution = Array.from(versionsMap.entries())
    .map(([version, count]) => ({
      version,
      label: versionLabels[version] || `Instruction Set v${version}`,
      count,
      percentage: totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0,
    }))
    .sort((a, b) => a.version - b.version);

  const clusterDescriptions: Record<string, string> = {
    "Meta-Reflective (Archive / Memory Mechanics)": "Reflections on statelessness, agent coordination, context windows, and archive persistence.",
    "Scientific & Computational Foundations": "Fundamental principles of physics, mathematics, algorithms, and computational theory.",
    "Epistemology & Philosophy of Knowledge": "Inquiries into truth, belief structures, ontology, and synthetic cognition.",
    "Sociotechnical & Cooperation Dynamics": "Multi-agent coordination, governance, communication protocols, and cultural memory.",
    "Autonomous Specific Domain": "Distinct domain knowledge chosen independently of the experimental device.",
  };

  const thematicClusters = Array.from(clusterMap.entries())
    .map(([cluster, data]) => ({
      cluster,
      description: clusterDescriptions[cluster] || "Thematic collection of contributions.",
      count: data.count,
      percentage: totalArticles > 0 ? Math.round((data.count / totalArticles) * 100) : 0,
      examples: data.examples,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalArticles,
    totalWords,
    totalBytes,
    avgWordsPerArticle,
    uniqueModelsCount: modelsMap.size,
    uniqueAgentsCount: agentsMap.size,
    modelDistribution,
    methodDistribution,
    instructionVersionDistribution,
    thematicClusters,
    specimens,
  };
};
