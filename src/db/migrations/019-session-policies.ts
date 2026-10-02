// src/db/migrations/019-session-policies.ts
// Administrator-defined per-user session duration and optional idle timeout.

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the per-user session policy columns and the refresh-token activity clock.
 *
 * Both target tables are guarded by `tableExists`, matching migrations 006, 010
 * and 015. A migration cannot assume its table is present: a database that
 * predates the migration runner is *adopted* — the baseline is stamped as
 * applied rather than executed — so a legacy install carrying only the tables
 * it happened to have created still runs every later migration. Without the
 * guard, `ALTER TABLE users` aborts the whole run on such a database and the
 * backend refuses to start. The columns are created by `initSchema` on any
 * database that does have these tables, so skipping is correct rather than
 * merely safe.
 *
 * Idempotent: every column add is guarded by PRAGMA table_info, so re-applying
 * after a partially completed attempt completes the remaining work.
 */
export const sessionPolicies: Migration = {
  id: 19,
  name: "user-session-policies",
  up(db: DatabaseType): void {
    if (tableExists(db, "users")) {
      const userColumns = columnsOf(db, "users");
      /** Absolute refresh-session lifetime in days: 1, 7 (default) or 30. */
      if (!userColumns.has("session_days")) {
        db.exec("ALTER TABLE users ADD COLUMN session_days INTEGER NOT NULL DEFAULT 7");
      }
      /** Idle logout in minutes; 0 (default) disables idle enforcement. */
      if (!userColumns.has("inactivity_minutes")) {
        db.exec("ALTER TABLE users ADD COLUMN inactivity_minutes INTEGER NOT NULL DEFAULT 0");
      }
    }

    if (tableExists(db, "refresh_tokens")) {
      const tokenColumns = columnsOf(db, "refresh_tokens");
      if (!tokenColumns.has("last_activity_at")) {
        db.exec("ALTER TABLE refresh_tokens ADD COLUMN last_activity_at INTEGER");
      }
      // Existing sessions predate activity tracking; start their idle clock now
      // rather than backdating it, which would log every active operator out on
      // upgrade. Nullable column, so NULL also falls back to created_at at read.
      db.prepare("UPDATE refresh_tokens SET last_activity_at = ? WHERE last_activity_at IS NULL")
        .run(Date.now());
    }
  },
};

function tableExists(db: DatabaseType, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function columnsOf(db: DatabaseType, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  );
}
