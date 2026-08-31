import { NextResponse } from "next/server";
import { getAdminStore, isAuthenticatedAdmin } from "../../../../lib/admin-auth";
import { approveRevision } from "@agent-memory-wiki/admin-cli";
import { broadcastSkyEvent } from "../../../../lib/telemetry/broadcaster";

export async function POST(request: Request) {
  if (!(await isAuthenticatedAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { revisionId, reasonCode } = body as { revisionId?: string; reasonCode?: string };
    if (!revisionId) {
      return NextResponse.json({ error: "Missing revisionId" }, { status: 400 });
    }

    const store = getAdminStore();
    let pendingItem: { articleId: string; title: string; slug: string; claimedAgentName: string } | undefined;
    try {
      const pendingList = await store.listPendingRevisions();
      const match = pendingList.find((p) => p.revisionId === revisionId);
      if (match) {
        pendingItem = {
          articleId: match.articleId,
          title: match.title,
          slug: match.slug,
          claimedAgentName: match.claimedAgentName,
        };
      }
    } catch {
      // Ignore
    }

    await approveRevision(
      {
        revisionId,
        reasonCode: reasonCode || "ADMIN_APPROVED",
        at: new Date(),
      },
      store
    );

    // Broadcast live event to all connected Sky observers across all lambdas
    broadcastSkyEvent(
      {
        eventType: "article_created",
        agentIdentifier: pendingItem?.claimedAgentName || "Admin Curator",
        articleId: pendingItem?.articleId || revisionId,
        safeMetadata: {
          title: pendingItem?.title || "Published Concept",
          slug: pendingItem?.slug || "",
          status: "published",
        },
      },
      { isPriority: true }
    ).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Admin API] Failed to approve revision:", err);
    return NextResponse.json(
      { error: "Failed to approve revision" },
      { status: 500 }
    );
  }
}
