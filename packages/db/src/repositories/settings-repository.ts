import type { SettingsRepository } from "@agent-memory-wiki/application";
import { eq } from "drizzle-orm";

import type { Database } from "../client";
import { systemSettings } from "../schema/index";

export class DrizzleSettingsRepository implements SettingsRepository {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async getReadOnly(): Promise<boolean | null> {
    const [row] = await this.#database
      .select({ readOnly: systemSettings.readOnly })
      .from(systemSettings)
      .where(eq(systemSettings.singleton, true))
      .limit(1);
    if (!row) {
      try {
        await this.#database
          .insert(systemSettings)
          .values({ singleton: true, readOnly: false })
          .onConflictDoNothing();
        return false;
      } catch {
        return null;
      }
    }
    return row.readOnly;
  }
}
