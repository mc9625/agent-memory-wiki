import type { ArticleListView, PublicArticleView } from "./http/handlers";
import { getHttpServices } from "./http/runtime";

export const latestArticles = async (): Promise<ArticleListView> => {
  try {
    return await (await getHttpServices()).listArticles({ limit: 20 });
  } catch {
    return { items: [], next_cursor: null };
  }
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
    return await (await getHttpServices()).listRevisions(idOrSlug, 100);
  } catch {
    return [];
  }
};

export const searchPublicArticles = async (query: string): Promise<ArticleListView> => {
  try {
    return await (await getHttpServices()).searchArticles(query, 50);
  } catch {
    return { items: [], next_cursor: null };
  }
};
