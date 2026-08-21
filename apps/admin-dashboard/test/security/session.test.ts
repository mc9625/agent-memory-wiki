import { describe, expect, it } from "vitest";

import { createLaunchGate } from "../../lib/security/session";

describe("launch session gate", () => {
  it("consumes a launch code exactly once", () => {
    const gate = createLaunchGate("correct-code", () => new Date("2026-08-21T00:00:00Z"));

    expect(gate.unlock("correct-code")).toMatchObject({ csrfToken: expect.any(String) });
    expect(gate.unlock("correct-code")).toBeNull();
  });

  it("expires idle sessions", () => {
    let now = new Date("2026-08-21T00:00:00Z");
    const gate = createLaunchGate("correct-code", () => now);
    const session = gate.unlock("correct-code");
    if (!session) throw new Error("Expected session");
    now = new Date("2026-08-21T00:11:00Z");

    expect(gate.get(session.id)).toBeNull();
  });
});
