import { NextResponse } from "next/server";

import { requireAdminSession } from "../../../lib/admin-request";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Local session required." }, { status: 401 });
  return NextResponse.json({ csrfToken: session.csrfToken });
}
