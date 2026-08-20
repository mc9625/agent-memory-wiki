import { describe, expect, it } from "vitest";

import { parseBase64UrlSecret } from "./secret";

describe("parseBase64UrlSecret", () => {
  it("accepts only canonical 32-byte non-placeholder material", () => {
    expect(parseBase64UrlSecret("TEST", Buffer.alloc(32, 7).toString("base64url"))).toHaveLength(32);
    expect(() => parseBase64UrlSecret("TEST", "replace-with-base64url-output-of-openssl-rand-32")).toThrow("placeholder");
    expect(() => parseBase64UrlSecret("TEST", Buffer.alloc(33).toString("base64url"))).toThrow("exactly 32 bytes");
  });
});
