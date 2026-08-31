import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  getAdminSecret,
  isAuthenticatedAdmin,
  verifyPassword,
  verifySessionToken,
} from "../lib/admin-auth";

describe("admin authentication security", () => {
  it("verifies password accurately", () => {
    const secret = getAdminSecret();
    expect(verifyPassword(secret)).toBe(true);
    expect(verifyPassword("wrong-password")).toBe(false);
    expect(verifyPassword("")).toBe(false);
    expect(verifyPassword(undefined)).toBe(false);
  });

  it("signs and verifies session tokens", () => {
    const token = createSessionToken();
    expect(token).toContain(".");
    expect(verifySessionToken(token)).toBe(true);
  });

  it("rejects forged or tampered session tokens", () => {
    const token = createSessionToken();
    const [payload, sig] = token.split(".");

    // Tampered payload
    const tamperedPayload = Buffer.from(
      JSON.stringify({ admin: true, exp: Date.now() + 99999999 }),
      "utf8"
    ).toString("base64url");
    expect(verifySessionToken(`${tamperedPayload}.${sig}`)).toBe(false);

    // Tampered signature
    expect(verifySessionToken(`${payload}.forged_signature_123`)).toBe(false);

    // Garbage token
    expect(verifySessionToken("invalid-token")).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
  });

  it("rejects raw password in Authorization header and only accepts signed session token", async () => {
    const secret = getAdminSecret();

    // Raw password in header should NOT authenticate directly without a signed session
    const rawReq = new Request("https://example.com/api/admin/pending", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(await isAuthenticatedAdmin(rawReq)).toBe(false);

    // Signed session token in header should authenticate
    const token = createSessionToken();
    const validReq = new Request("https://example.com/api/admin/pending", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await isAuthenticatedAdmin(validReq)).toBe(true);
  });
});
