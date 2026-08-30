// src/db/migrations/016-promote-legacy-automation-projects.ts
// Backfill existing script automations into the Automation Project source model.

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

function tableExists(db: DatabaseType, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

interface LegacyScriptRow {
  id: string;
  script_source: string;
  ui_source: string | null;
  created_at: number;
}

/**
 * Migration 015 introduced project persistence without changing existing rows.
 * That preserved runtime compatibility, but it also meant upgraded installations
 * kept receiving the legacy two-blob editor while freshly-seeded demos used the
 * Project editor. Promote every existing script rule to a one- or two-file
 * project so the authoring experience is the same on real installations and the
 * public demo. The legacy columns remain the runtime projection and are not
 * deleted or rewritten here.
 */
export const promoteLegacyAutomationProjects: Migration = {
  id: 16,
  name: "promote-legacy-automation-projects",
  up(db) {
    if (
      !tableExists(db, "automation_rules") ||
      !tableExists(db, "automation_projects") ||
      !tableExists(db, "automation_project_files")
    ) return;

    const legacyRows = db.prepare(`
      SELECT r.id, r.script_source, r.ui_source, r.created_at
      FROM automation_rules r
      LEFT JOIN automation_projects p ON p.automation_id = r.id
      WHERE r.rule_type = 'script'
        AND r.script_source IS NOT NULL
        AND p.automation_id IS NULL
    `).all() as LegacyScriptRow[];

    if (legacyRows.length === 0) return;

    const insertProject = db.prepare(`
      INSERT INTO automation_projects
        (automation_id, logic_entry, ui_entry, created_at, updated_at)
      VALUES (?, 'logic/index.ts', ?, ?, ?)
    `);
    const insertFile = db.prepare(`
      INSERT INTO automation_project_files
        (automation_id, path, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    for (const row of legacyRows) {
      const createdAt = row.created_at ?? now;
      const uiEntry = row.ui_source != null ? "ui/index.tsx" : null;
      insertProject.run(row.id, uiEntry, createdAt, now);
      insertFile.run(row.id, "logic/index.ts", row.script_source, createdAt, now);
      if (row.ui_source != null) {
        insertFile.run(row.id, "ui/index.tsx", row.ui_source, createdAt, now);
      }
    }
  },
};
