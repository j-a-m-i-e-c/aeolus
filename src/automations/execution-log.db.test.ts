// src/automations/execution-log.db.test.ts — DB-backed ExecutionLog tests for branch coverage

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ExecutionLog, type ExecutionLogEntry } from "./execution-log.js";

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_history (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      trigger_topic TEXT NOT NULL,
      success INTEGER NOT NULL,
      failure_reason TEXT,
      duration_ms INTEGER NOT NULL,
      actions TEXT NOT NULL DEFAULT '[]',
      timestamp INTEGER NOT NULL
    );
  `);
  return db;
}

function makeEntry(overrides: Partial<ExecutionLogEntry> = {}): ExecutionLogEntry {
  return {
    id: overrides.id ?? "entry-1",
    ruleId: overrides.ruleId ?? "rule-1",
    ruleName: overrides.ruleName ?? "Test Rule",
    ruleType: overrides.ruleType ?? "form",
    triggerTopic: overrides.triggerTopic ?? "sensor/temp",
    actions: overrides.actions ?? [{ type: "log", target: "", success: true }],
    duration: overrides.duration ?? 10,
    timestamp: overrides.timestamp ?? Date.now(),
    success: overrides.success,
    failureReason: overrides.failureReason,
  };
}

describe("ExecutionLog (DB-backed)", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("constructor — loadFromDb", () => {
    it("pre-populates the in-memory buffer from SQLite on construction", () => {
      // Seed the DB directly
      const stmt = db.prepare(`
        INSERT INTO execution_history (id, rule_id, rule_name, rule_type, trigger_topic, success, failure_reason, duration_ms, actions, timestamp)
        VALUES (@id, @ruleId, @ruleName, @ruleType, @triggerTopic, @success, @failureReason, @durationMs, @actions, @timestamp)
      `);
      stmt.run({ id: "pre-1", ruleId: "r1", ruleName: "Rule 1", ruleType: "form", triggerTopic: "t/1", success: 1, failureReason: null, durationMs: 5, actions: "[]", timestamp: 1000 });
      stmt.run({ id: "pre-2", ruleId: "r1", ruleName: "Rule 1", ruleType: "script", triggerTopic: "t/2", success: 0, failureReason: "timeout", durationMs: 100, actions: '[{"type":"cmd","target":"dev-1","success":false,"error":"timeout"}]', timestamp: 2000 });

      const log = new ExecutionLog(200, db);
      const entries = log.list();

      expect(entries).toHaveLength(2);
      // newest first
      expect(entries[0].id).toBe("pre-2");
      expect(entries[0].success).toBe(false);
      expect(entries[0].failureReason).toBe("timeout");
      expect(entries[0].ruleType).toBe("script");
      expect(entries[0].actions).toEqual([{ type: "cmd", target: "dev-1", success: false, error: "timeout" }]);

      expect(entries[1].id).toBe("pre-1");
      expect(entries[1].success).toBe(true);
      expect(entries[1].failureReason).toBeUndefined();
    });

    it("respects maxEntries when loading from DB", () => {
      const stmt = db.prepare(`
        INSERT INTO execution_history (id, rule_id, rule_name, rule_type, trigger_topic, success, failure_reason, duration_ms, actions, timestamp)
        VALUES (@id, @ruleId, @ruleName, @ruleType, @triggerTopic, @success, @failureReason, @durationMs, @actions, @timestamp)
      `);
      for (let i = 0; i < 10; i++) {
        stmt.run({ id: `e-${i}`, ruleId: "r1", ruleName: "R", ruleType: "form", triggerTopic: "t", success: 1, failureReason: null, durationMs: 1, actions: "[]", timestamp: i * 1000 });
      }

      // Only load 3
      const log = new ExecutionLog(3, db);
      expect(log.list()).toHaveLength(3);
      // Should have the 3 newest (timestamps 7000, 8000, 9000)
      expect(log.list()[0].id).toBe("e-9");
      expect(log.list()[2].id).toBe("e-7");
    });
  });

  describe("push — SQLite persistence", () => {
    it("persists entries to SQLite when a database is provided", () => {
      const log = new ExecutionLog(200, db);
      log.push(makeEntry({ id: "new-1", success: true, timestamp: 5000 }));

      const row = db.prepare("SELECT * FROM execution_history WHERE id = 'new-1'").get() as any;
      expect(row).toBeDefined();
      expect(row.rule_id).toBe("rule-1");
      expect(row.success).toBe(1);
      expect(row.failure_reason).toBeNull();
    });

    it("persists success=false and failureReason correctly", () => {
      const log = new ExecutionLog(200, db);
      log.push(makeEntry({ id: "fail-1", success: false, failureReason: "device offline" }));

      const row = db.prepare("SELECT * FROM execution_history WHERE id = 'fail-1'").get() as any;
      expect(row.success).toBe(0);
      expect(row.failure_reason).toBe("device offline");
    });

    it("persists success=undefined as 1 (truthy default)", () => {
      const log = new ExecutionLog(200, db);
      const entry = makeEntry({ id: "undef-success" });
      delete (entry as any).success; // explicitly undefined
      log.push(entry);

      const row = db.prepare("SELECT * FROM execution_history WHERE id = 'undef-success'").get() as any;
      expect(row.success).toBe(1);
    });

    it("serializes actions to JSON", () => {
      const log = new ExecutionLog(200, db);
      const actions = [
        { type: "command", target: "dev-1", success: true },
        { type: "command", target: "dev-2", success: false, error: "timeout" },
      ];
      log.push(makeEntry({ id: "with-actions", actions }));

      const row = db.prepare("SELECT * FROM execution_history WHERE id = 'with-actions'").get() as any;
      expect(JSON.parse(row.actions)).toEqual(actions);
    });
  });

  describe("query — SQLite path", () => {
    it("queries all entries from SQLite ordered by timestamp descending", () => {
      const log = new ExecutionLog(200, db);
      log.push(makeEntry({ id: "q-1", timestamp: 1000 }));
      log.push(makeEntry({ id: "q-2", timestamp: 2000 }));
      log.push(makeEntry({ id: "q-3", timestamp: 3000 }));

      const results = log.query();
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("q-3");
      expect(results[2].id).toBe("q-1");
    });

    it("filters by ruleId", () => {
      const log = new ExecutionLog(200, db);
      log.push(makeEntry({ id: "a", ruleId: "r1", timestamp: 1000 }));
      log.push(makeEntry({ id: "b", ruleId: "r2", timestamp: 2000 }));
      log.push(makeEntry({ id: "c", ruleId: "r1", timestamp: 3000 }));

      const results = log.query({ ruleId: "r1" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.ruleId === "r1")).toBe(true);
    });

    it("filters by since timestamp", () => {
      const log = new ExecutionLog(200, db);
      log.push(makeEntry({ id: "old", timestamp: 1000 }));
      log.push(makeEntry({ id: "mid", timestamp: 5000 }));
      log.push(makeEntry({ id: "new", timestamp: 9000 }));

      const results = log.query({ since: 4000 });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("new");
      expect(results[1].id).toBe("mid");
    });

    it("applies limit and offset", () => {
      const log = new ExecutionLog(200, db);
      for (let i = 0; i < 10; i++) {
        log.push(makeEntry({ id: `p-${i}`, timestamp: i * 1000 }));
      }

      const results = log.query({ limit: 3, offset: 2 });
      expect(results).toHaveLength(3);
      // Descending: p-9, p-8, p-7, p-6, ... offset 2 skips p-9 and p-8
      expect(results[0].id).toBe("p-7");
    });

    it("combines ruleId, since, limit, and offset filters", () => {
      const log = new ExecutionLog(200, db);
      for (let i = 0; i < 10; i++) {
        log.push(makeEntry({ id: `c-${i}`, ruleId: i % 2 === 0 ? "even" : "odd", timestamp: i * 1000 }));
      }

      const results = log.query({ ruleId: "even", since: 3000, limit: 2, offset: 0 });
      // even timestamps >= 3000: 4000 (c-4), 6000 (c-6), 8000 (c-8) → limit 2 → c-8, c-6
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("c-8");
      expect(results[1].id).toBe("c-6");
    });
  });

  describe("query — in-memory fallback", () => {
    it("filters by ruleId in-memory when no DB", () => {
      const log = new ExecutionLog(200); // no DB
      log.push(makeEntry({ id: "a", ruleId: "r1", timestamp: 1000 }));
      log.push(makeEntry({ id: "b", ruleId: "r2", timestamp: 2000 }));

      const results = log.query({ ruleId: "r1" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
    });

    it("filters by since in-memory when no DB", () => {
      const log = new ExecutionLog(200); // no DB
      log.push(makeEntry({ id: "old", timestamp: 1000 }));
      log.push(makeEntry({ id: "new", timestamp: 5000 }));

      const results = log.query({ since: 3000 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("new");
    });

    it("applies offset and limit in-memory", () => {
      const log = new ExecutionLog(200); // no DB
      for (let i = 0; i < 5; i++) {
        log.push(makeEntry({ id: `m-${i}`, timestamp: i * 1000 }));
      }

      const results = log.query({ limit: 2, offset: 1 });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("m-3");
      expect(results[1].id).toBe("m-2");
    });
  });

  describe("enforceRetention", () => {
    it("deletes rows older than the retention window", () => {
      const log = new ExecutionLog(200, db);
      const now = Date.now();
      log.push(makeEntry({ id: "old", timestamp: now - 90 * 24 * 60 * 60 * 1000 })); // 90 days ago
      log.push(makeEntry({ id: "recent", timestamp: now - 1000 })); // 1 second ago

      log.enforceRetention(30); // keep 30 days

      const rows = db.prepare("SELECT id FROM execution_history").all() as Array<{ id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("recent");
    });

    it("is a no-op when no database is provided", () => {
      const log = new ExecutionLog(200); // no DB
      expect(() => log.enforceRetention(30)).not.toThrow();
    });

    it("keeps all rows when none are older than the retention window", () => {
      const log = new ExecutionLog(200, db);
      const now = Date.now();
      log.push(makeEntry({ id: "a", timestamp: now - 1000 }));
      log.push(makeEntry({ id: "b", timestamp: now - 2000 }));

      log.enforceRetention(7);

      const rows = db.prepare("SELECT id FROM execution_history").all() as Array<{ id: string }>;
      expect(rows).toHaveLength(2);
    });
  });

  describe("loadFromDb — edge cases", () => {
    it("is a no-op when no database is provided", () => {
      const log = new ExecutionLog(200); // no DB
      expect(() => log.loadFromDb()).not.toThrow();
      expect(log.list()).toEqual([]);
    });
  });
});
