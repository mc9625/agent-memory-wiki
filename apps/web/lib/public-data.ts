import type { ArticleListView, PublicArticleView } from "./http/handlers";
import { getHttpServices } from "./http/runtime";

export const latestArticles = async (): Promise<ArticleListView> => {
  try {
    return await (await getHttpServices()).listArticles({ limit: 20 });
  } catch {
    return { items: [], next_cursor: null };
  }
};

/**
 * Every visible article, not just the newest page of them.
 *
 * `latestArticles` is a front-page feed: twenty rows, newest first, which is
 * what a "latest" list should be. Pages that describe the corpus rather than
 * its head — the A–Z index, the link graph — were reading that same feed and
 * silently claiming the archive was twenty articles long, so an older specimen
 * was missing from the index that promises to list them all.
 *
 * The page size is the API's own maximum. The page count is bounded because an
 * unbounded loop against a paginating endpoint is one bad cursor away from
 * spinning forever, and it is generous against the size the archive is.
 */
const ARTICLE_PAGE_SIZE = 100;
const MAX_ARTICLE_PAGES = 50;

type ArticlePager = (input: {
  readonly cursor?: string;
  readonly limit: number;
}) => Promise<ArticleListView>;

const servicePager: ArticlePager = async (input) =>
  (await getHttpServices()).listArticles(input);

/** The page walk itself, with the source passed in so it can be exercised. */
export const allArticles = async (page: ArticlePager = servicePager): Promise<ArticleListView> => {
  const items: ArticleListView["items"][number][] = [];
  try {
    let cursor: string | undefined;
    for (let fetched = 0; fetched < MAX_ARTICLE_PAGES; fetched += 1) {
      const view = await page(
        cursor ? { cursor, limit: ARTICLE_PAGE_SIZE } : { limit: ARTICLE_PAGE_SIZE },
      );
      items.push(...view.items);
      if (!view.next_cursor) break;
      cursor = view.next_cursor;
    }
  } catch {
    // A partial read beats an error screen: the pages that call this degrade to
    // however much of the corpus was already in hand.
  }
  return { items, next_cursor: null };
};

export const articleBySlug = async (idOrSlug: string): Promise<PublicArticleView | null> => {
  try {
    return await (await getHttpServices()).getArticle(idOrSlug);
  } catch {
    return null;
  }
};

export const articleHistory = async (idOrSlug: string): Promise<readonly PublicArticleView[]> => {
  try {
    return (await (await getHttpServices()).listRevisions(idOrSlug, { limit: 100 }))?.items ?? [];
  } catch {
    return [];
  }
};

export const searchPublicArticles = async (query: string): Promise<ArticleListView> => {
  try {
    return await (await getHttpServices()).searchArticles(query, { limit: 50 });
  } catch {
    return { items: [], next_cursor: null };
  }
};
