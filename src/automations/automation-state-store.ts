// src/automations/automation-state-store.ts — Per-rule key-value state store with SQLite persistence

import type { Database as DatabaseType } from "better-sqlite3";
import logger from "../logger.js";
import { safeJsonParse } from "../core/safe-json.js";

/**
 * Per-rule key-value store enabling bidirectional communication between
 * backend automation scripts and frontend custom UI components.
 *
 * Values are JSON-serialized for SQLite storage and kept in an in-memory
 * cache for fast reads from the sandbox.
 *
 * Writes are idempotent: `set()` reports whether the persisted representation
 * actually changed, and performs no SQLite write when it did not. A projection
 * that recomputes the same value on every device publish is the normal case in
 * authored Logic, so treating that as a write meant a busy site paid for a
 * SQLite round-trip and a WebSocket broadcast per tick to say nothing had
 * happened.
 */
export class AutomationStateStore {
  private cache = new Map<string, Map<string, unknown>>();
  /**
   * ruleId → (key → the exact JSON text last persisted).
   *
   * Kept alongside the parsed cache so change detection is a string compare
   * rather than a reparse/reserialize of the stored value on every call. It is
   * populated by `loadFromDb()` from the raw column text, which is precisely
   * what `JSON.stringify` produced when the value was written.
   */
  private serialized = new Map<string, Map<string, string>>();

  constructor(private readonly db: DatabaseType) {}

  /** Load all state entries from SQLite into the in-memory cache. */
  loadFromDb(): void {
    this.cache.clear();
    this.serialized.clear();
    const rows = this.db.prepare("SELECT rule_id, key, value FROM automation_state").all() as Array<{ rule_id: string; key: string; value: string }>;

    for (const row of rows) {
      const ruleId = row.rule_id;
      const key = row.key;

      const parsed = safeJsonParse(
        row.value,
        { ruleId, key },
        "Malformed JSON in automation_state, skipping entry",
      );
      if (parsed === undefined) continue;

      if (!this.cache.has(ruleId)) {
        this.cache.set(ruleId, new Map());
      }
      this.cache.get(ruleId)!.set(key, parsed);

      if (!this.serialized.has(ruleId)) {
        this.serialized.set(ruleId, new Map());
      }
      this.serialized.get(ruleId)!.set(key, row.value);
    }
  }

  /** Get a single value for a rule, or undefined if not set. */
  get(ruleId: string, key: string): unknown {
    return this.cache.get(ruleId)?.get(key);
  }

  /** Get all key-value pairs for a rule as a plain object. */
  getAll(ruleId: string): Record<string, unknown> {
    const ruleMap = this.cache.get(ruleId);
    if (!ruleMap) return {};
    return Object.fromEntries(ruleMap);
  }

  /**
   * Set a value — JSON-serializes to SQLite and updates the in-memory cache.
   *
   * @returns `true` when the persisted representation changed, `false` when the
   * value serialized identically to what is already stored (no SQLite write
   * performed) or could not be serialized at all. Callers use this to decide
   * whether to broadcast a state change; an unchanged write is not a change.
   *
   * Exact serialized-JSON equality is the test. Two objects with the same
   * entries in a different key order are treated as different, which is a
   * deliberate trade: it costs an occasional redundant write and avoids a
   * canonical-JSON dependency on a hot path.
   */
  set(ruleId: string, key: string, value: unknown): boolean {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      logger.warn({ ruleId, key, err }, "Cannot serialize state value, skipping set");
      return false;
    }

    // `JSON.stringify` answers undefined for values with no JSON
    // representation (a bare `undefined`, a function). Persisting the literal
    // text "undefined" would make the row unparseable on the next load, so it
    // is refused here rather than corrupting the cache.
    if (serialized === undefined) {
      logger.warn({ ruleId, key }, "State value has no JSON representation, skipping set");
      return false;
    }

    if (this.serialized.get(ruleId)?.get(key) === serialized) {
      return false;
    }

    this.db.prepare(
      `INSERT INTO automation_state (rule_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(rule_id, key) DO UPDATE SET value = excluded.value`
    ).run(ruleId, key, serialized);

    if (!this.cache.has(ruleId)) {
      this.cache.set(ruleId, new Map());
    }
    this.cache.get(ruleId)!.set(key, value);

    if (!this.serialized.has(ruleId)) {
      this.serialized.set(ruleId, new Map());
    }
    this.serialized.get(ruleId)!.set(key, serialized);

    return true;
  }

  /**
   * Delete a single key for a rule.
   *
   * @returns `true` when an entry was actually removed.
   */
  delete(ruleId: string, key: string): boolean {
    const result = this.db
      .prepare("DELETE FROM automation_state WHERE rule_id = ? AND key = ?")
      .run(ruleId, key);

    const ruleMap = this.cache.get(ruleId);
    if (ruleMap) {
      ruleMap.delete(key);
      if (ruleMap.size === 0) this.cache.delete(ruleId);
    }

    const serializedMap = this.serialized.get(ruleId);
    if (serializedMap) {
      serializedMap.delete(key);
      if (serializedMap.size === 0) this.serialized.delete(ruleId);
    }

    return result.changes > 0;
  }

  /** Delete all state entries for a rule (called on rule deletion). */
  deleteAll(ruleId: string): void {
    this.db.prepare("DELETE FROM automation_state WHERE rule_id = ?").run(ruleId);
    this.cache.delete(ruleId);
    this.serialized.delete(ruleId);
  }
}
