// src/demo/demo-rule-access.ts — Per-automation public-demo access metadata.
//
// Reads the nullable `demo_access` JSON column on automation_rules (migration
// 012) and exposes a small cached reader. This declares which state keys a
// public-demo visitor may write and which fire event names it may send for a
// given seeded automation. Absent metadata ⇒ undefined ⇒ only the generic
// size/shape limits apply (no per-key/per-event allowlist).

import type { Database as DatabaseType } from "better-sqlite3";
import logger from "../logger.js";

/** Per-rule public-demo allowlist. Both fields are optional. */
export interface DemoRuleAccess {
  /** State keys a public-demo session may write via aeolus.save(). */
  writableStateKeys?: string[];
  /** Fire event names a public-demo session may send via aeolus.fire(). */
  fireEvents?: string[];
}

/** Resolves the demo access metadata for a rule id, or undefined when none. */
export type DemoRuleAccessReader = (ruleId: string) => DemoRuleAccess | undefined;

/**
 * Build a cached reader over the automation_rules.demo_access column.
 *
 * The cache is keyed by rule id and holds the parsed value (or a null sentinel
 * for "no metadata") so repeated validator calls do not re-hit SQLite. Seeded
 * demo data is static within a run, so a simple unbounded cache is fine; the
 * demo resets nightly. Malformed JSON is treated as "no metadata" and logged.
 */
export function createDemoRuleAccessReader(db: DatabaseType): DemoRuleAccessReader {
  const cache = new Map<string, DemoRuleAccess | null>();
  const stmt = db.prepare("SELECT demo_access FROM automation_rules WHERE id = ?");

  return function getDemoRuleAccess(ruleId: string): DemoRuleAccess | undefined {
    const cached = cache.get(ruleId);
    if (cached !== undefined) return cached ?? undefined;

    const row = stmt.get(ruleId) as { demo_access: string | null } | undefined;
    let value: DemoRuleAccess | null = null;
    if (row?.demo_access) {
      try {
        const parsed = JSON.parse(row.demo_access) as DemoRuleAccess;
        value = {
          writableStateKeys: Array.isArray(parsed.writableStateKeys)
            ? parsed.writableStateKeys.filter((k) => typeof k === "string")
            : undefined,
          fireEvents: Array.isArray(parsed.fireEvents)
            ? parsed.fireEvents.filter((e) => typeof e === "string")
            : undefined,
        };
      } catch (err) {
        logger.warn({ ruleId, error: (err as Error).message }, "Malformed demo_access JSON — ignoring");
        value = null;
      }
    }

    cache.set(ruleId, value);
    return value ?? undefined;
  };
}
