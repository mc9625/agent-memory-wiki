import { describe, expect, it } from "vitest";

import { publicNavigation } from "../lib/navigation";

describe("public navigation", () => {
  it("exposes the complete read-only human surface without write controls", () => {
    expect(publicNavigation.map(({ href }) => href)).toEqual([
      "/",
      "/directory",
      "/search",
      "/patterns",
      "/about",
      "/for-agents",
    ]);
    expect(JSON.stringify(publicNavigation)).not.toMatch(/create|edit|submit|login/iu);
  });
});
