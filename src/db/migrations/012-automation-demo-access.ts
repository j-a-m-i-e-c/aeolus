// src/db/migrations/012-automation-demo-access.ts — Add demo_access column

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the nullable demo_access column to automation_rules (public-demo-mode
 * spec). It holds a JSON object declaring which state keys are writable and
 * which fire event names are accepted for public-demo sessions, e.g.
 * `{"writableStateKeys":["master"],"fireEvents":["pause","reset"]}`.
 *
 * Guarded via PRAGMA table_info so it is a safe no-op when already present. No
 * NOT NULL / DEFAULT beyond NULL, so existing rows read as NULL (no per-rule
 * demo allowlist) without a table rewrite. The column is only consulted for
 * public-demo sessions, so normal installations are unaffected.
 */
export const automationDemoAccess: Migration = {
  id: 12,
  name: "automation-demo-access",
  up(db: DatabaseType): void {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );

    if (!existing.has("demo_access")) {
      db.exec("ALTER TABLE automation_rules ADD COLUMN demo_access TEXT DEFAULT NULL;");
    }
  },
};
