// src/db/migrations/002-automation-rules-columns.ts — Add script rule columns + backfill

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the script-rule columns to automation_rules and backfills rule_type.
 *
 * Guarded: checks PRAGMA table_info before each ALTER so it is a safe no-op
 * when columns already exist (e.g. on a legacy database where initSchema
 * already added them). The backfill UPDATE is naturally idempotent.
 */
export const automationRulesColumns: Migration = {
  id: 2,
  name: "automation-rules-columns",
  up(db: DatabaseType): void {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>)
        .map((c) => c.name),
    );

    const add = (col: string, def: string) => {
      if (!existing.has(col)) {
        db.exec(`ALTER TABLE automation_rules ADD COLUMN ${col} ${def};`);
      }
    };

    add("rule_type", "TEXT NOT NULL DEFAULT 'form'");
    add("script_source", "TEXT DEFAULT NULL");
    add("compiled_js", "TEXT DEFAULT NULL");
    add("structured_metadata", "TEXT DEFAULT NULL");
    add("ui_source", "TEXT DEFAULT NULL");
    add("compiled_ui", "TEXT DEFAULT NULL");
    add("trigger_type", "TEXT DEFAULT 'mqtt'");
    add("cron_expression", "TEXT DEFAULT NULL");

    // Backfill: ensure all rows have a rule_type (idempotent — no-op when already set)
    db.exec("UPDATE automation_rules SET rule_type = 'form' WHERE rule_type IS NULL;");
  },
};
