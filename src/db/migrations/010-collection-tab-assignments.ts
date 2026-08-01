// src/db/migrations/010-collection-tab-assignments.ts — Which tabs surface which Data Store collections

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";
import {
  extractCollectionAssignments,
  type PaneRef,
} from "../../auth/pane-reference-extractor.js";

/**
 * Creates the `collection_tab_assignments` table, the server-side mapping used
 * to scope Data Store live events to the tabs that surface a collection. It
 * records which tabs expose which collections, derived from each
 * `data-collection` pane's explicit `config.collection` reference — the direct
 * analogue of `automation_tab_assignments`.
 *
 * `collection_name` is a plain column, not a foreign key: Data Store collections
 * are managed by the DataStore module (outside the migration schema) and a pane
 * may legitimately reference a not-yet-created collection. `tab_id` cascades on
 * tab deletion. The one-time backfill derives assignments from the existing
 * pane layout using the same extractor as steady-state layout maintenance.
 */
export const collectionTabAssignments: Migration = {
  id: 10,
  name: "collection-tab-assignments",
  up(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS collection_tab_assignments (
        collection_name TEXT NOT NULL,
        tab_id          TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
        PRIMARY KEY (collection_name, tab_id)
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_collection_tab_assignments_collection
      ON collection_tab_assignments(collection_name);
    `);

    backfillCollectionAssignments(db);
  },
};

interface PaneRow {
  tab_id: string;
  pane_type: string;
  config: string;
}

/**
 * One-time backfill of `collection_tab_assignments` from the existing pane
 * layout, using the same extractor the steady-state layout-maintenance path
 * uses so backfill and maintenance always agree.
 */
function backfillCollectionAssignments(db: DatabaseType): void {
  // A legacy database adopted at baseline may lack the `panes` table. With no
  // panes there is nothing to backfill, so skip gracefully rather than error.
  if (!tableExists(db, "panes")) {
    return;
  }

  const rows = db
    .prepare("SELECT tab_id, pane_type, config FROM panes")
    .all() as PaneRow[];

  const paneRefs: PaneRef[] = rows.map((row) => ({
    tabId: row.tab_id,
    paneType: row.pane_type,
    config: parseConfig(row.config),
  }));

  const desiredByTab = extractCollectionAssignments(paneRefs);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO collection_tab_assignments (collection_name, tab_id) VALUES (?, ?)",
  );
  const write = db.transaction(() => {
    for (const [tabId, collections] of desiredByTab) {
      for (const collection of collections) {
        insert.run(collection, tabId);
      }
    }
  });
  write();
}

/** True when a table with the given name exists in the database. */
function tableExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

/** Parse a pane's stored JSON config, normalizing anything malformed to `{}`. */
function parseConfig(raw: string): Record<string, unknown> {
  if (!raw) return {};
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
