import { describe, expect, it } from "vitest";

import { packageName } from "./index.js";

describe("domain package", () => {
  it("exports its stable package identity", () => {
    expect(packageName).toBe("@agent-memory-wiki/domain");
  });
});
