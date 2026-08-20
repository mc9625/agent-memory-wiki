import type {
  RateLimitBucket,
  RateLimitRepository,
} from "@agent-memory-wiki/application";
import { lte, sql } from "drizzle-orm";

import type { Database } from "../client";
import { rateLimitBuckets } from "../schema/index";

const digestBytes = (digest: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("Invalid subject digest");
  return new Uint8Array(Buffer.from(digest, "hex"));
};

export class DrizzleRateLimitRepository implements RateLimitRepository {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async consume(bucket: RateLimitBucket): Promise<number> {
    const [row] = await this.#database
      .insert(rateLimitBuckets)
      .values({
        expiresAt: bucket.expiresAt,
        requestCount: 1,
        subjectDigest: digestBytes(bucket.subjectDigest),
        subjectType: bucket.subjectType,
        windowSeconds: bucket.windowSeconds,
        windowStartedAt: bucket.windowStartedAt,
      })
      .onConflictDoUpdate({
        target: [
          rateLimitBuckets.subjectType,
          rateLimitBuckets.subjectDigest,
          rateLimitBuckets.windowSeconds,
          rateLimitBuckets.windowStartedAt,
        ],
        set: {
          expiresAt: sql`greatest(${rateLimitBuckets.expiresAt}, excluded.expires_at)`,
          requestCount: sql`${rateLimitBuckets.requestCount} + 1`,
        },
      })
      .returning({ requestCount: rateLimitBuckets.requestCount });
    if (!row) throw new Error("Rate-limit counter update returned no row");
    return row.requestCount;
  }

  public async deleteExpired(at: Date): Promise<number> {
    const deleted = await this.#database
      .delete(rateLimitBuckets)
      .where(lte(rateLimitBuckets.expiresAt, at))
      .returning({ subjectType: rateLimitBuckets.subjectType });
    return deleted.length;
  }
}
