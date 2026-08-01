// Feature: scoped-automation-authoring — migration 011 tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { automationAuthorizationScope } from "./011-automation-authorization-scope.js";

let db: DatabaseType;

/** A pre-011 schema: automation_rules without the scope columns, plus tabs. */
function legacySchema(database: DatabaseType): void {
  database.exec(`
    CREATE TABLE automation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_topic TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tabs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function columns(): Set<string> {
  return new Set(
    (db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  legacySchema(db);
});

afterEach(() => db.close());

describe("migration 011 — automation authorization scope", () => {
  it("adds both scope columns", () => {
    automationAuthorizationScope.up(db);
    const cols = columns();
    expect(cols.has("authored_unrestricted")).toBe(true);
    expect(cols.has("owner_tab_id")).toBe(true);
  });

  it("backfills every pre-existing automation as unrestricted", () => {
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1','A','t',1)").run();
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a2','B','t',1)").run();

    automationAuthorizationScope.up(db);

    const rows = db
      .prepare("SELECT id, authored_unrestricted, owner_tab_id FROM automation_rules ORDER BY id")
      .all() as Array<{ id: string; authored_unrestricted: number; owner_tab_id: string | null }>;
    expect(rows).toEqual([
      { id: "a1", authored_unrestricted: 1, owner_tab_id: null },
      { id: "a2", authored_unrestricted: 1, owner_tab_id: null },
    ]);
  });

  it("a new row inserted after migration defaults to scoped (0)", () => {
    automationAuthorizationScope.up(db);
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a3','C','t',1)").run();
    const row = db
      .prepare("SELECT authored_unrestricted FROM automation_rules WHERE id = 'a3'")
      .get() as { authored_unrestricted: number };
    expect(row.authored_unrestricted).toBe(0);
  });

  it("nulls owner_tab_id when the owning tab is deleted (fail-closed)", () => {
    automationAuthorizationScope.up(db);
    db.prepare("INSERT INTO tabs (id, name, created_at) VALUES ('t1','T1',1)").run();
    db.prepare(
      "INSERT INTO automation_rules (id, name, trigger_topic, authored_unrestricted, owner_tab_id, created_at) VALUES ('a1','A','t',0,'t1',1)",
    ).run();

    db.prepare("DELETE FROM tabs WHERE id = 't1'").run();

    const row = db
      .prepare("SELECT authored_unrestricted, owner_tab_id FROM automation_rules WHERE id = 'a1'")
      .get() as { authored_unrestricted: number; owner_tab_id: string | null };
    // Owner cleared, but the row stays scoped (never silently unrestricted).
    expect(row.owner_tab_id).toBeNull();
    expect(row.authored_unrestricted).toBe(0);
  });

  it("is a safe no-op when the columns already exist", () => {
    automationAuthorizationScope.up(db);
    expect(() => automationAuthorizationScope.up(db)).not.toThrow();
  });
});
