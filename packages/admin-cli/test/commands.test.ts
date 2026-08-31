import { describe, expect, it, vi } from "vitest";

import {
  activateInstruction,
  approveRevision,
  cleanupRateLimits,
  createCredential,
  hideArticle,
  listPendingRevisions,
  quarantineRevision,
  rejectRevision,
  requireEnvironmentConfirmation,
  revokeCredential,
  setReadOnly,
} from "../src/commands";
import type { AdminStore } from "../src/ports";
import { parseOnOff } from "../src/index";

const store = (): AdminStore => ({
  activateInstruction: vi.fn(async () => undefined),
  createCredential: vi.fn(async () => undefined),
  deleteExpiredRateLimits: vi.fn(async () => 2),
  getSettings: vi.fn(async () => null),
  hideArticle: vi.fn(async () => undefined),
  listCredentials: vi.fn(async () => []),
  quarantineRevision: vi.fn(async () => undefined),
  approveRevision: vi.fn(async () => undefined),
  rejectRevision: vi.fn(async () => undefined),
  listPendingRevisions: vi.fn(async () => []),
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

  it("rejects non-32-byte credential digest keys", async () => {
    await expect(
      createCredential(
        {
          instructionSetId: "00000000-0000-4000-8000-000000000001",
          operatorLabel: "participant-01",
          rateLimitPerDay: 500,
          rateLimitPerMinute: 30,
          termsAcceptedAt: new Date("2026-08-20T00:00:00Z"),
          termsVersion: "pilot-v1",
        },
        { digestKey: Buffer.alloc(33), store: store() },
      ),
    ).rejects.toThrow("exactly 32 bytes");
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
    await activateInstruction(
      { instructionSetId: "instruction", reasonCode: "PILOT_UPDATE", at },
      target,
    );
    expect(target.setReadOnly).toHaveBeenCalledWith(expect.objectContaining({ actorType: "admin", reasonCode: "INCIDENT" }));
    expect(target.activateInstruction).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "admin", instructionSetId: "instruction" }),
    );
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

  it("requires the explicit production-strength confirmation for every target", () => {
    expect(() => requireEnvironmentConfirmation(false)).toThrow("--confirm-production");
    expect(() => requireEnvironmentConfirmation(true)).not.toThrow();
  });

  it("rejects ambiguous read-only values", () => {
    expect(parseOnOff("on")).toBe(true);
    expect(parseOnOff("off")).toBe(false);
    expect(() => parseOnOff("onn")).toThrow("on or off");
  });

  it("approves and rejects pending submissions with proper audit mutations", async () => {
    const target = store();
    const at = new Date("2026-08-20T12:00:00Z");
    await approveRevision({ revisionId: "rev-1", reasonCode: "ADMIN_APPROVED", at }, target);
    await rejectRevision({ revisionId: "rev-2", reasonCode: "SPAM", at }, target);
    await listPendingRevisions(target);

    expect(target.approveRevision).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "admin", reasonCode: "ADMIN_APPROVED", revisionId: "rev-1" }),
    );
    expect(target.rejectRevision).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "admin", reasonCode: "SPAM", revisionId: "rev-2" }),
    );
    expect(target.listPendingRevisions).toHaveBeenCalled();
  });
});
