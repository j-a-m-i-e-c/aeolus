/**
 * Execution History — in-memory ring buffer backed by optional SQLite persistence.
 *
 * Records every automation execution for debugging. Capped at a configurable
 * number of entries (default 200) in-memory. When a database is provided,
 * entries are written through to SQLite for durability across restarts and the
 * buffer is pre-populated from the most recent rows on construction.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import type { CommandLifecycleState } from "../core/types.js";
import type { SandboxFailureReason } from "./sandbox.js";

export interface ExecutionLogEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: "form" | "script";
  triggerTopic: string;
  actions: Array<{
    type: string;
    target: string;
    success: boolean;
    error?: string;
    /** Categorized script-failure cause (script rules only). Additive — optional. */
    reason?: SandboxFailureReason;
    /** Final command lifecycle state (device commands). Additive — optional. */
    lifecycleState?: CommandLifecycleState;
  }>;
  duration: number; // ms
  timestamp: number;
  /**
   * Execution-level outcome recorded by the Execution_Owner
   * (unified-command-boundary Req 5.5, 8.1). Additive — optional so existing
   * writers/readers are unaffected.
   */
  success?: boolean;
  /**
   * Execution-level failure description; present iff `success === false`
   * (unified-command-boundary Req 5.6). Additive — optional.
   */
  failureReason?: string;
}

export interface ExecutionLogQueryOptions {
  ruleId?: string;
  limit?: number;
  offset?: number;
  /** Only return entries newer than this epoch-ms timestamp. */
  since?: number;
}

export class ExecutionLog {
  private entries: ExecutionLogEntry[] = [];
  private readonly maxEntries: number;
  private readonly db?: DatabaseType;

  private insertStmt?: ReturnType<DatabaseType["prepare"]>;

  constructor(maxEntries = 200, db?: DatabaseType) {
    this.maxEntries = maxEntries;
    this.db = db;

    if (this.db) {
      this.insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO execution_history
          (id, rule_id, rule_name, rule_type, trigger_topic, success, failure_reason, duration_ms, actions, timestamp)
        VALUES
          (@id, @ruleId, @ruleName, @ruleType, @triggerTopic, @success, @failureReason, @durationMs, @actions, @timestamp)
      `);
      this.loadFromDb();
    }
  }

  /** Append an entry, evicting the oldest if the buffer is full. Also persists to SQLite when available. */
  push(entry: ExecutionLogEntry): void {
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }
    this.entries.push(entry);

    if (this.insertStmt) {
      this.insertStmt.run({
        id: entry.id,
        ruleId: entry.ruleId,
        ruleName: entry.ruleName,
        ruleType: entry.ruleType,
        triggerTopic: entry.triggerTopic,
        success: entry.success === undefined ? 1 : entry.success ? 1 : 0,
        failureReason: entry.failureReason ?? null,
        durationMs: entry.duration,
        actions: JSON.stringify(entry.actions),
        timestamp: entry.timestamp,
      });
    }
  }

  /** Return the most recent entries (newest first) from the in-memory buffer. */
  list(limit?: number): ExecutionLogEntry[] {
    const reversed = [...this.entries].reverse();
    if (limit !== undefined && limit >= 0) {
      return reversed.slice(0, limit);
    }
    return reversed;
  }

  /** Return all entries for a given rule ID (newest first) from the in-memory buffer. */
  getByRuleId(ruleId: string): ExecutionLogEntry[] {
    return [...this.entries].filter((e) => e.ruleId === ruleId).reverse();
  }

  /**
   * Query historical entries from SQLite with optional filtering.
   * Falls back to in-memory buffer if no database is available.
   */
  query(options: ExecutionLogQueryOptions = {}): ExecutionLogEntry[] {
    if (!this.db) {
      // Fallback: filter in-memory entries
      let results = [...this.entries].reverse();
      if (options.ruleId) {
        results = results.filter((e) => e.ruleId === options.ruleId);
      }
      if (options.since !== undefined) {
        results = results.filter((e) => e.timestamp >= options.since!);
      }
      const offset = options.offset ?? 0;
      const limit = options.limit ?? results.length;
      return results.slice(offset, offset + limit);
    }

    let sql = "SELECT * FROM execution_history WHERE 1=1";
    const params: Record<string, unknown> = {};

    if (options.ruleId) {
      sql += " AND rule_id = @ruleId";
      params.ruleId = options.ruleId;
    }
    if (options.since !== undefined) {
      sql += " AND timestamp >= @since";
      params.since = options.since;
    }

    sql += " ORDER BY timestamp DESC";

    if (options.limit !== undefined) {
      sql += " LIMIT @limit";
      params.limit = options.limit;
    }
    if (options.offset !== undefined) {
      sql += " OFFSET @offset";
      params.offset = options.offset;
    }

    const rows = this.db.prepare(sql).all(params) as Array<{
      id: string;
      rule_id: string;
      rule_name: string;
      rule_type: string;
      trigger_topic: string;
      success: number;
      failure_reason: string | null;
      duration_ms: number;
      actions: string;
      timestamp: number;
    }>;

    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Pre-populate the in-memory ring buffer with the most recent entries from SQLite.
   * Called at construction when a database is provided.
   */
  loadFromDb(): void {
    if (!this.db) return;

    const rows = this.db
      .prepare(
        `SELECT * FROM execution_history ORDER BY timestamp DESC LIMIT @limit`,
      )
      .all({ limit: this.maxEntries }) as Array<{
      id: string;
      rule_id: string;
      rule_name: string;
      rule_type: string;
      trigger_topic: string;
      success: number;
      failure_reason: string | null;
      duration_ms: number;
      actions: string;
      timestamp: number;
    }>;

    // Rows come newest-first; reverse to fill buffer in chronological order
    this.entries = rows.reverse().map((row) => this.rowToEntry(row));
  }

  /**
   * Delete rows older than `maxAgeDays` from the SQLite table.
   * No-op if no database is available.
   */
  enforceRetention(maxAgeDays: number): void {
    if (!this.db) return;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM execution_history WHERE timestamp < @cutoff").run({ cutoff });
  }

  /** Convert a raw database row to an ExecutionLogEntry. */
  private rowToEntry(row: {
    id: string;
    rule_id: string;
    rule_name: string;
    rule_type: string;
    trigger_topic: string;
    success: number;
    failure_reason: string | null;
    duration_ms: number;
    actions: string;
    timestamp: number;
  }): ExecutionLogEntry {
    return {
      id: row.id,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      ruleType: row.rule_type as "form" | "script",
      triggerTopic: row.trigger_topic,
      actions: JSON.parse(row.actions),
      duration: row.duration_ms,
      timestamp: row.timestamp,
      success: row.success === 1,
      failureReason: row.failure_reason ?? undefined,
    };
  }
}
