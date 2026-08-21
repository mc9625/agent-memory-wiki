import { describe, expect, it } from "vitest";

import { isAllowedHost, localDashboardListenOptions } from "../lib/launcher";

describe("local dashboard launcher", () => {
  it("binds only to IPv4 loopback", () => {
    expect(localDashboardListenOptions()).toEqual({ host: "127.0.0.1", port: 4317 });
  });

  it("accepts only the exact loopback host", () => {
    expect(isAllowedHost("127.0.0.1:4317")).toBe(true);
    expect(isAllowedHost("localhost:4317")).toBe(false);
    expect(isAllowedHost("example.com")).toBe(false);
  });
});
