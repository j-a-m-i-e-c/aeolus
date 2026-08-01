// src/automations/automation-scope-resolver.ts — Per-automation runtime authorization scope

import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "../db/database.js";
import type { DeviceExposureResolver } from "../auth/device-exposure-resolver.js";
import type { CollectionOwnershipStore } from "../auth/collection-ownership-store.js";

/**
 * The set of resources an automation's runtime may act upon.
 *
 * `unrestricted` runs with system-wide authority (admin-authored, or pre-scoping
 * rows). `scoped` is confined to a single owning tab's exposed devices and
 * surfaced collections; it never publishes raw MQTT and never uses shared
 * key-value buckets. A scoped scope with `tabId === null` (owning tab deleted)
 * is fail-closed: empty device and collection sets — never unrestricted.
 */
export type AuthorizationScope =
  | { kind: "unrestricted" }
  | {
      kind: "scoped";
      tabId: string | null;
      deviceIds: ReadonlySet<string>;
      collections: ReadonlySet<string>;
    };

export interface AutomationScopeResolver {
  /**
   * Resolve the authorization scope for an automation rule id. An unknown rule
   * id and a scoped row with no owning tab both resolve to a fail-closed empty
   * scoped scope; only `authored_unrestricted = 1` yields `unrestricted`.
   */
  resolve(ruleId: string): AuthorizationScope;
}

interface ScopeRow {
  authored_unrestricted: number;
  owner_tab_id: string | null;
}

const EMPTY_SCOPED: AuthorizationScope = {
  kind: "scoped",
  tabId: null,
  deviceIds: new Set<string>(),
  collections: new Set<string>(),
};

/**
 * Create an AutomationScopeResolver backed by the automation row plus the live
 * device-exposure resolver and collection-ownership store. Reads current rows,
 * panes, and inventory on every call, so scope always reflects present reality.
 */
export function createAutomationScopeResolver(
  deviceExposureResolver: DeviceExposureResolver,
  collectionOwnershipStore: CollectionOwnershipStore,
  dbOverride?: DatabaseType,
): AutomationScopeResolver {
  function resolve(ruleId: string): AuthorizationScope {
    const db = dbOverride ?? getDatabase();
    const row = db
      .prepare(
        "SELECT authored_unrestricted, owner_tab_id FROM automation_rules WHERE id = ?",
      )
      .get(ruleId) as ScopeRow | undefined;

    // Unknown rule → fail-closed. A dispatch for an unregistered rule must never
    // be treated as unrestricted.
    if (!row) {
      return EMPTY_SCOPED;
    }

    if (row.authored_unrestricted === 1) {
      return { kind: "unrestricted" };
    }

    // Scoped. A null owning tab (e.g. the tab was deleted) is fail-closed.
    if (!row.owner_tab_id) {
      return EMPTY_SCOPED;
    }

    return {
      kind: "scoped",
      tabId: row.owner_tab_id,
      deviceIds: new Set(deviceExposureResolver.getExposedDeviceIds(row.owner_tab_id)),
      collections: new Set(collectionOwnershipStore.getCollectionsForTab(row.owner_tab_id)),
    };
  }

  return { resolve };
}
