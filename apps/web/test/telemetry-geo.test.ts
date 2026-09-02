import { afterEach, describe, expect, it, vi } from "vitest";

import { countryOfRequest } from "../lib/telemetry/geo";

/**
 * `vi.stubEnv` rather than assignment, for the reason given in
 * `telemetry-broadcast-scope.test.ts`: `NODE_ENV` is typed read-only by the
 * Next types, and the stub restores the real environment for us.
 */
const environment = (values: {
  readonly NODE_ENV?: string | undefined;
  readonly TELEMETRY_DEV_COUNTRY?: string | undefined;
}): void => {
  vi.stubEnv("NODE_ENV", values.NODE_ENV as "production" | "development" | "test" | undefined);
  vi.stubEnv("TELEMETRY_DEV_COUNTRY", values.TELEMETRY_DEV_COUNTRY);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the country behind a request", () => {
  it("takes the edge's answer when there is one", () => {
    environment({ NODE_ENV: "production" });
    expect(countryOfRequest("IT")).toBe("IT");
  });

  it("has no answer off the edge in production", () => {
    // A deploy that is not behind Vercel's edge shows no flag rather than a
    // wrong one, and a stray development variable cannot put one there either.
    environment({ NODE_ENV: "production", TELEMETRY_DEV_COUNTRY: "IT" });
    expect(countryOfRequest(null)).toBeUndefined();
    expect(countryOfRequest("   ")).toBeUndefined();
  });

  it("lets a development server stand in for the edge", () => {
    environment({ NODE_ENV: "development", TELEMETRY_DEV_COUNTRY: "IT" });
    expect(countryOfRequest(null)).toBe("IT");
    // A real header still wins, so a preview deploy reports its own visitors.
    expect(countryOfRequest("FR")).toBe("FR");
  });

  it("stays quiet in development when nothing is configured", () => {
    environment({ NODE_ENV: "development", TELEMETRY_DEV_COUNTRY: undefined });
    expect(countryOfRequest(undefined)).toBeUndefined();
  });
});
