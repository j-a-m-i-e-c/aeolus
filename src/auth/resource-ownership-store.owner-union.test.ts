// Feature: scoped-automation-authoring — owner tab is unioned into exposing tabs
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import { createResourceOwnershipStore } from "./resource-ownership-store.js";

let db: DatabaseType;

function insTab(id: string): void {
  db.prepare("INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, 'i', 0, 0, ?)").run(id, id, Date.now());
}
function insRule(id: string, ownerTab: string | null): void {
  db.prepare(
    "INSERT INTO automation_rules (id, name, trigger_topic, owner_tab_id, created_at) VALUES (?, ?, 't', ?, ?)",
  ).run(id, id, ownerTab, Date.now());
}
function assign(automationId: string, tabId: string): void {
  db.prepare("INSERT INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)").run(automationId, tabId);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  ["t1", "t2", "t3"].forEach(insTab);
});

afterEach(() => db.close());

describe("ResourceOwnershipStore — owner tab union", () => {
  it("includes the owner tab in addition to pane-derived assignments", () => {
    insRule("a1", "t1");
    assign("a1", "t2");
    const store = createResourceOwnershipStore(db);
    expect(store.getExposingTabs("a1").sort()).toEqual(["t1", "t2"]);
  });

  it("does not duplicate when the owner tab also has a pane assignment", () => {
    insRule("a1", "t1");
    assign("a1", "t1");
    const store = createResourceOwnershipStore(db);
    expect(store.getExposingTabs("a1")).toEqual(["t1"]);
  });

  it("returns only pane-derived tabs when there is no owner", () => {
    insRule("a1", null);
    assign("a1", "t2");
    const store = createResourceOwnershipStore(db);
    expect(store.getExposingTabs("a1")).toEqual(["t2"]);
  });

  it("batch form unions the owner tab per automation", () => {
    insRule("a1", "t1");
    assign("a1", "t2");
    insRule("a2", null);
    assign("a2", "t3");
    const store = createResourceOwnershipStore(db);
    const batch = store.getExposingTabsBatch(["a1", "a2"]);
    expect(batch.get("a1")!.sort()).toEqual(["t1", "t2"]);
    expect(batch.get("a2")).toEqual(["t3"]);
  });

  // Feature: scoped-automation-authoring, Property 8: Exposing tabs include the owning tab
  it("exposing tabs = pane assignments ∪ owner tab (when set)", () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom("t1", "t2", "t3"), { nil: null }),
        fc.uniqueArray(fc.constantFrom("t1", "t2", "t3"), { maxLength: 3 }),
        (owner, assignedTabs) => {
          db.exec("DELETE FROM automation_tab_assignments");
          db.exec("DELETE FROM automation_rules");
          insRule("a1", owner);
          for (const t of assignedTabs) assign("a1", t);

          const store = createResourceOwnershipStore(db);
          const expected = new Set(assignedTabs);
          if (owner) expected.add(owner);
          expect(new Set(store.getExposingTabs("a1"))).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
