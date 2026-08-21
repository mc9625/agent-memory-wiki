import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("deployment separation", () => {
  it("does not reference the dashboard from public deployment configuration", async () => {
    const root = new URL("../../../../", import.meta.url);
    const files = await Promise.all(["vercel.json", "Dockerfile", "compose.yml"].map(async (file) => {
      try { return await readFile(new URL(file, root), "utf8"); } catch { return ""; }
    }));
    expect(files.join("\n")).not.toContain("admin-dashboard");
  });
});
