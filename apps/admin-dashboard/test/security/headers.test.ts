import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "../../lib/security/headers";

describe("security headers", () => {
  it("uses a nonce CSP without external sources or unsafe-inline", () => {
    const headers = buildSecurityHeaders("nonce");
    expect(headers["content-security-policy"]).toContain("'nonce-nonce'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
    expect(headers["cache-control"]).toBe("no-store");
  });
});
