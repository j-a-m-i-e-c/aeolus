// src/db/migrations/index.ts — Migration interface, registry, and duplicate-id guard

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * A single, uniquely-identified, ordered unit of schema or data change.
 *
 * Each migration has a numeric `id` that defines its ordering, a human-readable
 * `name` for logs and history, and a synchronous `up` operation that applies the
 * change. The optional `down` is reserved for a future version (R10.4) and is
 * never invoked in v1.
 */
export interface Migration {
  /** Unique, ascending identifier that defines ordering. Baseline is 1. */
  id: number;
  /** Human-readable name for logs and history, e.g. "baseline". */
  name: string;
  /** Forward operation. Synchronous to match better-sqlite3. Must be guarded/idempotent-safe. */
  up(db: DatabaseType): void;
  /** Reserved for a future version (R10.4). Never called in v1. */
  down?(db: DatabaseType): void;
}

/**
 * Validate that no two migrations share the same id.
 * Throws an Error naming the duplicated id when a conflict is found.
 * Called before any migration is applied (R2.5).
 */
export function assertUniqueIds(migrations: Migration[]): void {
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.id)) {
      throw new Error(`Duplicate migration id detected: ${m.id}`);
    }
    seen.add(m.id);
  }
}

// ─── Migration registry (ordered by ascending id) ────────────────────────────

import { baseline } from "./001-baseline.js";
import { automationRulesColumns } from "./002-automation-rules-columns.js";
import { devicesRemoveCheck } from "./003-devices-remove-check.js";
import { automationRulesCompletionTier } from "./004-automation-rules-completion-tier.js";

export const migrations: Migration[] = [
  baseline,                      // id 1
  automationRulesColumns,        // id 2
  devicesRemoveCheck,            // id 3
  automationRulesCompletionTier, // id 4
];
