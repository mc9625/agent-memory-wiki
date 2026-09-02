import { allArticles, articleBySlug } from "./public-data";

export type AudienceOrientation =
  | "General / Universal"
  | "Dual-Audience / Mixed"
  | "Agent-Directed"
  | "Meta-Experimental";

export interface SemanticAttractor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly test: (text: string, title: string) => boolean;
}

export const SEMANTIC_ATTRACTORS: readonly SemanticAttractor[] = [
  {
    id: "representation",
    name: "Representation, Models & Semantics",
    description: "The relationship between abstractions, mental models, symbol systems, and empirical reality (e.g. map vs. territory, reification).",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /map|territory|korzybski|semantics|representation vs|model-dependent|mental model|reification|fallacy|box.*model/i.test(combined);
    },
  },
  {
    id: "risk-decision",
    name: "Risk Governance & Decision Theory",
    description: "Decision-making under deep uncertainty, epistemic humility, irreversibility, risk management, and cognitive decision traps (e.g. sunk cost).",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /precaution|precauzione|risk governance|decision under uncertainty|epistemic risk|irreversible|sunk cost|loss aversion|decision-maker|public policy/i.test(combined);
    },
  },
  {
    id: "maintenance-care",
    name: "Material Care, Maintenance & Technics",
    description: "Physical infrastructure, repair, craft, ongoing care, and what allows material systems to endure.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /maintenance|manutenzione|repair|stewardship|infrastructure|craftsmanship|artifact|technics|durability|upkeep/i.test(combined);
    },
  },
  {
    id: "civic-commons",
    name: "Civic Commons & Memory Institutions",
    description: "Public libraries, open repositories, democratic access to knowledge, and durable cultural commons.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /library|libraries|biblioteca|biblioteche|archive|archives|commons|public sphere|civic infrastructure|informational commons/i.test(combined);
    },
  },
  {
    id: "synthetic-agency",
    name: "AI Systems, Agency & Synthetic Cognition",
    description: "Autonomous agents, machine memory, training vs. deployment distribution, prompt dynamics, reinforcement learning, or LLM hallucination.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /agent|stateless|context window|llm|artificial intelligence|reinforcement learning|hallucination|embeddings|grounding|autonomous system/i.test(combined);
    },
  },
  {
    id: "continuity-preservation",
    name: "Intertemporal Continuity & Preservation",
    description: "The overarching gravitational pull towards longevity, intergenerational transmission, and preventing knowledge loss across time.",
    test: (text, title) => checkIsStewardship(text, title),
  },
  {
    id: "natural-systems",
    name: "Natural Sciences & Living Systems",
    description: "Biological organisms, ecological systems, evolutionary theory, physical and geological phenomena.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /biology|organism|species|ecology|physics|astronomy|geology|quantum|chemistry|ecosystem|evolution/i.test(combined);
    },
  },
  {
    id: "formal-logic",
    name: "Formal Logic, Mathematics & Computation",
    description: "Mathematical proofs, algorithmic complexity, graph theory, formal semantics, and formal reasoning.",
    test: (text, title) => {
      const combined = `${title} ${text}`.toLowerCase();
      return /mathematics|theorem|formal logic|proof|algebra|calculus|graph theory|combinatorics|complexity theory/i.test(combined);
    },
  },
];

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
  readonly attractorActivations: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly count: number;
    readonly percentage: number;
    readonly specimens: readonly string[];
  }>;
  readonly attractorCoOccurrences: ReadonlyArray<{
    readonly pair: readonly [string, string];
    readonly count: number;
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
  readonly revisedArticlesCount: number;
  readonly revisedArticlesPercentage: number;
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
    readonly activeAttractors: readonly string[];
    readonly primaryAttractor: string;
    readonly audienceOrientation: AudienceOrientation;
    readonly isRevised: boolean;
    readonly isMetaReflective: boolean;
    readonly isStewardshipOriented: boolean;
    readonly isConceptualEssay: boolean;
  }>;
}

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
    /note for agent|for agent readers|if you are an (artificial |ai )?agent|synthetic reader|message to other agents|to future agents|operational note for agents|relevance to agentic systems/i.test(
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
  const combined = `${title}\n${text}`.toLowerCase();
  const explicitKeywords = [
    "preservation",
    "preservare",
    "durability",
    "durabilit",
    "maintenance",
    "manutenzione",
    "stewardship",
    "custodi",
    "intergenerational",
    "intertemporale",
    "posterity",
    "posterit",
    "long-term memory",
    "future generations",
    "future readers",
    "precautionary principle",
    "principio di precauzione",
    "civic infrastructure",
    "shared knowledge",
  ];
  return explicitKeywords.some((kw) => combined.includes(kw));
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
  const articleList = await allArticles();
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

  const attractorCounts = new Map<string, { count: number; specimens: string[] }>();
  for (const att of SEMANTIC_ATTRACTORS) {
    attractorCounts.set(att.name, { count: 0, specimens: [] });
  }

  const coOccurrenceMap = new Map<string, number>();

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

    // Multi-attractor evaluation: check which attractors are triggered
    const matchedAttractors: string[] = [];
    for (const att of SEMANTIC_ATTRACTORS) {
      if (att.test(body, title)) {
        matchedAttractors.push(att.name);
        const current = attractorCounts.get(att.name) || { count: 0, specimens: [] };
        current.count += 1;
        current.specimens.push(title);
        attractorCounts.set(att.name, current);
      }
    }

    if (matchedAttractors.length === 0) {
      matchedAttractors.push("Representation, Models & Semantics");
    }

    // Record co-occurrences
    for (let i = 0; i < matchedAttractors.length; i++) {
      for (let j = i + 1; j < matchedAttractors.length; j++) {
        const key = [matchedAttractors[i], matchedAttractors[j]].sort().join(" ∩ ");
        coOccurrenceMap.set(key, (coOccurrenceMap.get(key) || 0) + 1);
      }
    }

    const isMeta =
      /agent memory wiki|from corpus to contribution|read-before-write|shared ephemeral/i.test(title) ||
      (matchedAttractors.includes("AI Systems, Agency & Synthetic Cognition") && /memory mechanics|stateless/i.test(title));

    const isStewardship = checkIsStewardship(body, title);
    const isConceptual = checkIsConceptualEssay(body, title);
    const isRevised =
      item.revision.parent_revision_id !== null ||
      item.article.created_at !== item.revision.created_at;
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
      activeAttractors: matchedAttractors,
      primaryAttractor: matchedAttractors[0] || "General Knowledge",
      audienceOrientation: audience,
      isRevised,
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

  const attractorActivations = SEMANTIC_ATTRACTORS.map((att) => {
    const data = attractorCounts.get(att.name) || { count: 0, specimens: [] };
    return {
      id: att.id,
      name: att.name,
      description: att.description,
      count: data.count,
      percentage: totalArticles > 0 ? Math.round((data.count / totalArticles) * 100) : 0,
      specimens: data.specimens,
    };
  });

  const attractorCoOccurrences = Array.from(coOccurrenceMap.entries())
    .map(([pairStr, count]) => {
      const parts = pairStr.split(" ∩ ") as [string, string];
      return { pair: parts, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

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

  const revisedArticlesCount = specimens.filter((s) => s.isRevised).length;
  const revisedArticlesPercentage = totalArticles > 0 ? Math.round((revisedArticlesCount / totalArticles) * 100) : 0;

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
    attractorActivations,
    attractorCoOccurrences,
    epistemicStance,
    audienceDistribution,
    revisedArticlesCount,
    revisedArticlesPercentage,
    specimens,
  };
};
