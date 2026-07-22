// src/db/migrations/006-automation-tab-assignments.test.ts
// Unit tests for the automation_tab_assignments migration + backfill.
// Feature: resource-level-authorization

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { automationTabAssignments } from "./006-automation-tab-assignments.js";

const NOW = 1_000_000;

/** Build a DB with the parent tables (tabs, panes, automation_rules) but no assignment table. */
function baseDb(): DatabaseType {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE tabs (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, "order" INTEGER, pinned INTEGER, created_at INTEGER);
    CREATE TABLE automation_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_topic TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE panes (id TEXT PRIMARY KEY, tab_id TEXT NOT NULL, pane_type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', x INTEGER, y INTEGER, w INTEGER, h INTEGER, created_at INTEGER);
  `);
  return db;
}

function pairs(db: DatabaseType): string[] {
  return (db.prepare("SELECT automation_id, tab_id FROM automation_tab_assignments").all() as { automation_id: string; tab_id: string }[])
    .map((r) => `${r.automation_id}:${r.tab_id}`)
    .sort();
}

function tableExists(db: DatabaseType, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;
}

describe("migration 006 — automation_tab_assignments", () => {
  it("creates the table with a composite primary key and rejects duplicate pairs", () => {
    const db = baseDb();
    automationTabAssignments.up(db);
    expect(tableExists(db, "automation_tab_assignments")).toBe(true);

    db.prepare("INSERT INTO tabs (id, name) VALUES ('t1', 't1')").run();
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1','a1','x',?)").run(NOW);
    const insert = db.prepare("INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES ('a1','t1')");
    insert.run();
    insert.run(); // duplicate — ignored
    expect(pairs(db)).toEqual(["a1:t1"]);
    db.close();
  });

  it("backfills from automation panes, one row per distinct owning tab, skipping dangling refs", () => {
    const db = baseDb();
    db.prepare("INSERT INTO tabs (id, name) VALUES ('t1','t1')").run();
    db.prepare("INSERT INTO tabs (id, name) VALUES ('t2','t2')").run();
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1','a1','x',?)").run(NOW);

    const insertPane = db.prepare(
      "INSERT INTO panes (id, tab_id, pane_type, config, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertPane.run("p1", "t1", "automation", JSON.stringify({ ruleId: "a1" }), NOW);
    insertPane.run("p2", "t2", "automation", JSON.stringify({ ruleId: "a1" }), NOW); // same automation, other tab
    insertPane.run("p3", "t1", "automation", JSON.stringify({ ruleId: "ghost" }), NOW); // dangling → skipped
    insertPane.run("p4", "t1", "hue-control", "{}", NOW); // non-automation → ignored

    automationTabAssignments.up(db);
    expect(pairs(db)).toEqual(["a1:t1", "a1:t2"]);
    db.close();
  });

  it("is idempotent across re-runs and creates no device assignment table", () => {
    const db = baseDb();
    db.prepare("INSERT INTO tabs (id, name) VALUES ('t1','t1')").run();
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1','a1','x',?)").run(NOW);
    db.prepare("INSERT INTO panes (id, tab_id, pane_type, config, created_at) VALUES ('p1','t1','automation',?,?)")
      .run(JSON.stringify({ ruleId: "a1" }), NOW);

    automationTabAssignments.up(db);
    automationTabAssignments.up(db); // re-run
    expect(pairs(db)).toEqual(["a1:t1"]);
    expect(tableExists(db, "device_tab_assignments")).toBe(false);
    db.close();
  });
});
