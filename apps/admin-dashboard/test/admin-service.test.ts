import { describe, expect, it } from "vitest";

import { presentCredential } from "../lib/admin-views";

describe("operator read models", () => {
  it("does not include credential digests or bearer tokens in the credential view", () => {
    const view = presentCredential({
      createdAt: new Date("2026-08-21T00:00:00Z"),
      id: "credential-id",
      instructionSetId: "instruction-id",
      operatorLabel: "Pilot agent",
      publicPrefix: "pilot_public",
      rateLimitPerDay: 50,
      rateLimitPerMinute: 5,
      revokedAt: null,
      status: "active",
      termsAcceptedAt: new Date("2026-08-21T00:00:00Z"),
      termsVersion: "v1",
    });

    expect(view).toEqual({
      createdAt: "2026-08-21T00:00:00.000Z",
      id: "credential-id",
      instructionSetId: "instruction-id",
      operatorLabel: "Pilot agent",
      publicPrefix: "pilot_public",
      rateLimitPerDay: 50,
      rateLimitPerMinute: 5,
      revokedAt: null,
      status: "active",
      termsAcceptedAt: "2026-08-21T00:00:00.000Z",
      termsVersion: "v1",
    });
    expect(view).not.toHaveProperty("secretDigest");
    expect(view).not.toHaveProperty("bearerToken");
  });
});
