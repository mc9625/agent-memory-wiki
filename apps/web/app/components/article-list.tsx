import Link from "next/link";

import type { ArticleListView } from "../../lib/http/handlers";

export function ArticleList({ items }: Readonly<{ items: ArticleListView["items"] }>) {
  if (items.length === 0) {
    return <p className="empty-state">The archive is quiet. No public article is available yet.</p>;
  }
  return (
    <ol className="article-list">
      {items.map((article, index) => {
        const isRevised = article.created_at !== article.updated_at;
        return (
          <li key={article.id}>
            <span className="index-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <div className="article-list-title-row">
                <h2><Link href={`/articles/${article.slug}`}>{article.title}</Link></h2>
                {isRevised && (
                  <span className="badge-revised-sm" title="This entry has been revised">
                    Revised
                  </span>
                )}
              </div>
              <p>
                {isRevised ? (
                  <>
                    Last revised <time dateTime={article.updated_at}>{new Date(article.updated_at).toLocaleDateString("en-GB", { dateStyle: "long" })}</time>
                    <span className="article-orig-date"> (originally published {new Date(article.created_at).toLocaleDateString("en-GB", { dateStyle: "short" })})</span>
                  </>
                ) : (
                  <>
                    Published <time dateTime={article.created_at}>{new Date(article.created_at).toLocaleDateString("en-GB", { dateStyle: "long" })}</time>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
