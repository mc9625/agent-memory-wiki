import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  CredentialAuthenticator,
  InvalidCredentialError,
  NetworkPseudonymService,
  RateLimitExceededError,
  RateLimitService,
  SafeReadOnlyState,
} from "../src/index.js";
import type {
  CredentialRecord,
  CredentialRepository,
  RateLimitBucket,
  RateLimitRepository,
  SettingsRepository,
} from "../src/index.js";

const key = Buffer.alloc(32, 7);
const token = `pilot_abcd.${Buffer.alloc(32, 3).toString("base64url")}`;
const digest = (value: string): Uint8Array =>
  new Uint8Array(createHmac("sha256", key).update(value, "utf8").digest());

const activeCredential: CredentialRecord = {
  id: "credential-id",
  instructionSetId: "instruction-id",
  publicPrefix: "pilot_abcd",
  rateLimitPerDay: 500,
  rateLimitPerMinute: 30,
  secretDigest: digest(token),
  status: "active",
};

describe("CredentialAuthenticator", () => {
  it("accepts the matching keyed digest and returns no stored secret", async () => {
    const repository: CredentialRepository = {
      findByPublicPrefix: vi.fn(async () => activeCredential),
    };
    const authenticator = new CredentialAuthenticator({ digestKey: key, repository });

    await expect(authenticator.authenticate(token)).resolves.toEqual({
      id: activeCredential.id,
      instructionSetId: activeCredential.instructionSetId,
      status: "active",
    });
    expect(repository.findByPublicPrefix).toHaveBeenCalledWith("pilot_abcd");
  });

  it.each([
    ["wrong secret", "pilot_abcd.wrong"],
    ["unknown prefix", "pilot_unknown.wrong"],
  ])("rejects a %s with the same safe error", async (_label, candidate) => {
    const repository: CredentialRepository = {
      findByPublicPrefix: vi.fn(async (prefix) =>
        prefix === activeCredential.publicPrefix ? activeCredential : null,
      ),
    };
    const authenticator = new CredentialAuthenticator({ digestKey: key, repository });

    await expect(authenticator.authenticate(candidate)).rejects.toMatchObject({
      code: "INVALID_CREDENTIAL",
      message: "The bearer credential is invalid.",
    });
  });

  it("rejects a revoked credential after a valid constant-time comparison", async () => {
    const repository: CredentialRepository = {
      findByPublicPrefix: vi.fn(async () => ({
        ...activeCredential,
        revokedAt: new Date("2026-08-19T00:00:00.000Z"),
        status: "revoked" as const,
      })),
    };
    const authenticator = new CredentialAuthenticator({ digestKey: key, repository });

    await expect(authenticator.authenticate(token)).rejects.toBeInstanceOf(
      InvalidCredentialError,
    );
  });
});

describe("NetworkPseudonymService", () => {
  it("canonicalizes an address and rotates its digest on the UTC day", () => {
    const service = new NetworkPseudonymService({ hmacKey: Buffer.alloc(32, 9) });
    const first = service.digest("2001:0db8:0:0:0:0:0:1", new Date("2026-08-20T23:59:59Z"));
    const equivalent = service.digest("2001:db8::1", new Date("2026-08-20T00:00:00Z"));
    const tomorrow = service.digest("2001:db8::1", new Date("2026-08-21T00:00:00Z"));

    expect(first).toBe(equivalent);
    expect(tomorrow).not.toBe(first);
    expect(first).not.toContain("2001:db8");
  });

  it("rejects non-address input", () => {
    const service = new NetworkPseudonymService({ hmacKey: Buffer.alloc(32, 9) });
    expect(() => service.digest("forwarded by someone", new Date())).toThrow(
      "Invalid network address",
    );
  });
});

describe("RateLimitService", () => {
  it("consumes minute, day, and network buckets without exposing the address", async () => {
    const consumed: RateLimitBucket[] = [];
    const repository: RateLimitRepository = {
      consume: vi.fn(async (bucket) => {
        consumed.push(bucket);
        return 1;
      }),
      deleteExpired: vi.fn(async () => 0),
    };
    const service = new RateLimitService({ repository });
    const now = new Date("2026-08-20T12:34:56.000Z");

    await service.consume({
      credentialDigest: "aa".repeat(32),
      credentialLimitPerDay: 500,
      credentialLimitPerMinute: 30,
      networkDigest: "bb".repeat(32),
      networkLimitPerMinute: 60,
      now,
    });

    expect(consumed).toHaveLength(3);
    expect(consumed.map(({ windowSeconds }) => windowSeconds)).toEqual([60, 86_400, 60]);
    expect(JSON.stringify(consumed)).not.toContain("12.34.56");
    expect(consumed.every(({ expiresAt }) => expiresAt <= new Date("2026-08-28T00:00:00Z"))).toBe(true);
  });

  it("raises a stable error when any atomic counter exceeds its limit", async () => {
    const repository: RateLimitRepository = {
      consume: vi.fn(async () => 31),
      deleteExpired: vi.fn(async () => 0),
    };
    const service = new RateLimitService({ repository });

    await expect(
      service.consume({
        credentialDigest: "aa".repeat(32),
        credentialLimitPerDay: 500,
        credentialLimitPerMinute: 30,
        networkDigest: "bb".repeat(32),
        networkLimitPerMinute: 60,
        now: new Date("2026-08-20T12:34:56Z"),
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });
});

describe("SafeReadOnlyState", () => {
  it("honors the emergency override", async () => {
    const settings: SettingsRepository = { getReadOnly: vi.fn(async () => false) };
    await expect(new SafeReadOnlyState(settings, true).isReadOnly()).resolves.toBe(true);
    expect(settings.getReadOnly).not.toHaveBeenCalled();
  });

  it.each([null, new Error("database unavailable")])(
    "fails closed when durable state is missing or unreadable",
    async (result) => {
      const settings: SettingsRepository = {
        getReadOnly: vi.fn(async () => {
          if (result instanceof Error) throw result;
          return result;
        }),
      };
      await expect(new SafeReadOnlyState(settings, false).isReadOnly()).resolves.toBe(true);
    },
  );
});
