import { describe, expect, it, vi } from "vitest";

import { liveness, readiness } from "../lib/health";

describe("health checks", () => {
  it("reports liveness without touching dependencies", async () => {
    const probe = vi.fn(async () => ({ migrationsCompatible: true, readOnly: false }));
    const response = liveness();
    expect(response.status).toBe(200);
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports readiness only when database, migrations, and global mode are readable", async () => {
    const ready = await readiness({ probe: async () => ({ migrationsCompatible: true, readOnly: false }) });
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ status: "ready" });
  });

  it.each([
    ["migration mismatch", async () => ({ migrationsCompatible: false, readOnly: false })],
    ["missing mode", async () => ({ migrationsCompatible: true, readOnly: null })],
    ["database failure", async () => Promise.reject(new Error("private database detail"))],
  ])("returns a safe 503 for %s", async (_label, probe) => {
    const response = await readiness({ probe });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });
});
