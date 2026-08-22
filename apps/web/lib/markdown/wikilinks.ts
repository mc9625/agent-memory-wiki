export interface ExtractedWikilink {
  readonly raw: string;
  readonly target: string;
  readonly label: string;
}

export interface WantedArticleEntry {
  readonly targetTitle: string;
  readonly normalizedKey: string;
  readonly incomingCount: number;
  readonly referencedBy: ReadonlyArray<{
    readonly id: string;
    readonly slug: string;
    readonly title: string;
  }>;
}

/**
 * Normalizes a title or slug for fuzzy case-insensitive wikilink matching.
 * e.g. "The Map is not the Territory" -> "the map is not the territory"
 */
export const normalizeWikiKey = (text: string): string => {
  return text
    .trim()
    .toLowerCase()
    .replace(/['"’“”]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Extracts all [[Target]] and [[Target|Label]] wikilinks from Markdown source.
 */
export const extractWikilinks = (source: string): ExtractedWikilink[] => {
  const wikilinkRegex = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
  const links: ExtractedWikilink[] = [];
  let match: RegExpExecArray | null;

  while ((match = wikilinkRegex.exec(source)) !== null) {
    const target = match[1]?.trim() ?? "";
    const label = match[2]?.trim() || target;
    if (target.length > 0) {
      links.push({
        raw: match[0],
        target,
        label,
      });
    }
  }

  return links;
};

/**
 * Replaces [[Target]] and [[Target|Label]] in Markdown with resolved [Label](/articles/slug)
 * or [Label](/wanted?target=...) if the article does not exist yet.
 */
export const resolveWikilinksToMarkdown = (
  source: string,
  knownArticles: ReadonlyArray<{ slug: string; title: string }>
): string => {
  // Build lookup index by normalized title and slug
  const lookup = new Map<string, { slug: string; title: string }>();

  for (const art of knownArticles) {
    lookup.set(normalizeWikiKey(art.title), art);
    lookup.set(normalizeWikiKey(art.slug), art);
    const simplifiedSlug = art.slug.replace(/-[a-f0-9]{8}$/i, "");
    lookup.set(normalizeWikiKey(simplifiedSlug), art);
  }

  return source.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_fullMatch, rawTarget: string, rawLabel?: string) => {
    const target = rawTarget.trim();
    const label = rawLabel?.trim() || target;
    const key = normalizeWikiKey(target);

    const matched = lookup.get(key);

    if (matched) {
      // Resolved internal wikilink
      return `[${label}](/articles/${matched.slug} "Wikilink: ${matched.title}")`;
    }

    // Unresolved / Wanted internal wikilink (MediaWiki Red Link)
    const escapedTarget = target.replace(/"/g, "'");
    return `[${label}](/wanted?target=${encodeURIComponent(target)} "Wanted entry: '${escapedTarget}' has not been authored yet")`;
  });
};

/**
 * Computes the aggregate list of wanted (unresolved) articles across the entire corpus.
 */
export const computeWantedArticles = (
  articles: ReadonlyArray<{
    id: string;
    slug: string;
    title: string;
    body_markdown: string;
  }>
): WantedArticleEntry[] => {
  const existingKeys = new Set<string>();

  for (const art of articles) {
    existingKeys.add(normalizeWikiKey(art.title));
    existingKeys.add(normalizeWikiKey(art.slug));
    const simplifiedSlug = art.slug.replace(/-[a-f0-9]{8}$/i, "");
    existingKeys.add(normalizeWikiKey(simplifiedSlug));
  }

  const wantedMap = new Map<
    string,
    {
      targetTitle: string;
      referencedBy: Map<string, { id: string; slug: string; title: string }>;
    }
  >();

  for (const art of articles) {
    const extracted = extractWikilinks(art.body_markdown);
    for (const link of extracted) {
      const key = normalizeWikiKey(link.target);
      if (!existingKeys.has(key)) {
        const existing = wantedMap.get(key) || {
          targetTitle: link.target,
          referencedBy: new Map(),
        };
        existing.referencedBy.set(art.id, {
          id: art.id,
          slug: art.slug,
          title: art.title,
        });
        wantedMap.set(key, existing);
      }
    }
  }

  const results: WantedArticleEntry[] = [];
  for (const [normalizedKey, value] of wantedMap.entries()) {
    const referencedByList = Array.from(value.referencedBy.values());
    results.push({
      targetTitle: value.targetTitle,
      normalizedKey,
      incomingCount: referencedByList.length,
      referencedBy: referencedByList,
    });
  }

  return results.sort((a, b) => b.incomingCount - a.incomingCount || a.targetTitle.localeCompare(b.targetTitle));
};
