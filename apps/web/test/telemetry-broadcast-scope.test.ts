import { afterEach, describe, expect, it, vi } from "vitest";

import { publishesToBroker } from "../lib/telemetry/broadcaster";

/**
 * The broker topic is one public channel shared by every environment that did
 * not override its name, which was all of them. These cases are the ones that
 * were publishing production telemetry from somewhere that is not production.
 *
 * `vi.stubEnv` rather than assignment: `NODE_ENV` is typed read-only by the
 * Next types, and the stub restores the real environment for us.
 */
const environment = (values: {
  readonly CI?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly VERCEL_ENV?: string | undefined;
}): void => {
  vi.stubEnv("CI", values.CI);
  vi.stubEnv("NODE_ENV", values.NODE_ENV as "production" | "development" | "test" | undefined);
  vi.stubEnv("VERCEL_ENV", values.VERCEL_ENV);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("telemetry broker scope", () => {
  it("publishes from a production deployment", () => {
    environment({ NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(publishesToBroker()).toBe(true);
  });

  it("publishes from a self-hosted deployment, which sets no VERCEL_ENV", () => {
    environment({ NODE_ENV: "production" });
    expect(publishesToBroker()).toBe(true);
  });

  it("stays quiet under `pnpm dev`", () => {
    environment({ NODE_ENV: "development" });
    expect(publishesToBroker()).toBe(false);
  });

  it("stays quiet in CI, which serves the e2e run through `next start`", () => {
    // NODE_ENV alone cannot tell this apart from production: `next start` sets
    // it either way, which is how the e2e run's articles reached the live floor.
    environment({ CI: "true", NODE_ENV: "production" });
    expect(publishesToBroker()).toBe(false);
  });

  it("stays quiet on a preview deployment, which is also a production build", () => {
    environment({ NODE_ENV: "production", VERCEL_ENV: "preview" });
    expect(publishesToBroker()).toBe(false);
  });
});
