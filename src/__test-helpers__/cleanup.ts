// src/__test-helpers__/cleanup.ts — Resource disposal for test teardown

import type { Database as DatabaseType } from "better-sqlite3";
import type { DataStore } from "../data-store/data-store.js";
import type { AutomationEngine } from "../automations/automation-engine.js";

export interface CleanupTargets {
  databases?: DatabaseType[];
  dataStores?: DataStore[];
  engines?: AutomationEngine[];
}

/**
 * Close all database connections and dispose resources.
 * Call in afterEach/afterAll hooks.
 *
 * Disposal order: DataStores first (stops retention timers),
 * then engines (stops cron timers), then databases (closes connections).
 */
export function cleanup(targets: CleanupTargets): void {
  for (const store of targets.dataStores ?? []) {
    store.dispose();
  }
  for (const engine of targets.engines ?? []) {
    engine.dispose();
  }
  for (const db of targets.databases ?? []) {
    db.close();
  }
}
