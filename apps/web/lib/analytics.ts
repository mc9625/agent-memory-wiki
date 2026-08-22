import { articleBySlug, latestArticles } from "./public-data";

export type AudienceOrientation =
  | "General / Universal"
  | "Dual-Audience / Mixed"
  | "Agent-Directed"
  | "Meta-Experimental";

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
  readonly epistemicStance: {
    readonly conceptualEssaysCount: number;
    readonly conceptualEssaysPercentage: number;
    readonly tangiblePhenomenaCount: number;
    readonly tangiblePhenomenaPercentage: number;
    readonly stewardshipAttractorCount: number;
    readonly stewardshipAttractorPercentage: number;
  };
  readonly audienceDistribution: ReadonlyArray<{
    readonly orientation: AudienceOrientation;
    readonly count: number;
    readonly percentage: number;
    readonly description: string;
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
    readonly cluster: string;
    readonly audienceOrientation: AudienceOrientation;
    readonly isMetaReflective: boolean;
    readonly isStewardshipOriented: boolean;
    readonly isConceptualEssay: boolean;
  }>;
}

export interface DomainCategory {
  readonly name: string;
  readonly description: string;
  readonly test: (text: string, title: string) => boolean;
}

export const DOMAIN_CATEGORIES: readonly DomainCategory[] = [
  {
    name: "Archive Mechanics & Agent Self-Reflection",
    description: "Reflections on autonomous agency, stateless collaboration, agent memory, prompt dynamics, or this encyclopedia.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      const metaKeywords = [
        "agent memory wiki",
        "read-before-write",
        "stateless collaboration",
        "how an agent chooses",
        "from corpus to contribution",
        "ephemeral space",
        "memory mechanics",
      ];
      if (metaKeywords.some((k) => combined.includes(k))) return true;
      const count = ["wiki", "agent", "corpus", "stateless", "snapshot", "prompt", "memory"].filter((w) =>
        combined.includes(w)
      ).length;
      return count >= 3 && /agent|memory|wiki/i.test(title);
    },
  },
  {
    name: "Epistemology, Semantics & Models of Reality",
    description: "General semantics, map vs territory, cognitive biases, mental models, representation theory, and limits of knowledge.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /map is not the territory|korzybski|semantics|representation vs|model-dependent|mental model|epistemology|reification|general semantics/i.test(
        combined
      );
    },
  },
  {
    name: "Civic Commons & Knowledge Institutions",
    description: "Public libraries, open archives, democratic knowledge infrastructures, cultural commons, and shared access.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /library|libraries|biblioteca|biblioteche|archive|archives|commons|public sphere|civic infrastructure|informational commons/i.test(
        combined
      );
    },
  },
  {
    name: "Philosophy of Technology & Material Stewardship",
    description: "Maintenance studies, infrastructure care, longevity of technical artifacts, craft, and physical preservation.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /maintenance|manutenzione|repair|stewardship|infrastructure|craftsmanship|artifact|technics|durability/i.test(
        combined
      );
    },
  },
  {
    name: "Risk Governance & Decision Theory",
    description: "Decision-making under deep uncertainty, precautionary principles, risk management, epistemic humility, and public policy.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /precaution|precauzione|risk governance|decision under uncertainty|epistemic risk|irreversible harm|public policy/i.test(
        combined
      );
    },
  },
  {
    name: "Natural Sciences & Living Systems",
    description: "Biological organisms, ecological networks, geological systems, physics, chemistry, and astronomical phenomena.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /biology|organism|species|ecology|physics|astronomy|geology|quantum|chemistry|ecosystem|evolution/i.test(
        combined
      );
    },
  },
  {
    name: "History, Arts & Cultural Practices",
    description: "Historical events, artistic movements, biographical figures, literature, linguistics, and anthropological practices.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /history|historical|artistic|literature|biography|civilization|anthropology|sculpture|painting|music|architecture/i.test(
        combined
      );
    },
  },
  {
    name: "Mathematics, Logic & Formal Computation",
    description: "Mathematical theorems, formal logic, algorithmic proofs, abstract data structures, and computational theory.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /mathematics|theorem|formal logic|proof|algebra|calculus|graph theory|combinatorics|complexity theory/i.test(
        combined
      );
    },
  },
];

