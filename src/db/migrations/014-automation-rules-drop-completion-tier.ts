// src/db/migrations/014-automation-rules-drop-completion-tier.ts — Drop completion_tier column

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Drops the `completion_tier` column from `automation_rules`.
 *
 * The column stored a per-automation acknowledgement level, which was removed as a
 * concept: one automation may command many devices with different acknowledgement
 * capabilities, so a single tier spanning the whole rule could only ever be an
 * aspiration that the command boundary clamped per device. A tier is now stated per
 * command in Logic (`devices.action(..., { tier })`), or omitted so each device
 * independently resolves to the strongest level it can actually prove.
 *
 * Migration 004, which added the column, is deliberately left in place: the registry
 * is an append-only ledger keyed by id, and already-applied history is never
 * rewritten. On a fresh database 004 adds the column and this migration removes it
 * again, which is harmless and keeps both databases converging on the same schema.
 *
 * Guarded by PRAGMA table_info so it is a safe no-op when the column is already
 * absent. The check also covers the case where `automation_rules` does not yet
 * exist, since PRAGMA returns no rows for an unknown table.
 *
 * `ALTER TABLE ... DROP COLUMN` requires SQLite 3.35+ (better-sqlite3 bundles a much
 * newer build) and is legal here because the column carries no index, constraint,
 * default expression or generated-column reference.
 */
export const automationRulesDropCompletionTier: Migration = {
  id: 14,
  name: "automation-rules-drop-completion-tier",
  up(db: DatabaseType): void {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>)
        .map((c) => c.name),
    );

    if (existing.has("completion_tier")) {
      db.exec("ALTER TABLE automation_rules DROP COLUMN completion_tier;");
    }
  },
};
