// src/db/migrations/020-mutation-revisions.ts
// Server-owned revisions for document-like configuration mutated by multiple clients.

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

export const mutationRevisions: Migration = {
  id: 20,
  name: "mutation-revisions",
  up(db: DatabaseType): void {
    if (tableExists(db, "automation_rules")) {
      const columns = columnsOf(db, "automation_rules");
      if (!columns.has("revision")) {
        db.exec("ALTER TABLE automation_rules ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS layout_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO layout_metadata (singleton, revision) VALUES (1, 1);
    `);
  },
};

function tableExists(db: DatabaseType, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columnsOf(db: DatabaseType, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
}
