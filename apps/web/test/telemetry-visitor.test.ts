import { describe, expect, it } from "vitest";

import { visitorSessionId } from "../lib/telemetry/visitor";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const NOON = Date.parse("2026-09-01T12:00:00.000Z");

describe("visitor session identity", () => {
  it("gives one visitor the same identifier across their page views", () => {
    // The bug this exists for: every broadcast took its own randomUUID, so the
    // home page and the article a visitor opened next were two sessions, and
    // /world put two unrelated avatars on the floor for one person.
    const first = visitorSessionId("203.0.113.7", UA, NOON);
    const second = visitorSessionId("203.0.113.7", UA, NOON + 90_000);
    expect(second).toBe(first);
  });

  it("separates two visitors on the same address", () => {
    const safari = visitorSessionId("203.0.113.7", UA, NOON);
    const other = visitorSessionId("203.0.113.7", `${UA} Chrome/140`, NOON);
    expect(other).not.toBe(safari);
  });

  it("separates two addresses running the same browser", () => {
    expect(visitorSessionId("203.0.113.7", UA, NOON)).not.toBe(
      visitorSessionId("198.51.100.4", UA, NOON),
    );
  });

  it("expires the identity once the visit window has passed", () => {
    // Visit-scoped by construction: a return tomorrow is a new session, which
    // is what keeps a browsing identifier from becoming a persistent one.
    expect(visitorSessionId("203.0.113.7", UA, NOON + 31 * 60_000)).not.toBe(
      visitorSessionId("203.0.113.7", UA, NOON),
    );
  });

  it("publishes nothing that reads back as an address", () => {
    const id = visitorSessionId("203.0.113.7", UA, NOON);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain("203.0.113.7");
  });

  it("still yields an identifier when the headers are missing", () => {
    expect(visitorSessionId(null, null, NOON)).toMatch(/^[0-9a-f]{32}$/);
  });
});
