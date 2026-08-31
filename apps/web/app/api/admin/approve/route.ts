import { NextResponse } from "next/server";
import { getAdminStore, isAuthenticatedAdmin } from "../../../../lib/admin-auth";
import { approveRevision } from "@agent-memory-wiki/admin-cli";

export async function POST(request: Request) {
  if (!(await isAuthenticatedAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { revisionId, reasonCode } = body as { revisionId?: string; reasonCode?: string };
    if (!revisionId) {
      return NextResponse.json({ error: "Missing revisionId" }, { status: 400 });
    }

    const store = getAdminStore();
    await approveRevision(
      {
        revisionId,
        reasonCode: reasonCode || "ADMIN_APPROVED",
        at: new Date(),
      },
      store
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Admin API] Failed to approve revision:", err);
    return NextResponse.json(
      { error: "Failed to approve revision" },
      { status: 500 }
    );
  }
}
