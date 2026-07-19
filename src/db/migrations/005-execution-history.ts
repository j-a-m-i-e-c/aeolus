// src/db/migrations/005-execution-history.ts — Persistent execution history table

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Creates the execution_history table for persisting automation execution logs
 * across restarts. The in-memory ring buffer remains the hot read path; this
 * table provides durability and historical queries beyond the buffer window.
 */
export const executionHistory: Migration = {
  id: 5,
  name: "execution-history",
  up(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS execution_history (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        trigger_topic TEXT NOT NULL,
        success INTEGER NOT NULL,
        failure_reason TEXT,
        duration_ms INTEGER NOT NULL,
        actions TEXT NOT NULL DEFAULT '[]',
        timestamp INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_execution_history_rule_ts
      ON execution_history(rule_id, timestamp DESC);
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_execution_history_ts
      ON execution_history(timestamp DESC);
    `);
  },
};
