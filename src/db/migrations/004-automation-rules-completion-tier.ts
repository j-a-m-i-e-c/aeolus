// src/db/migrations/004-automation-rules-completion-tier.ts — Add completion_tier column

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the nullable completion_tier column to automation_rules.
 *
 * Guarded: checks PRAGMA table_info before the ALTER so it is a safe no-op when
 * the column already exists. The column has no NOT NULL / DEFAULT constraint (and
 * no CHECK), so pre-existing rows read as NULL without a rewrite (Req 1.5). The
 * value domain (dispatch|acknowledged|observed|null) is enforced by the
 * Authoring_Endpoint and by isConfirmationTier() at read time.
 */
export const automationRulesCompletionTier: Migration = {
  id: 4,
  name: "automation-rules-completion-tier",
  up(db: DatabaseType): void {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>)
        .map((c) => c.name),
    );

    if (!existing.has("completion_tier")) {
      db.exec("ALTER TABLE automation_rules ADD COLUMN completion_tier TEXT DEFAULT NULL;");
    }
  },
};
