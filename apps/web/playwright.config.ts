import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir: "../../test-results",
  reporter: "line",
  retries: process.env.CI ? 1 : 0,
  testDir: "e2e",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3010",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: {
    command: "pnpm exec next start --hostname 127.0.0.1 --port 3010",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://127.0.0.1:3010/api/health/ready",
  },
  workers: 1,
});
