import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../migration-runner.js";
import { migrations } from "./index.js";
import { projectApiPublications } from "./021-project-api-publications.js";

const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'project_api%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);

describe("migration 021 - project API publications", () => {
  it("creates the publication, snapshot, retired-slug and audit tables", () => {
    const db = new Database(":memory:");
    runMigrations(db, migrations);
    expect(tables(db)).toEqual(["project_api_audit", "project_api_retired_slugs", "project_api_snapshots", "project_apis"]);
  });

  it("is idempotent and leaves existing automations untouched", () => {
    const db = new Database(":memory:");
    runMigrations(db, migrations);
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1', 'A', 't', 1)").run();
    expect(() => projectApiPublications.up(db)).not.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM automation_rules").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_apis").get()).toEqual({ n: 0 });
  });

  it("is registered as id 21, after mutation revisions", () => {
    expect(migrations.map((m) => m.id).slice(-2)).toEqual([20, 21]);
  });
});
