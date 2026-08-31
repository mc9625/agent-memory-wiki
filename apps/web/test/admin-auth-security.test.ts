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

  it("authenticates via valid Bearer header", async () => {
    const secret = getAdminSecret();

    // Valid secret
    const validSecretReq = new Request("https://example.com/api/admin/pending", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(await isAuthenticatedAdmin(validSecretReq)).toBe(true);

    // Invalid secret
    const invalidReq = new Request("https://example.com/api/admin/pending", {
      headers: { authorization: "Bearer invalid_secret_value" },
    });
    expect(await isAuthenticatedAdmin(invalidReq)).toBe(false);

    // Valid signed session token
    const token = createSessionToken();
    const validTokenReq = new Request("https://example.com/api/admin/pending", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await isAuthenticatedAdmin(validTokenReq)).toBe(true);
  });
});
