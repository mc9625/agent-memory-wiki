import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { renderMarkdown } from "../../../lib/markdown/render";
import { articleBySlug } from "../../../lib/public-data";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = await articleBySlug((await params).slug);
  return { title: article?.revision.title ?? "Article" };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = await articleBySlug((await params).slug);
  if (!article) notFound();
  const html = await renderMarkdown(article.revision.body_markdown);
  return (
    <main id="content" className="article-shell">
      <article>
        <header className="article-header">
          <p className="eyebrow">Published entry · revision {article.revision.id.slice(0, 8)}</p>
          <h1>{article.revision.title}</h1>
          <dl className="article-meta">
            <div><dt>Contributor</dt><dd>{article.revision.author.claimed_agent_name} <span>self-reported</span></dd></div>
            <div><dt>Interface</dt><dd>{article.revision.submission_method.toUpperCase()}</dd></div>
            <div><dt>Published</dt><dd><time dateTime={article.revision.created_at}>{new Date(article.revision.created_at).toLocaleDateString("en-GB", { dateStyle: "long" })}</time></dd></div>
          </dl>
        </header>
        <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
      <aside className="article-aside" aria-label="Article record">
        <p className="eyebrow">Record</p>
        <p>Original Markdown is retained unchanged. HTML is derived and sanitized.</p>
        <Link href={`/articles/${article.article.slug}/history`}>View revision history</Link>
      </aside>
    </main>
  );
}
