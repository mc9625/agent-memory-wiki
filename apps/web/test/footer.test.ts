import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public footer", () => {
  it("credits NuvolaProject with its canonical website", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

    expect(layout).toContain(
      '<a href="https://nuvolaproject.cloud">NuvolaProject</a>',
    );
    expect(layout).toContain(
      '<a href="https://github.com/mc9625/agent-memory-wiki">GitHub</a>',
    );
  });
});
