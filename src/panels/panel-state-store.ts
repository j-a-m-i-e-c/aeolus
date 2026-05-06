// src/panels/panel-state-store.ts — Per-panel key-value state store with SQLite persistence

import type { Database } from "sql.js";
import { persistDatabase } from "../db/database.js";
import logger from "../logger.js";

/**
 * Per-panel key-value store enabling persistent state for Custom Panel
 * components. Values are JSON-serialized for SQLite storage and kept in
 * an in-memory cache for fast reads.
 */
export class PanelStateStore {
  private cache = new Map<string, Map<string, unknown>>();

  constructor(private readonly db: Database) {}

  /** Load all state entries from SQLite into the in-memory cache. */
  loadFromDb(): void {
    this.cache.clear();
    const results = this.db.exec("SELECT panel_id, key, value FROM panel_state");
    if (results.length === 0) return;

    const { values } = results[0];
    for (const row of values) {
      const panelId = row[0] as string;
      const key = row[1] as string;
      const raw = row[2] as string;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        logger.warn({ panelId, key, raw }, "Malformed JSON in panel_state, skipping entry");
        continue;
      }

      if (!this.cache.has(panelId)) {
        this.cache.set(panelId, new Map());
      }
      this.cache.get(panelId)!.set(key, parsed);
    }
  }

  /** Get a single value for a panel, or undefined if not set. */
  get(panelId: string, key: string): unknown {
    return this.cache.get(panelId)?.get(key);
  }

  /** Get all key-value pairs for a panel as a plain object. */
  getAll(panelId: string): Record<string, unknown> {
    const panelMap = this.cache.get(panelId);
    if (!panelMap) return {};
    return Object.fromEntries(panelMap);
  }

  /** Set a value — JSON-serializes to SQLite and updates the in-memory cache. */
  set(panelId: string, key: string, value: unknown): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      logger.warn({ panelId, key, err }, "Cannot serialize state value, skipping set");
      return;
    }

    this.db.run(
      `INSERT INTO panel_state (panel_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(panel_id, key) DO UPDATE SET value = excluded.value`,
      [panelId, key, serialized],
    );
    persistDatabase();

    if (!this.cache.has(panelId)) {
      this.cache.set(panelId, new Map());
    }
    this.cache.get(panelId)!.set(key, value);
  }

  /** Delete a single key for a panel. */
  delete(panelId: string, key: string): void {
    this.db.run("DELETE FROM panel_state WHERE panel_id = ? AND key = ?", [panelId, key]);
    persistDatabase();

    const panelMap = this.cache.get(panelId);
    if (panelMap) {
      panelMap.delete(key);
      if (panelMap.size === 0) this.cache.delete(panelId);
    }
  }

  /** Delete all state entries for a panel (called on panel deletion). */
  deleteAll(panelId: string): void {
    this.db.run("DELETE FROM panel_state WHERE panel_id = ?", [panelId]);
    persistDatabase();
    this.cache.delete(panelId);
  }
}
