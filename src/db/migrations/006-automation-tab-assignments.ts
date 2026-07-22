// src/db/migrations/006-automation-tab-assignments.ts — Server-side automation→tab ownership

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";
import {
  extractAutomationAssignments,
  type PaneRef,
} from "../../auth/pane-reference-extractor.js";

/**
 * Creates the `automation_tab_assignments` table, the single server-side
 * ownership mapping used by resource-level authorization. It records which tabs
 * expose which automations, derived from each pane's explicit `config.ruleId`
 * reference. Authorization decisions for automation routes are computed from
 * this table rather than from a caller-supplied tab identifier.
 *
 * Device exposure is intentionally NOT persisted: it is computed live by the
 * Device_Exposure_Resolver from the current panes and device inventory, so there
 * is no device assignment table, no device backfill, and no device maintenance.
 *
 * Table creation lives here; the one-time automation backfill from the existing
 * pane layout is added to this migration's `up` in a later task, reusing the
 * same extraction and reconciliation helpers as steady-state maintenance so both
 * derive identical results.
 */
export const automationTabAssignments: Migration = {
  id: 6,
  name: "automation-tab-assignments",
  up(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_tab_assignments (
        automation_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        tab_id        TEXT NOT NULL REFERENCES tabs(id)             ON DELETE CASCADE,
        PRIMARY KEY (automation_id, tab_id)
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_automation_tab_assignments_tab
      ON automation_tab_assignments(tab_id);
    `);

    backfillAutomationAssignments(db);
  },
};

interface PaneRow {
  tab_id: string;
  pane_type: string;
  config: string;
}

/**
 * One-time backfill of `automation_tab_assignments` from the existing pane
 * layout. Reads every pane, parses its config, and derives the desired
 * automation→tab set with the shared PaneReferenceExtractor — the same helper
 * the steady-state layout-maintenance path uses — so backfill and maintenance
 * always agree. References to automations that no longer exist are dropped by
 * passing the current automation id set to the extractor.
 *
 * Writes only automation assignments. No device table is created and no device
 * rows are written; device exposure is computed live. Uses `INSERT OR IGNORE`
 * so a re-run (e.g. against a legacy database) never creates duplicates.
 */
function backfillAutomationAssignments(db: DatabaseType): void {
  // A legacy database adopted at baseline may lack the `panes`/`automation_rules`
  // tables (baseline.up never ran). With no panes there is nothing to backfill,
  // so skip gracefully rather than error.
  if (!tableExists(db, "panes") || !tableExists(db, "automation_rules")) {
    return;
  }

  const automationIdRows = db
    .prepare("SELECT id FROM automation_rules")
    .all() as { id: string }[];
  const existingAutomationIds = new Set(automationIdRows.map((r) => r.id));

  const paneRows = db
    .prepare("SELECT tab_id, pane_type, config FROM panes")
    .all() as PaneRow[];

  const panes: PaneRef[] = paneRows.map((row) => ({
    tabId: row.tab_id,
    paneType: row.pane_type,
    config: parseConfig(row.config),
  }));

  const desiredByTab = extractAutomationAssignments(panes, existingAutomationIds);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
  );
  for (const [tabId, automationIds] of desiredByTab) {
    for (const automationId of automationIds) {
      insert.run(automationId, tabId);
    }
  }
}

/** True when a table with the given name exists in the database. */
function tableExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

/** Parse a pane's stored JSON config, normalizing anything malformed to `{}`. */
function parseConfig(raw: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
