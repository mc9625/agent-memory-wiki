import { createDatabase, probeDatabaseReadiness } from "@agent-memory-wiki/db";

import { readiness } from "../../../../lib/health";

export const dynamic = "force-dynamic";

export const GET = () =>
  readiness({
    probe: async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error("Missing database configuration");
      const database = createDatabase({ maxConnections: 1, url: databaseUrl });
      try {
        return await probeDatabaseReadiness(database.db);
      } finally {
        await database.close();
      }
    },
  });
