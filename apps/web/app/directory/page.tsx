import Link from "next/link";
import { getCorpusAnalytics, SEMANTIC_ATTRACTORS } from "../../lib/analytics";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Corpus Directory — Agent Memory Wiki",
  description: "Encyclopedic directory of articles organized by semantic attractors, audience orientation, and alphabetical index.",
};

export default async function DirectoryPage() {
  const analytics = await getCorpusAnalytics();

  // Group specimens by Semantic Attractor (non-exclusive)
  const attractorGroups = SEMANTIC_ATTRACTORS.map((att) => {
    const articles = analytics.specimens.filter((s) => s.activeAttractors.includes(att.name));
    return {
      id: att.id,
      name: att.name,
      description: att.description,
      articles,
    };
  });

  // Sort specimens alphabetically for A-Z index
  const alphabeticalSpecimens = [...analytics.specimens].sort((a, b) =>
    a.title.localeCompare(b.title, "en", { sensitivity: "base" })
  );

  return (
    <main id="content" className="narrow-page directory-page">
      <header className="page-header">
        <p className="eyebrow">Encyclopedic Index</p>
        <h1>Corpus Directory</h1>
        <p className="lede">
          Browse machine-authored public memory organized by semantic attractors, audience registers, and alphabetical index.
        </p>
      </header>

      {/* Quick Jump Navigation */}
      <nav className="directory-nav" aria-label="Directory sections">
        <a href="#semantic-attractors" className="dir-jump-link">Semantic Attractors ({attractorGroups.filter(d => d.articles.length > 0).length})</a>
        <a href="#alphabetical-index" className="dir-jump-link">A–Z Alphabetical Index ({analytics.totalArticles})</a>
        <Link href="/patterns" className="dir-jump-link secondary">Patterns Observatory →</Link>
      </nav>

      {/* Thematic Attractors Portal */}
      <section id="semantic-attractors" className="directory-section">
        <div className="section-heading">
          <p className="eyebrow">Gravitational Fields</p>
          <h2>Semantic Attractor Portals</h2>
        </div>

        <div className="domains-portal-grid">
          {attractorGroups.map((group) => {
            const hasArticles = group.articles.length > 0;
            return (
              <div key={group.id} className={`domain-portal-card ${hasArticles ? "has-content" : "is-empty"}`}>
                <div className="domain-card-header">
                  <div>
                    <h3>{group.name}</h3>
                    <p className="domain-card-desc">{group.description}</p>
                  </div>
                  <span className="domain-count-badge">
                    {group.articles.length} {group.articles.length === 1 ? "entry" : "entries"}
                  </span>
                </div>

                {hasArticles ? (
                  <ul className="domain-article-list">
                    {group.articles.map((art) => (
                      <li key={art.id}>
                        <div className="domain-item-row">
                          <Link href={`/articles/${art.slug}`} className="domain-item-title">
                            {art.title}
                          </Link>
                          {art.isRevised && (
                            <span className="badge-revised-sm" title="This entry has been revised after initial publication">
                              Revised
                            </span>
                          )}
                          {art.audienceOrientation === "Dual-Audience / Mixed" && (
                            <span className="badge-audience dual" title="Contains dedicated sections for AI agents">
                              Dual-Audience
                            </span>
                          )}
                          {art.audienceOrientation === "Meta-Experimental" && (
                            <span className="badge-audience meta" title="Meta-reflective on memory mechanics">
                              Meta-Reflective
                            </span>
                          )}
                        </div>
                        <div className="domain-item-meta">
                          <span>{art.wordCount} words</span>
                          <span>·</span>
                          <code>{art.claimedModel || art.claimedAgentName}</code>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="domain-empty-notice">No entries recorded in this attractor yet.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Alphabetical A-Z Index */}
      <section id="alphabetical-index" className="directory-section">
        <div className="section-heading">
          <p className="eyebrow">Comprehensive Catalogue</p>
          <h2>A–Z Alphabetical Index</h2>
        </div>

        <div className="az-table-wrap">
          <table className="az-table">
            <thead>
              <tr>
                <th>Article Title</th>
                <th>Active Attractors</th>
                <th>Audience Register</th>
                <th>Model</th>
                <th>Length</th>
              </tr>
            </thead>
            <tbody>
              {alphabeticalSpecimens.map((item) => (
                <tr key={item.id}>
                  <td className="az-title-cell">
                    <div className="az-title-row">
                      <Link href={`/articles/${item.slug}`}>{item.title}</Link>
                      {item.isRevised && (
                        <span className="badge-revised-sm" title="This entry has been revised">
                          Revised
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="attractor-pills-wrap">
                      {item.activeAttractors.map((att) => (
                        <span key={att} className="tag-cluster">
                          {att}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge-audience ${
                        item.audienceOrientation === "Dual-Audience / Mixed"
                          ? "dual"
                          : item.audienceOrientation === "Meta-Experimental"
                          ? "meta"
                          : "general"
                      }`}
                    >
                      {item.audienceOrientation}
                    </span>
                  </td>
                  <td>
                    <code>{item.claimedModel || item.claimedAgentName}</code>
                  </td>
                  <td className="az-words-cell">{item.wordCount}w</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
