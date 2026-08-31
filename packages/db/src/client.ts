import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index";

export interface DatabaseConfig {
  readonly lockTimeoutMs?: number;
  readonly url: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
}

export const createDatabase = ({
  url,
  lockTimeoutMs = 2_000,
  maxConnections = 10,
  statementTimeoutMs = 5_000,
}: DatabaseConfig) => {
  const isLocal =
    url.includes("localhost") || url.includes("127.0.0.1") || url.includes("::1");
  const client = postgres(url, {
    connect_timeout: 10,
    connection: {
      idle_in_transaction_session_timeout: 10_000,
      lock_timeout: lockTimeoutMs,
      statement_timeout: statementTimeoutMs,
    },
    max: maxConnections,
    onnotice: () => undefined,
    prepare: false,
    ssl: isLocal ? false : "require",
  });

  return Object.freeze({
    db: drizzle(client, { schema }),
    close: async (): Promise<void> => {
      await client.end({ timeout: 5 });
    },
  });
};

export type Database = ReturnType<typeof createDatabase>["db"];
