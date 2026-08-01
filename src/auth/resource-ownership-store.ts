// src/auth/resource-ownership-store.ts — Server-side automation→tab ownership persistence

import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "../db/database.js";

/**
 * Persists and reads the `automation_tab_assignments` table, the single
 * server-side ownership mapping used by resource-level authorization. It records
 * which tabs expose which automations and reconciles that mapping to match a
 * desired set derived from the dashboard layout.
 *
 * Scope is automations only. Device exposure is never persisted; it is computed
 * live by the Device_Exposure_Resolver. There is deliberately no device code
 * path here and no `ResourceKind` parameter.
 */
export interface ResourceOwnershipStore {
  /** The set of tab ids that expose the given automation. */
  getExposingTabs(automationId: string): string[];

  /**
   * Batch form for automation read filtering. Returns a map
   * automationId → exposing tab ids for every id in `automationIds` (empty array
   * when the automation has no exposing tabs).
   */
  getExposingTabsBatch(automationIds: string[]): Map<string, string[]>;

  /**
   * State-based reconciliation for a single tab's automation assignments. Makes
   * the stored assignments for `tabId` exactly equal `desiredAutomationIds`:
   * inserts missing pairs, deletes pairs no longer desired, and leaves
   * already-correct pairs untouched. Idempotent.
   */
  reconcileTab(tabId: string, desiredAutomationIds: Set<string>): void;

  /**
   * Reconcile the whole layout in one transaction. For every tab in
   * `desiredByTab`, make its automation assignments equal the desired set; for
   * tabs that currently have assignments but are absent from `desiredByTab`,
   * clear their assignments. Used by both backfill and layout maintenance.
   */
  reconcileAll(desiredByTab: Map<string, Set<string>>): void;
}

interface TabIdRow {
  tab_id: string;
}

interface AssignmentRow {
  automation_id: string;
  tab_id: string;
}

/**
 * Create a ResourceOwnershipStore. By default it uses the shared better-sqlite3
 * database singleton (consistent with `permission-service.ts`); an explicit `db`
 * may be injected for tests.
 */
export function createResourceOwnershipStore(
  dbOverride?: DatabaseType,
): ResourceOwnershipStore {
  const resolveDb = (): DatabaseType => dbOverride ?? getDatabase();

  function getExposingTabs(automationId: string): string[] {
    const db = resolveDb();
    const rows = db
      .prepare("SELECT tab_id FROM automation_tab_assignments WHERE automation_id = ?")
      .all(automationId) as TabIdRow[];
    const tabs = new Set(rows.map((row) => row.tab_id));

    // The owning tab of a scoped automation always exposes it, in addition to
    // any panes that reference it. This lets a non-admin author reach their own
    // automation without editing the (admin-only) layout, and it survives layout
    // saves because it derives from the automation's own owner_tab_id column.
    const ownerTab = getOwnerTab(db, automationId);
    if (ownerTab) {
      tabs.add(ownerTab);
    }
    return Array.from(tabs);
  }

  function getExposingTabsBatch(automationIds: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const id of automationIds) {
      result.set(id, []);
    }
    if (automationIds.length === 0) {
      return result;
    }

    const db = resolveDb();
    const placeholders = automationIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT automation_id, tab_id FROM automation_tab_assignments WHERE automation_id IN (${placeholders})`,
      )
      .all(...automationIds) as AssignmentRow[];

    // Track membership per automation so the owner-tab union stays duplicate-free.
    const sets = new Map<string, Set<string>>();
    for (const id of automationIds) {
      sets.set(id, new Set<string>());
    }
    for (const row of rows) {
      sets.get(row.automation_id)?.add(row.tab_id);
    }

    // Union each automation's owning tab (when set), matching getExposingTabs.
    const ownerPlaceholders = automationIds.map(() => "?").join(", ");
    const ownerRows = db
      .prepare(
        `SELECT id, owner_tab_id FROM automation_rules WHERE id IN (${ownerPlaceholders})`,
      )
      .all(...automationIds) as { id: string; owner_tab_id: string | null }[];
    for (const { id, owner_tab_id } of ownerRows) {
      if (owner_tab_id) {
        sets.get(id)?.add(owner_tab_id);
      }
    }

    for (const [id, tabs] of sets) {
      result.set(id, Array.from(tabs));
    }
    return result;
  }

  /** The owning tab id of an automation, or null when it has none. */
  function getOwnerTab(db: DatabaseType, automationId: string): string | null {
    const row = db
      .prepare("SELECT owner_tab_id FROM automation_rules WHERE id = ?")
      .get(automationId) as { owner_tab_id: string | null } | undefined;
    return row?.owner_tab_id ?? null;
  }

  function reconcileTabInternal(tabId: string, desiredAutomationIds: Set<string>): void {
    const db = resolveDb();
    const currentRows = db
      .prepare("SELECT automation_id FROM automation_tab_assignments WHERE tab_id = ?")
      .all(tabId) as { automation_id: string }[];
    const current = new Set(currentRows.map((r) => r.automation_id));

    const insert = db.prepare(
      "INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
    );
    const remove = db.prepare(
      "DELETE FROM automation_tab_assignments WHERE automation_id = ? AND tab_id = ?",
    );

    // Insert missing (desired but not current).
    for (const automationId of desiredAutomationIds) {
      if (!current.has(automationId)) {
        insert.run(automationId, tabId);
      }
    }
    // Delete stale (current but not desired). Matches are left untouched.
    for (const automationId of current) {
      if (!desiredAutomationIds.has(automationId)) {
        remove.run(automationId, tabId);
      }
    }
  }

  function reconcileTab(tabId: string, desiredAutomationIds: Set<string>): void {
    const db = resolveDb();
    db.transaction(() => reconcileTabInternal(tabId, desiredAutomationIds))();
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
        .prepare("SELECT DISTINCT tab_id FROM automation_tab_assignments")
        .all() as TabIdRow[];
      for (const { tab_id } of tabsWithAssignments) {
        if (!desiredByTab.has(tab_id)) {
          reconcileTabInternal(tab_id, new Set<string>());
        }
      }
    })();
  }

  return {
    getExposingTabs,
    getExposingTabsBatch,
    reconcileTab,
    reconcileAll,
  };
}
