// src/auth/collection-ownership-store.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { createCollectionOwnershipStore } from "./collection-ownership-store.js";

function createDb(): DatabaseType {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE collection_tab_assignments (
      collection_name TEXT NOT NULL,
      tab_id TEXT NOT NULL,
      PRIMARY KEY (collection_name, tab_id)
    );
  `);
  return db;
}

describe("CollectionOwnershipStore", () => {
  let db: DatabaseType;
  let store: ReturnType<typeof createCollectionOwnershipStore>;

  beforeEach(() => {
    db = createDb();
    store = createCollectionOwnershipStore(db);
  });

  afterEach(() => db.close());

  it("returns an empty set for a collection no tab surfaces", () => {
    expect(store.getExposingTabs("temps")).toEqual([]);
  });

  it("round-trips an assignment through reconcileAll", () => {
    store.reconcileAll(new Map([["tab-a", new Set(["temps"])]]));
    expect(store.getExposingTabs("temps")).toEqual(["tab-a"]);
  });

  it("returns every tab that surfaces a collection", () => {
    store.reconcileAll(
      new Map([
        ["tab-a", new Set(["temps"])],
        ["tab-b", new Set(["temps", "humidity"])],
      ]),
    );
    expect(store.getExposingTabs("temps").sort()).toEqual(["tab-a", "tab-b"]);
    expect(store.getExposingTabs("humidity")).toEqual(["tab-b"]);
  });

  it("reconcileAll inserts missing, deletes stale, and clears absent tabs", () => {
    store.reconcileAll(
      new Map([
        ["tab-a", new Set(["temps"])],
        ["tab-b", new Set(["humidity"])],
      ]),
    );

    // New desired state: tab-a re-pointed, tab-b absent (cleared), tab-c added.
    store.reconcileAll(
      new Map([
        ["tab-a", new Set(["pressure"])],
        ["tab-c", new Set(["temps"])],
      ]),
    );

    expect(store.getExposingTabs("temps")).toEqual(["tab-c"]);
    expect(store.getExposingTabs("pressure")).toEqual(["tab-a"]);
    expect(store.getExposingTabs("humidity")).toEqual([]); // tab-b cleared
  });

  it("is idempotent for an unchanged desired state", () => {
    const desired = new Map([["tab-a", new Set(["temps"])]]);
    store.reconcileAll(desired);
    store.reconcileAll(desired);
    expect(store.getExposingTabs("temps")).toEqual(["tab-a"]);
  });
});
