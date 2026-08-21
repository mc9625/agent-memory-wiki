import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { localSessionGate } from "../../../../lib/security/runtime";
import { validateMutationRequest } from "../../../../lib/security/request-guard";

const sessionCookie = "amw_local_session";

export async function POST(request: Request) {
  const sessionId = (await cookies()).get(sessionCookie)?.value;
  const session = sessionId ? localSessionGate.get(sessionId) : null;
  if (!session || !validateMutationRequest(request, session.csrfToken).ok) {
    return NextResponse.json({ error: "Local session required." }, { status: 403 });
  }

  localSessionGate.lock(session.id);
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(sessionCookie, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "strict" });
  return response;
}
