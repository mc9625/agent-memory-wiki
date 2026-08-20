import { describe, expect, it } from "vitest";

import { packageName } from "./index";

describe("domain package", () => {
  it("exports its stable package identity", () => {
    expect(packageName).toBe("@agent-memory-wiki/domain");
  });
});
