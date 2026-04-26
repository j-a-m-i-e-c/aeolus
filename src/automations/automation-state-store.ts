// src/automations/automation-state-store.ts — Per-rule key-value state store with SQLite persistence

import type { Database } from "sql.js";
import { persistDatabase } from "../db/database.js";
import logger from "../logger.js";

/**
 * Per-rule key-value store enabling bidirectional communication between
 * backend automation scripts and frontend custom UI components.
 *
 * Values are JSON-serialized for SQLite storage and kept in an in-memory
 * cache for fast reads from the sandbox.
 */
export class AutomationStateStore {
  private cache = new Map<string, Map<string, unknown>>();

  constructor(private readonly db: Database) {}

  /** Load all state entries from SQLite into the in-memory cache. */
  loadFromDb(): void {
    this.cache.clear();
    const results = this.db.exec("SELECT rule_id, key, value FROM automation_state");
    if (results.length === 0) return;

    const { values } = results[0];
    for (const row of values) {
      const ruleId = row[0] as string;
      const key = row[1] as string;
      const raw = row[2] as string;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        logger.warn({ ruleId, key, raw }, "Malformed JSON in automation_state, skipping entry");
        continue;
      }

      if (!this.cache.has(ruleId)) {
        this.cache.set(ruleId, new Map());
      }
      this.cache.get(ruleId)!.set(key, parsed);
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

  /** Set a value — JSON-serializes to SQLite and updates the in-memory cache. */
  set(ruleId: string, key: string, value: unknown): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      logger.warn({ ruleId, key, err }, "Cannot serialize state value, skipping set");
      return;
    }

    this.db.run(
      `INSERT INTO automation_state (rule_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(rule_id, key) DO UPDATE SET value = excluded.value`,
      [ruleId, key, serialized],
    );
    persistDatabase();

    if (!this.cache.has(ruleId)) {
      this.cache.set(ruleId, new Map());
    }
    this.cache.get(ruleId)!.set(key, value);
  }

  /** Delete a single key for a rule. */
  delete(ruleId: string, key: string): void {
    this.db.run("DELETE FROM automation_state WHERE rule_id = ? AND key = ?", [ruleId, key]);
    persistDatabase();

    const ruleMap = this.cache.get(ruleId);
    if (ruleMap) {
      ruleMap.delete(key);
      if (ruleMap.size === 0) this.cache.delete(ruleId);
    }
  }

  /** Delete all state entries for a rule (called on rule deletion). */
  deleteAll(ruleId: string): void {
    this.db.run("DELETE FROM automation_state WHERE rule_id = ?", [ruleId]);
    persistDatabase();
    this.cache.delete(ruleId);
  }
}
