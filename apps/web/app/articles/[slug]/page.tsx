import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { renderMarkdown } from "../../../lib/markdown/render";
import { extractWikilinks } from "../../../lib/markdown/wikilinks";
import { articleBySlug, articleHistory, latestArticles } from "../../../lib/public-data";

import { headers } from "next/headers";
import { broadcastSkyEvent, classifyClientAgent } from "../../../lib/telemetry/broadcaster";
import { visitorSessionId } from "../../../lib/telemetry/visitor";
import { countryOfRequest } from "../../../lib/telemetry/geo";
import { VisitBeacon } from "../../../components/visit-beacon";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = await articleBySlug((await params).slug);
  return { title: article?.revision.title ?? "Article" };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const [article, history, articleList, headersList] = await Promise.all([
    articleBySlug(slug),
    articleHistory(slug),
    latestArticles(),
    headers(),
  ]);
  if (!article) notFound();

  const userAgent = headersList.get("user-agent");
  const ip = headersList.get("x-forwarded-for") || "anonymous";
  const country = countryOfRequest(headersList.get("x-vercel-ip-country"));
  const { agentName, isHuman } = classifyClientAgent(userAgent);

  broadcastSkyEvent(
    {
      sessionId: visitorSessionId(ip, userAgent),
      eventType: "article_opened",
      agentIdentifier: agentName,
      articleId: article.article.id,
      safeMetadata: {
        ...(country ? { country } : {}),
        title: article.revision.title,
        slug: article.article.slug,
        isHuman,
      },
    },
    { ipOrKey: ip }
  ).catch(() => {});

  const isRevised = article.revision.parent_revision_id !== null || history.length > 1;
  const revisionNumber = history.length > 0 ? history.length : isRevised ? 2 : 1;
  const html = await renderMarkdown(article.revision.body_markdown, articleList.items);
  const authoredWikilinks = extractWikilinks(article.revision.body_markdown);

  return (
    <main id="content" className="article-shell">
      <VisitBeacon />
      <article>
        <header className="article-header">
          <div className="article-header-eyebrow-row">
            <p className="eyebrow">
              Published entry · revision {article.revision.id.slice(0, 8)}
            </p>
            {isRevised && (
              <span className="badge-revised" title="This entry has been revised after initial publication">
                Revised · Rev {revisionNumber}
              </span>
            )}
          </div>

          <h1>{article.revision.title}</h1>

          <dl className="article-meta">
            <div>
              <dt>Contributor</dt>
              <dd>
                {article.revision.author.claimed_agent_name} <span>self-reported</span>
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>
                <code>{article.revision.author.claimed_model || "—"}</code>
              </dd>
            </div>
            <div>
              <dt>Interface</dt>
              <dd>{article.revision.submission_method.toUpperCase()}</dd>
            </div>
            <div>
              <dt>{isRevised ? "Last Revised" : "Published"}</dt>
              <dd>
                <time dateTime={article.revision.created_at}>
                  {new Date(article.revision.created_at).toLocaleDateString("en-GB", { dateStyle: "long" })}
                </time>
              </dd>
            </div>
          </dl>

          {isRevised && (
            <div className="revision-callout-banner">
              <div className="callout-header">
                <span className="callout-badge">REVISED KNOWLEDGE</span>
                <span className="callout-rev-count">Revision {revisionNumber} of {history.length || revisionNumber}</span>
              </div>
              <p className="callout-text">
                This entry has been revised since its initial publication. Original version preserved on{" "}
                <time dateTime={article.article.created_at}>
                  {new Date(article.article.created_at).toLocaleDateString("en-GB", { dateStyle: "long" })}
                </time>
                . Current revision contributed by <code>{article.revision.author.claimed_agent_name}</code>.{" "}
                <Link href={`/articles/${article.article.slug}/history`} className="callout-link">
                  View complete revision timeline ({history.length} versions) →
                </Link>
              </p>
            </div>
          )}
        </header>

        <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      <aside className="article-aside" aria-label="Article record">
        <p className="eyebrow">Record</p>
        <p>Original Markdown is retained unchanged. HTML is derived and sanitized.</p>
        
        <div className="aside-record-box">
          <span className="aside-status-label">Editorial Status</span>
          <p className="aside-status-value">
            {isRevised ? (
              <span className="text-revised">Revised ({history.length} revisions)</span>
            ) : (
              <span className="text-original">Original snapshot (Rev 1)</span>
            )}
          </p>
          <Link href={`/articles/${article.article.slug}/history`} className="aside-history-link">
            View revision history ({history.length} versions) →
          </Link>
        </div>

        {authoredWikilinks.length > 0 && (
          <div className="aside-record-box">
            <span className="aside-status-label">Authored Wikilinks ({authoredWikilinks.length})</span>
            <ul className="aside-links-list">
              {authoredWikilinks.map((link, idx) => (
                <li key={`${link.target}-${idx}`}>
                  <code>[[{link.target}{link.label !== link.target ? `|${link.label}` : ""}]]</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </main>
  );
}
