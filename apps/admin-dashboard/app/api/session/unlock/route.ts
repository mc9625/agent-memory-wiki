import { NextResponse } from "next/server";

import { isAllowedHost, LOCAL_DASHBOARD_HOST, LOCAL_DASHBOARD_PORT } from "../../../../lib/launcher";
import { localSessionGate } from "../../../../lib/security/runtime";

const localOrigin = `http://${LOCAL_DASHBOARD_HOST}:${LOCAL_DASHBOARD_PORT}`;
const sessionCookie = "amw_local_session";

const validUnlockRequest = (request: Request): boolean =>
  request.method === "POST" &&
  isAllowedHost(request.headers.get("host") ?? undefined) &&
  request.headers.get("origin") === localOrigin &&
  request.headers.get("sec-fetch-site") === "same-origin";

export async function POST(request: Request) {
  if (!validUnlockRequest(request)) {
    return NextResponse.json({ error: "Invalid local request." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ error: "JSON is required." }, { status: 415 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const code = typeof (payload as { code?: unknown }).code === "string" ? (payload as { code: string }).code : "";
  if (code.length === 0 || code.length > 256) {
    return NextResponse.json({ error: "Invalid unlock code." }, { status: 401 });
  }

  const session = localSessionGate.unlock(code);
  if (!session) {
    return NextResponse.json({ error: "Invalid or already-used unlock code." }, { status: 401 });
  }

  const response = NextResponse.json({ csrfToken: session.csrfToken });
  response.cookies.set(sessionCookie, session.id, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "strict",
  });
  return response;
}
