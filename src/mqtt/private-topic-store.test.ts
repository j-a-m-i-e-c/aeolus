import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "../db/database.js";
import { createPrivateTopicStore, type PrivateTopicStore } from "./private-topic-store.js";

let db: InstanceType<typeof Database>;
let store: PrivateTopicStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = createPrivateTopicStore(db);
});

afterEach(() => {
  db.close();
});

describe("PrivateTopicStore", () => {
  it("starts empty and treats everything as public", () => {
    expect(store.list()).toEqual([]);
    expect(store.isPrivate("home/kitchen/light")).toBe(false);
  });

  it("adds a pattern and reports matching topics as private", () => {
    const added = store.add("home/locks/#");
    expect(added.pattern).toBe("home/locks/#");
    expect(added.id).toBeTruthy();

    expect(store.isPrivate("home/locks/front/code")).toBe(true);
    expect(store.isPrivate("home/kitchen/light")).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it("trims whitespace and rejects a blank pattern", () => {
    const added = store.add("  sensors/+/battery  ");
    expect(added.pattern).toBe("sensors/+/battery");
    expect(() => store.add("   ")).toThrow();
  });

  it("rejects a malformed MQTT topic filter", () => {
    expect(() => store.add("sport/#/x")).toThrow();
    expect(() => store.add("bad+level")).toThrow();
    expect(store.list()).toEqual([]);
  });

  it("is idempotent on duplicate patterns", () => {
    const first = store.add("presence/#");
    const second = store.add("presence/#");
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
  });

  it("removes a pattern and makes matching topics public again", () => {
    const added = store.add("home/locks/#");
    expect(store.isPrivate("home/locks/front")).toBe(true);

    expect(store.remove(added.id)).toBe(true);
    expect(store.isPrivate("home/locks/front")).toBe(false);
    expect(store.list()).toEqual([]);

    // Removing an unknown id is a no-op.
    expect(store.remove("does-not-exist")).toBe(false);
  });

  it("reflects patterns written to the database on a fresh store instance", () => {
    store.add("secret/#");
    const reopened = createPrivateTopicStore(db);
    expect(reopened.isPrivate("secret/value")).toBe(true);
  });
});