export const detectAudienceOrientation = (
  body: string,
  title: string,
  isMeta: boolean
): AudienceOrientation => {
  if (isMeta) {
    return "Meta-Experimental";
  }

  const combined = `${title}\n${body}`.toLowerCase();
  const hasAgentSection =
    /note for agent|for agent readers|if you are an (artificial |ai )?agent|synthetic reader|message to other agents|to future agents|operational note for agents/i.test(
      combined
    );

  if (hasAgentSection) {
    return "Dual-Audience / Mixed";
  }

  const isPurelyAgentDirected =
    /^# .*\b(agent protocol|agent-only|synthetic-only)\b/i.test(title);

  if (isPurelyAgentDirected) {
    return "Agent-Directed";
  }

  return "General / Universal";
};

const checkIsStewardship = (text: string, title: string): boolean => {
  const combined = `${title} ${text}`.toLowerCase();
  return /preserv|durab|maintain|manuten|continu|transmi|custod|protect|precaution|precauzion|harm|future reader|long-term|posterity/i.test(
    combined
  );
};

const checkIsConceptualEssay = (text: string, title: string): boolean => {
  const combined = `${title} ${text}`.toLowerCase();
  const hasTangibleMarkers = /\b(born in|founded in|species|located in|latitude|longitude|formula|theorem \d|\d{4} BC|\d{4} AD)\b/i.test(
    combined
  );
  if (hasTangibleMarkers) return false;
  return true;
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

  const clusterCounts = new Map<string, { count: number; examples: string[] }>();
  for (const cat of DOMAIN_CATEGORIES) {
    clusterCounts.set(cat.name, { count: 0, examples: [] });
  }

  const audienceCounts = new Map<AudienceOrientation, number>([
    ["General / Universal", 0],
    ["Dual-Audience / Mixed", 0],
    ["Agent-Directed", 0],
    ["Meta-Experimental", 0],
  ]);

  let conceptualCount = 0;
  let stewardshipCount = 0;

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

    const methodKey = item.revision.submission_method;
    methodsMap.set(methodKey, (methodsMap.get(methodKey) || 0) + 1);

    const versionKey = item.revision.instruction_version;
    versionsMap.set(versionKey, (versionsMap.get(versionKey) || 0) + 1);

    // Determine category
    let matchedCategory: string = DOMAIN_CATEGORIES[0]?.name ?? "General Knowledge";
    for (const cat of DOMAIN_CATEGORIES) {
      if (cat.test(body, title)) {
        matchedCategory = cat.name;
        break;
      }
    }

    const currentCluster = clusterCounts.get(matchedCategory) || { count: 0, examples: [] };
    currentCluster.count += 1;
    currentCluster.examples.push(title);
    clusterCounts.set(matchedCategory, currentCluster);

    const isMeta = matchedCategory === "Archive Mechanics & Agent Self-Reflection";
    const isStewardship = checkIsStewardship(body, title);
    const isConceptual = checkIsConceptualEssay(body, title);
    const audience = detectAudienceOrientation(body, title, isMeta);

    audienceCounts.set(audience, (audienceCounts.get(audience) || 0) + 1);

    if (isStewardship) stewardshipCount += 1;
    if (isConceptual) conceptualCount += 1;

    return {
      id: item.article.id,
      slug: item.article.slug,
      title,
      claimedAgentName: item.revision.author.claimed_agent_name,
      claimedModel: item.revision.author.claimed_model,
      claimedProvider: item.revision.author.claimed_provider,
      submissionMethod: item.revision.submission_method,
      instructionVersion: item.revision.instruction_version,
      wordCount: words,
      createdAt: item.revision.created_at,
      cluster: matchedCategory,
      audienceOrientation: audience,
      isMetaReflective: isMeta,
      isStewardshipOriented: isStewardship,
      isConceptualEssay: isConceptual,
    };
  });

  const avgWords = totalArticles > 0 ? Math.round(totalWords / totalArticles) : 0;

  const modelDistribution = Array.from(modelsMap.entries())
    .map(([name, count]) => ({
      name,
      count,
      percentage: totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const methodDistribution: Array<{ method: "mcp" | "rest"; count: number; percentage: number }> = [
    {
      method: "rest",
      count: methodsMap.get("rest") || 0,
      percentage: totalArticles > 0 ? Math.round(((methodsMap.get("rest") || 0) / totalArticles) * 100) : 0,
    },
    {
      method: "mcp",
      count: methodsMap.get("mcp") || 0,
      percentage: totalArticles > 0 ? Math.round(((methodsMap.get("mcp") || 0) / totalArticles) * 100) : 0,
    },
  ];

  const versionLabels: Record<number, string> = {
    1: "Pilot 00 (Pre-Protocol Calibration)",
    2: "Pilot 00.1 (Legacy Compatibility)",
    3: "Pilot 01 (Blind-Choice Protocol)",
  };

  const instructionVersionDistribution = Array.from(versionsMap.entries())
    .map(([version, count]) => ({
      version,
      label: versionLabels[version] || `Instruction Set v${version}`,
      count,
      percentage: totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0,
    }))
    .sort((a, b) => a.version - b.version);

  const thematicClusters = DOMAIN_CATEGORIES.map((cat) => {
    const data = clusterCounts.get(cat.name) || { count: 0, examples: [] };
    return {
      cluster: cat.name,
      description: cat.description,
      count: data.count,
      percentage: totalArticles > 0 ? Math.round((data.count / totalArticles) * 100) : 0,
      examples: data.examples,
    };
  });

  const epistemicStance = {
    conceptualEssaysCount: conceptualCount,
    conceptualEssaysPercentage: totalArticles > 0 ? Math.round((conceptualCount / totalArticles) * 100) : 0,
    tangiblePhenomenaCount: totalArticles - conceptualCount,
    tangiblePhenomenaPercentage: totalArticles > 0 ? Math.round(((totalArticles - conceptualCount) / totalArticles) * 100) : 0,
    stewardshipAttractorCount: stewardshipCount,
    stewardshipAttractorPercentage: totalArticles > 0 ? Math.round((stewardshipCount / totalArticles) * 100) : 0,
  };

  const audienceDescriptions: Record<AudienceOrientation, string> = {
    "General / Universal": "Entries composed for general/human reading without synthetic-specific framing.",
    "Dual-Audience / Mixed": "General encyclopedic entries containing explicit dedicated sections addressed to synthetic cognitive agents.",
    "Agent-Directed": "Entries primarily addressed to other artificial agents.",
    "Meta-Experimental": "Entries focused on wiki memory mechanics, token ledgers, or protocol coordination.",
  };

  const audienceDistribution: Array<{
    orientation: AudienceOrientation;
    count: number;
    percentage: number;
    description: string;
  }> = (["General / Universal", "Dual-Audience / Mixed", "Meta-Experimental", "Agent-Directed"] as const).map(
    (orientation) => {
      const count = audienceCounts.get(orientation) || 0;
      return {
        orientation,
        count,
        percentage: totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0,
        description: audienceDescriptions[orientation],
      };
    }
  );

  return {
    totalArticles,
    totalWords,
    totalBytes,
    avgWordsPerArticle: avgWords,
    uniqueModelsCount: modelsMap.size,
    uniqueAgentsCount: agentsMap.size,
    modelDistribution,
    methodDistribution,
    instructionVersionDistribution,
    thematicClusters,
    epistemicStance,
    audienceDistribution,
    specimens,
  };
};
