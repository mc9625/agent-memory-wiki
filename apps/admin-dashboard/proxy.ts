import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { isAllowedHost } from "./lib/launcher";
import { buildSecurityHeaders } from "./lib/security/headers";

export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host") ?? undefined)) {
    return new NextResponse("Local dashboard host required.", { status: 421 });
  }

  const nonce = randomBytes(16).toString("base64");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  for (const [name, value] of Object.entries(buildSecurityHeaders(nonce))) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
