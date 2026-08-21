import { describe, expect, it } from "vitest";

import { validateMutationRequest } from "../../lib/security/request-guard";

const request = (headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:4317/api/admin/test", {
    headers: {
      host: "127.0.0.1:4317",
      origin: "http://127.0.0.1:4317",
      "sec-fetch-site": "same-origin",
      "x-amw-csrf": "csrf",
      ...headers,
    },
    method: "POST",
  });

describe("mutation request guard", () => {
  it("rejects wrong host, origin, fetch-site, and CSRF token", () => {
    expect(validateMutationRequest(request({ host: "evil.test" }), "csrf").ok).toBe(false);
    expect(validateMutationRequest(request({ origin: "http://evil.test" }), "csrf").ok).toBe(false);
    expect(validateMutationRequest(request({ "sec-fetch-site": "cross-site" }), "csrf").ok).toBe(false);
    expect(validateMutationRequest(request({ "x-amw-csrf": "wrong" }), "csrf").ok).toBe(false);
  });

  it("accepts an exact local same-origin POST", () => {
    expect(validateMutationRequest(request(), "csrf")).toEqual({ ok: true });
  });
});
