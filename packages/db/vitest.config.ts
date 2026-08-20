import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    exclude: ["test/**/*.integration.test.ts"],
    name: "db",
  },
});
