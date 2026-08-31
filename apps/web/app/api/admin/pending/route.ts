import { NextResponse } from "next/server";
import { getAdminStore, isAuthenticatedAdmin } from "../../../../lib/admin-auth";

export async function GET(request: Request) {
  if (!(await isAuthenticatedAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const store = getAdminStore();
    const items = await store.listPendingRevisions();
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[Admin API] Failed to list pending revisions:", err);
    return NextResponse.json(
      { error: "Failed to load pending submissions" },
      { status: 500 }
    );
  }
}
