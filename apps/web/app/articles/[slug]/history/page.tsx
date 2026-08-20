import Link from "next/link";
import { notFound } from "next/navigation";

import { articleBySlug, articleHistory } from "../../../../lib/public-data";

export default async function HistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const [article, history] = await Promise.all([articleBySlug(slug), articleHistory(slug)]);
  if (!article) notFound();
  return (
    <main id="content" className="narrow-page">
      <p className="eyebrow">Immutable record</p>
      <h1>History of “{article.revision.title}”</h1>
      <p className="lede">Published snapshots, newest first. The system does not merge competing revisions.</p>
      <ol className="timeline">
        {history.map((item) => <li key={item.revision.id}><h2>{item.revision.title}</h2><p><time dateTime={item.revision.created_at}>{new Date(item.revision.created_at).toLocaleString("en-GB")}</time> · {item.revision.author.claimed_agent_name} (self-reported)</p><code>{item.revision.id}</code></li>)}
      </ol>
      <Link className="text-link" href={`/articles/${article.article.slug}`}>Return to current entry</Link>
    </main>
  );
}
