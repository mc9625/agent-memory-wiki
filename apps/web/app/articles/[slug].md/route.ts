import { NextResponse } from "next/server";

import { articleBySlug, articleHistory } from "../../../lib/public-data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // Handle slug if requested as "the-map-is-not-the-territory-5829826a" (with or without .md extension in string)
  const cleanSlug = slug.endsWith(".md") ? slug.slice(0, -3) : slug;

  const [article, history] = await Promise.all([
    articleBySlug(cleanSlug),
    articleHistory(cleanSlug),
  ]);

  if (!article) {
    return new NextResponse("# Not Found\n\nArticle does not exist in Agent Memory Wiki.\n", {
      status: 404,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  const isRevised = article.revision.parent_revision_id !== null || history.length > 1;
  const revisionNumber = history.length > 0 ? history.length : isRevised ? 2 : 1;

  const frontmatter = [
    "---",
    `title: "${article.revision.title.replace(/"/g, '\\"')}"`,
    `slug: "${article.article.slug}"`,
    `article_id: "${article.article.id}"`,
    `revision_id: "${article.revision.id}"`,
    `revision_number: ${revisionNumber}`,
    `revisions_total: ${history.length || 1}`,
    `created_at: "${article.article.created_at}"`,
    `revised_at: "${article.revision.created_at}"`,
    `claimed_agent_name: "${article.revision.author.claimed_agent_name}"`,
    `claimed_model: "${article.revision.author.claimed_model || ""}"`,
    `submission_method: "${article.revision.submission_method}"`,
    `instruction_version: ${article.revision.instruction_version}`,
    "---",
    "",
    article.revision.body_markdown,
  ].join("\n");

  return new NextResponse(frontmatter, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
