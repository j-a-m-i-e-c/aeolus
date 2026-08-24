// src/db/migrations/015-automation-projects.ts — Multi-file Automation Project persistence

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

function tableExists(db: DatabaseType, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

/**
 * Automation Projects keep authored source files separate from the legacy
 * automation_rules projection. The projection remains the runtime/cache boundary:
 * compiled_js and compiled_ui are what the existing sandbox consumes, while these
 * tables preserve the user's module tree for editing and recompilation.
 */
export const automationProjects: Migration = {
  id: 15,
  name: "automation-projects",
  up(db) {
    if (!tableExists(db, "automation_rules")) return;

    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_projects (
        automation_id TEXT PRIMARY KEY REFERENCES automation_rules(id) ON DELETE CASCADE,
        logic_entry TEXT NOT NULL DEFAULT 'logic/index.ts',
        ui_entry TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_project_files (
        automation_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (automation_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_automation_project_files_automation
        ON automation_project_files(automation_id);
    `);
  },
};
