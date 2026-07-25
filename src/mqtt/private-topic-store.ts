// src/mqtt/private-topic-store.ts — Admin-managed private MQTT topic filters

import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "../db/database.js";
import { matchesTopicFilter, isValidTopicFilter } from "./topic-filter.js";

/** A stored private topic filter. */
export interface PrivateTopic {
  id: string;
  pattern: string;
  createdAt: number;
}

/**
 * Manages the set of MQTT topic filters whose raw messages must not appear on
 * the public inspector feed. `isPrivate` is called on every raw MQTT message,
 * so the patterns are cached in memory and the cache is refreshed only when the
 * set changes.
 */
export interface PrivateTopicStore {
  /** True iff `topic` matches any stored private filter. */
  isPrivate(topic: string): boolean;
  /** All stored filters, newest first. */
  list(): PrivateTopic[];
  /**
   * Register a filter. The pattern is trimmed; a blank or malformed filter
   * (bad `+`/`#` placement) is rejected. Returns the existing row when the
   * pattern is already registered (idempotent) so a double-click does not error.
   */
  add(pattern: string): PrivateTopic;
  /** Remove a filter by id. Returns true when a row was deleted. */
  remove(id: string): boolean;
}

interface PrivateTopicRow {
  id: string;
  pattern: string;
  created_at: number;
}

const toPrivateTopic = (row: PrivateTopicRow): PrivateTopic => ({
  id: row.id,
  pattern: row.pattern,
  createdAt: row.created_at,
});

/**
 * Create a PrivateTopicStore backed by the shared better-sqlite3 singleton (an
 * explicit `db` may be injected for tests). Patterns are loaded into memory on
 * construction and after every mutation.
 */
export function createPrivateTopicStore(dbOverride?: DatabaseType): PrivateTopicStore {
  const resolveDb = (): DatabaseType => dbOverride ?? getDatabase();

  // In-memory cache of the current filters for cheap per-message checks.
  let patterns: string[] = [];

  function refresh(): void {
    const rows = resolveDb()
      .prepare("SELECT pattern FROM mqtt_private_topics")
      .all() as { pattern: string }[];
    patterns = rows.map((r) => r.pattern);
  }

  refresh();

  function isPrivate(topic: string): boolean {
    for (const pattern of patterns) {
      if (matchesTopicFilter(pattern, topic)) return true;
    }
    return false;
  }

  function list(): PrivateTopic[] {
    const rows = resolveDb()
      .prepare("SELECT id, pattern, created_at FROM mqtt_private_topics ORDER BY created_at DESC")
      .all() as PrivateTopicRow[];
    return rows.map(toPrivateTopic);
  }

  function add(pattern: string): PrivateTopic {
    const trimmed = pattern.trim();
    if (!trimmed) {
      throw new Error("Private topic pattern must not be empty");
    }
    if (!isValidTopicFilter(trimmed)) {
      throw new Error("Private topic pattern is not a valid MQTT topic filter");
    }
    const db = resolveDb();

    const existing = db
      .prepare("SELECT id, pattern, created_at FROM mqtt_private_topics WHERE pattern = ?")
      .get(trimmed) as PrivateTopicRow | undefined;
    if (existing) {
      return toPrivateTopic(existing);
    }

    const row: PrivateTopicRow = {
      id: randomUUID(),
      pattern: trimmed,
      created_at: Date.now(),
    };
    db.prepare(
      "INSERT INTO mqtt_private_topics (id, pattern, created_at) VALUES (?, ?, ?)",
    ).run(row.id, row.pattern, row.created_at);
    refresh();
    return toPrivateTopic(row);
  }

  function remove(id: string): boolean {
    const info = resolveDb()
      .prepare("DELETE FROM mqtt_private_topics WHERE id = ?")
      .run(id);
    if (info.changes > 0) {
      refresh();
      return true;
    }
    return false;
  }

  return { isPrivate, list, add, remove };
}
