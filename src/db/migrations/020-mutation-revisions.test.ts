import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mutationRevisions } from "./020-mutation-revisions.js";

describe("migration 020 - mutation revisions", () => {
  it("adds automation revisions and creates the singleton layout revision", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE automation_rules (id TEXT PRIMARY KEY);`);
    db.prepare("INSERT INTO automation_rules (id) VALUES (?)").run("a1");

    mutationRevisions.up(db);

    const automation = db.prepare("SELECT revision FROM automation_rules WHERE id = ?").get("a1") as { revision: number };
    const layout = db.prepare("SELECT revision FROM layout_metadata WHERE singleton = 1").get() as { revision: number };
    expect(automation.revision).toBe(1);
    expect(layout.revision).toBe(1);
  });

  it("is safe on legacy databases without automation_rules and idempotent", () => {
    const db = new Database(":memory:");
    expect(() => mutationRevisions.up(db)).not.toThrow();
    expect(() => mutationRevisions.up(db)).not.toThrow();
    expect((db.prepare("SELECT revision FROM layout_metadata WHERE singleton = 1").get() as { revision: number }).revision).toBe(1);
  });
});
