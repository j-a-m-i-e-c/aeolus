import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { automationRulesDropCompletionTier } from "./014-automation-rules-drop-completion-tier.js";
import { automationRulesCompletionTier } from "./004-automation-rules-completion-tier.js";

let db: DatabaseType;

/** A pre-014 automation_rules table, including the completion_tier column. */
function legacySchema(database: DatabaseType): void {
  database.exec(`
    CREATE TABLE automation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_topic TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_target TEXT NOT NULL,
      action_params TEXT NOT NULL DEFAULT '{}',
      rule_type TEXT NOT NULL DEFAULT 'form',
      completion_tier TEXT DEFAULT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);
}

function ruleColumns(): Set<string> {
  return new Set(
    (db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
}

function insertRule(id: string): void {
  db.prepare(
    `INSERT INTO automation_rules (id, name, trigger_topic, action_type, action_target, created_at)
     VALUES (?, ?, 'a/b', 'toggle', 'light/x', 1)`,
  ).run(id, `rule ${id}`);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  legacySchema(db);
});

afterEach(() => db.close());

describe("migration 014 — drop automation_rules.completion_tier", () => {
  it("removes the completion_tier column", () => {
    expect(ruleColumns().has("completion_tier")).toBe(true);

    automationRulesDropCompletionTier.up(db);

    expect(ruleColumns().has("completion_tier")).toBe(false);
  });

  it("preserves every other column and all existing rows", () => {
    insertRule("r1");
    insertRule("r2");

    automationRulesDropCompletionTier.up(db);

    const columns = ruleColumns();
    for (const kept of [
      "id",
      "name",
      "trigger_topic",
      "action_type",
      "action_target",
      "action_params",
      "rule_type",
      "enabled",
      "created_at",
    ]) {
      expect(columns.has(kept)).toBe(true);
    }

    const rows = db
      .prepare("SELECT id, name, action_type FROM automation_rules ORDER BY id")
      .all() as Array<{ id: string; name: string; action_type: string }>;
    expect(rows).toEqual([
      { id: "r1", name: "rule r1", action_type: "toggle" },
      { id: "r2", name: "rule r2", action_type: "toggle" },
    ]);
  });

  it("is a no-op when the column is already absent (idempotent)", () => {
    automationRulesDropCompletionTier.up(db);
    expect(() => automationRulesDropCompletionTier.up(db)).not.toThrow();
    expect(ruleColumns().has("completion_tier")).toBe(false);
  });

  it("is a no-op when automation_rules does not exist", () => {
    const empty = new Database(":memory:");
    try {
      expect(() => automationRulesDropCompletionTier.up(empty)).not.toThrow();
    } finally {
      empty.close();
    }
  });

  it("undoes migration 004 so a fresh database converges on the same schema", () => {
    // A fresh database applies 004 (which adds the column) before 014 removes it.
    const fresh = new Database(":memory:");
    try {
      fresh.exec(`
        CREATE TABLE automation_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          trigger_topic TEXT NOT NULL,
          action_type TEXT NOT NULL,
          action_target TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      automationRulesCompletionTier.up(fresh);
      automationRulesDropCompletionTier.up(fresh);

      const columns = new Set(
        (fresh.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>).map(
          (c) => c.name,
        ),
      );
      expect(columns.has("completion_tier")).toBe(false);
    } finally {
      fresh.close();
    }
  });
});
