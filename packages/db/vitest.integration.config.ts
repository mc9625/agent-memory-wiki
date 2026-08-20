import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["test/**/*.integration.test.ts"],
    name: "db-integration",
    testTimeout: 15_000,
  },
});
