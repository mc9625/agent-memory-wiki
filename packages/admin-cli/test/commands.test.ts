import { describe, expect, it, vi } from "vitest";

import {
  cleanupRateLimits,
  createCredential,
  hideArticle,
  quarantineRevision,
  requireEnvironmentConfirmation,
  revokeCredential,
  setReadOnly,
} from "../src/commands";
import type { AdminStore } from "../src/ports";

const store = (): AdminStore => ({
  createCredential: vi.fn(async () => undefined),
  deleteExpiredRateLimits: vi.fn(async () => 2),
  hideArticle: vi.fn(async () => undefined),
  quarantineRevision: vi.fn(async () => undefined),
  revokeCredential: vi.fn(async () => undefined),
  setReadOnly: vi.fn(async () => undefined),
});

describe("admin commands", () => {
  it("prints a new credential once while storing only prefix and keyed digest", async () => {
    const target = store();
    const result = await createCredential(
      {
        instructionSetId: "00000000-0000-4000-8000-000000000001",
        operatorLabel: "participant-01",
        rateLimitPerDay: 500,
        rateLimitPerMinute: 30,
        termsAcceptedAt: new Date("2026-08-20T00:00:00Z"),
        termsVersion: "pilot-v1",
      },
      { digestKey: Buffer.alloc(32, 7), store: target },
    );
    expect(result.bearerToken).toMatch(/^pilot_[A-Za-z0-9_-]{10}\.[A-Za-z0-9_-]{43}$/u);
    expect(target.createCredential).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(target.createCredential).mock.calls[0]?.[0];
    expect(persisted).not.toHaveProperty("bearerToken");
    expect(persisted?.secretDigest).toHaveLength(32);
    expect(JSON.stringify(persisted)).not.toContain(result.bearerToken);
  });

  it("requires reasons for every moderation/state mutation", async () => {
    const target = store();
    await expect(revokeCredential({ credentialId: "id", reasonCode: "" }, target)).rejects.toThrow("reason");
    await expect(hideArticle({ articleId: "id", reasonCode: "" }, target)).rejects.toThrow("reason");
    await expect(quarantineRevision({ reasonCode: "", revisionId: "id" }, target)).rejects.toThrow("reason");
    expect(target.revokeCredential).not.toHaveBeenCalled();
  });

  it("passes explicit actor, reason, and time to auditable mutations", async () => {
    const target = store();
    const at = new Date("2026-08-20T12:00:00Z");
    await revokeCredential({ credentialId: "credential", reasonCode: "PILOT_ENDED", at }, target);
    await setReadOnly({ enabled: true, reasonCode: "INCIDENT", at }, target);
    await quarantineRevision({ revisionId: "revision", reasonCode: "MALFORMED", at }, target);
    await hideArticle({ articleId: "article", reasonCode: "OPERATOR_REQUEST", at }, target);
    expect(target.setReadOnly).toHaveBeenCalledWith(expect.objectContaining({ actorType: "admin", reasonCode: "INCIDENT" }));
  });

  it("delegates cleanup with a seven-day safety boundary", async () => {
    const target = store();
    const now = new Date("2026-08-20T12:00:00Z");
    await expect(cleanupRateLimits(now, target)).resolves.toBe(2);
    expect(target.deleteExpiredRateLimits).toHaveBeenCalledWith({
      expiredAtOrBefore: now,
      windowStartedAtOrBefore: new Date("2026-08-13T12:00:00Z"),
    });
  });

  it("refuses production mutation without the explicit confirmation flag", () => {
    expect(() => requireEnvironmentConfirmation("production", false)).toThrow("--confirm-production");
    expect(() => requireEnvironmentConfirmation("production", true)).not.toThrow();
    expect(() => requireEnvironmentConfirmation("development", false)).not.toThrow();
  });
});
