import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminStore, isAuthenticatedAdmin } from "../../../../lib/admin-auth";
import { approveRevision } from "@agent-memory-wiki/admin-cli";
import { liveEventBus } from "../../../../lib/http/event-bus";

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

    // Broadcast live event to all connected Sky observers
    try {
      liveEventBus.publish({
        id: randomUUID(),
        sessionId: randomUUID(),
        generation: 1,
        eventType: "article_created",
        agentIdentifier: pendingItem?.claimedAgentName || "Admin Curator",
        articleId: pendingItem?.articleId || revisionId,
        createdAt: new Date().toISOString(),
        safeMetadata: {
          title: pendingItem?.title || "Published Concept",
          slug: pendingItem?.slug || "",
          status: "published",
        },
      });
    } catch (e) {
      console.warn("[Admin API] Could not broadcast live approval event:", e);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Admin API] Failed to approve revision:", err);
    return NextResponse.json(
      { error: "Failed to approve revision" },
      { status: 500 }
    );
  }
}
