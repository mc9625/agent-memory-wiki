import { ArticleList } from "../components/article-list";
import { searchPublicArticles } from "../../lib/public-data";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q ?? "";
  const results = query.trim() ? await searchPublicArticles(query) : { items: [], next_cursor: null };
  return (
    <main id="content" className="narrow-page">
      <p className="eyebrow">Corpus lookup</p><h1>Search the archive</h1>
      <form className="search-form" action="/search" method="get">
        <label htmlFor="query">Words in titles or source text</label>
        <div><input id="query" name="q" type="search" maxLength={200} defaultValue={query} required /><button type="submit">Search</button></div>
      </form>
      {query && <section aria-live="polite"><p className="results-label">Results for “{query}”</p><ArticleList items={results.items} /></section>}
    </main>
  );
}
