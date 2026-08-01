// src/auth/collection-ownership-store.ts — Which tabs surface which Data Store collections.
//
// The direct analogue of the automation ResourceOwnershipStore, keyed by
// collection name. Data Store live events are scoped to a collection's exposing
// tabs so a non-admin viewing the collection on one of their tabs receives its
// updates, while a collection no pane surfaces stays admin-only (fail-closed).

import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "../db/database.js";

export interface CollectionOwnershipStore {
  /** The set of tab ids that surface the given collection (empty when none). */
  getExposingTabs(collectionName: string): string[];

  /** The collection names surfaced by the given tab (empty when none). */
  getCollectionsForTab(tabId: string): string[];

  /**
   * Reconcile the whole layout in one transaction. For every tab in
   * `desiredByTab`, make its collection assignments equal the desired set; for
   * tabs that currently hold assignments but are absent from `desiredByTab`,
   * clear them. Idempotent — used by both the migration backfill and layout save.
   */
  reconcileAll(desiredByTab: Map<string, Set<string>>): void;
}

interface TabIdRow {
  tab_id: string;
}

/**
 * Create a CollectionOwnershipStore. By default it uses the shared better-sqlite3
 * database singleton (consistent with the other auth stores); an explicit `db`
 * may be injected for tests.
 */
export function createCollectionOwnershipStore(
  dbOverride?: DatabaseType,
): CollectionOwnershipStore {
  const resolveDb = (): DatabaseType => dbOverride ?? getDatabase();

  function getExposingTabs(collectionName: string): string[] {
    const db = resolveDb();
    const rows = db
      .prepare("SELECT tab_id FROM collection_tab_assignments WHERE collection_name = ?")
      .all(collectionName) as TabIdRow[];
    return rows.map((row) => row.tab_id);
  }

  function getCollectionsForTab(tabId: string): string[] {
    const db = resolveDb();
    const rows = db
      .prepare(
        "SELECT collection_name FROM collection_tab_assignments WHERE tab_id = ?",
      )
      .all(tabId) as { collection_name: string }[];
    return rows.map((row) => row.collection_name);
  }

  function reconcileTabInternal(tabId: string, desiredCollections: Set<string>): void {
    const db = resolveDb();
    const currentRows = db
      .prepare("SELECT collection_name FROM collection_tab_assignments WHERE tab_id = ?")
      .all(tabId) as { collection_name: string }[];
    const current = new Set(currentRows.map((r) => r.collection_name));

    const insert = db.prepare(
      "INSERT OR IGNORE INTO collection_tab_assignments (collection_name, tab_id) VALUES (?, ?)",
    );
    const remove = db.prepare(
      "DELETE FROM collection_tab_assignments WHERE collection_name = ? AND tab_id = ?",
    );

    // Insert missing (desired but not current).
    for (const collection of desiredCollections) {
      if (!current.has(collection)) {
        insert.run(collection, tabId);
      }
    }
    // Delete stale (current but not desired). Matches are left untouched.
    for (const collection of current) {
      if (!desiredCollections.has(collection)) {
        remove.run(collection, tabId);
      }
    }
  }

  function reconcileAll(desiredByTab: Map<string, Set<string>>): void {
    const db = resolveDb();
    db.transaction(() => {
      // Reconcile every tab that has a desired set.
      for (const [tabId, desired] of desiredByTab) {
        reconcileTabInternal(tabId, desired);
      }
      // Clear tabs that currently hold assignments but are absent from the
      // desired map (their desired set is implicitly empty).
      const tabsWithAssignments = db
        .prepare("SELECT DISTINCT tab_id FROM collection_tab_assignments")
        .all() as TabIdRow[];
      for (const { tab_id } of tabsWithAssignments) {
        if (!desiredByTab.has(tab_id)) {
          reconcileTabInternal(tab_id, new Set<string>());
        }
      }
    })();
  }

  return { getExposingTabs, getCollectionsForTab, reconcileAll };
}
