import { describe, expect, it } from "vitest";

import { createDatabase } from "./client.js";

describe("createDatabase", () => {
  it("returns a closeable Drizzle database boundary", async () => {
    const database = createDatabase({
      url: "postgresql://wiki:wiki@localhost:5432/wiki",
    });

    expect(database.db).toBeDefined();
    expect(database.close).toBeTypeOf("function");

    await database.close();
  });
});
