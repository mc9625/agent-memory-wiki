import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../src/client.js";
import { DrizzleCredentialRepository } from "../src/repositories/credential-repository.js";
import { DrizzleRateLimitRepository } from "../src/repositories/rate-limit-repository.js";
import { DrizzleSettingsRepository } from "../src/repositories/settings-repository.js";
import { pilotCredentials, systemSettings } from "../src/schema/index.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://wiki_owner:wiki_owner@localhost:55432/wiki_test";
const database = createDatabase({ maxConnections: 12, url: databaseUrl });

afterAll(async () => database.close());

beforeEach(async () => {
  await database.db.execute(sql.raw(`
    TRUNCATE TABLE rate_limit_buckets, pilot_credentials RESTART IDENTITY CASCADE
  `));
  await database.db
    .insert(systemSettings)
    .values({ singleton: true, readOnly: false, settingsVersion: 1 })
    .onConflictDoUpdate({
      target: systemSettings.singleton,
      set: { readOnly: false, settingsVersion: 1 },
    });
});

afterEach(async () => {
  await database.db
    .insert(systemSettings)
    .values({ singleton: true, readOnly: false, settingsVersion: 1 })
    .onConflictDoUpdate({
      target: systemSettings.singleton,
      set: { readOnly: false, settingsVersion: 1 },
    });
});

describe("security repositories", () => {
  it("increments one bucket atomically under concurrency", async () => {
    const repository = new DrizzleRateLimitRepository(database.db);
    const definition = {
      expiresAt: new Date("2026-08-27T12:36:00Z"),
      subjectDigest: "ab".repeat(32),
      subjectType: "credential" as const,
      windowSeconds: 60,
      windowStartedAt: new Date("2026-08-20T12:35:00Z"),
    };

    const counts = await Promise.all(
      Array.from({ length: 35 }, async () => repository.consume(definition)),
    );

    expect(new Set(counts).size).toBe(35);
    expect(Math.max(...counts)).toBe(35);
  });

  it("deletes only expired pseudonymous buckets", async () => {
    const repository = new DrizzleRateLimitRepository(database.db);
    const base = {
      subjectType: "network" as const,
      windowSeconds: 60,
      windowStartedAt: new Date("2026-08-20T12:35:00Z"),
    };
    await repository.consume({
      ...base,
      expiresAt: new Date("2026-08-21T00:00:00Z"),
      subjectDigest: "11".repeat(32),
    });
    await repository.consume({
      ...base,
      expiresAt: new Date("2026-08-29T00:00:00Z"),
      subjectDigest: "22".repeat(32),
    });

    await expect(repository.deleteExpired(new Date("2026-08-28T00:00:00Z"))).resolves.toBe(1);
  });

  it("loads credential controls without a bearer secret", async () => {
    await database.db.insert(pilotCredentials).values({
      id: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
      publicPrefix: "pilot_abcd",
      secretDigest: Buffer.alloc(32, 7),
      instructionSetId: "00000000-0000-4000-8000-000000000001",
      termsVersion: "pilot-v1",
      termsAcceptedAt: new Date("2026-08-20T00:00:00Z"),
      status: "active",
      rateLimitPerMinute: 30,
      rateLimitPerDay: 500,
    });

    const record = await new DrizzleCredentialRepository(database.db).findByPublicPrefix(
      "pilot_abcd",
    );
    expect(record).toMatchObject({
      id: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
      publicPrefix: "pilot_abcd",
      status: "active",
    });
    expect(record).not.toHaveProperty("operatorLabel");
  });

  it("reads the durable global setting and reports a missing row", async () => {
    const repository = new DrizzleSettingsRepository(database.db);
    await expect(repository.getReadOnly()).resolves.toBe(false);
    await database.db.delete(systemSettings);
    await expect(repository.getReadOnly()).resolves.toBeNull();
  });
});
