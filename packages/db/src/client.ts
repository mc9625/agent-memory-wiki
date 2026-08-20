import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index";

export interface DatabaseConfig {
  readonly url: string;
  readonly maxConnections?: number;
}

export const createDatabase = ({ url, maxConnections = 10 }: DatabaseConfig) => {
  const client = postgres(url, {
    max: maxConnections,
    onnotice: () => undefined,
  });

  return Object.freeze({
    db: drizzle(client, { schema }),
    close: async (): Promise<void> => {
      await client.end({ timeout: 5 });
    },
  });
};

export type Database = ReturnType<typeof createDatabase>["db"];
