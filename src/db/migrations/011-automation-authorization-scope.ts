// src/db/migrations/011-automation-authorization-scope.ts — Per-automation authorization scope

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the authorization-scope columns to `automation_rules`:
 *
 *  - `authored_unrestricted` (INTEGER, NOT NULL, DEFAULT 0): 1 marks a
 *    system-wide automation (admin-authored, or any row that predates scoping);
 *    0 marks a scoped automation confined to its owning tab.
 *  - `owner_tab_id` (TEXT, nullable, REFERENCES tabs(id) ON DELETE SET NULL):
 *    the single tab a scoped automation is bound to. A scoped row whose owning
 *    tab is later deleted becomes NULL here, which the scope resolver treats as
 *    a fail-closed empty scope — never as unrestricted.
 *
 * Guarded with PRAGMA table_info so the ALTERs are safe no-ops if the columns
 * already exist. Backfill sets `authored_unrestricted = 1` for every existing
 * row so pre-upgrade automations keep the full authority they ran with before
 * scoping existed. New rows are written with explicit scope values by the
 * create route; the DEFAULT 0 (scoped) is the fail-closed fallback.
 */
export const automationAuthorizationScope: Migration = {
  id: 11,
  name: "automation-authorization-scope",
  up(db: DatabaseType): void {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>)
        .map((c) => c.name),
    );

    if (!existing.has("authored_unrestricted")) {
      db.exec(
        "ALTER TABLE automation_rules ADD COLUMN authored_unrestricted INTEGER NOT NULL DEFAULT 0;",
      );
      // Every row that exists at upgrade predates scoping and must keep its
      // prior system-wide authority.
      db.exec("UPDATE automation_rules SET authored_unrestricted = 1;");
    }

    if (!existing.has("owner_tab_id")) {
      // A column added via ALTER TABLE may carry a REFERENCES clause only when it
      // is nullable with a NULL default, which is exactly what we want here.
      db.exec(
        "ALTER TABLE automation_rules ADD COLUMN owner_tab_id TEXT REFERENCES tabs(id) ON DELETE SET NULL;",
      );
    }
  },
};
