import { describe, expect, it } from "vitest";

import { classifyClientAgent, isUntrackedClient } from "../lib/telemetry/broadcaster";

/**
 * `ki-radar/0.1` polls the site and tells us nothing about itself. These cases
 * pin the two halves of keeping it off the floor: that the classifier still
 * produces the identifier the filter is matched against, and that the filter
 * matches it without swallowing anything else.
 */
describe("untracked clients", () => {
  it("keeps ki-radar off the floor", () => {
    const { agentName } = classifyClientAgent("ki-radar/0.1");
    expect(isUntrackedClient(agentName)).toBe(true);
  });

  it("keeps it off after a version bump, which is why the match is a prefix", () => {
    expect(isUntrackedClient(classifyClientAgent("ki-radar/2.7").agentName)).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(isUntrackedClient("  KI-Radar/0.1  ")).toBe(true);
  });

  it("lets every other client through", () => {
    for (const userAgent of [
      "Claude",
      "ChatGPT",
      "curl/8.7.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "radar/0.1",
      "some-ki-radar-clone/1.0",
    ]) {
      expect(isUntrackedClient(classifyClientAgent(userAgent).agentName)).toBe(false);
    }
  });

  it("says nothing about an event that carries no identifier", () => {
    expect(isUntrackedClient(undefined)).toBe(false);
    expect(isUntrackedClient(null)).toBe(false);
    expect(isUntrackedClient("")).toBe(false);
  });
});
