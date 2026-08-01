// src/db/migration-runner.test.ts — Unit tests for the migration runner

import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  ensureMigrationHistory,
  getSchemaVersion,
  getExpectedVersion,
  isLegacyDatabase,
  isFreshDatabase,
  adoptLegacyDatabase,
  findNewerThanBinary,
  runMigrations,
} from "./migration-runner.js";
import { type Migration, migrations as realMigrations } from "./migrations/index.js";
import { MigrationError, DatabaseNewerThanBinaryError } from "./migration-errors.js";
import { initSchema } from "./database.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function freshDb(): DatabaseType {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

describe("ensureMigrationHistory", () => {
  it("creates schema_migrations table", () => {
    const db = freshDb();
    ensureMigrationHistory(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").all();
    expect(tables.length).toBe(1);
    db.close();
  });

  it("is idempotent — calling twice does not throw", () => {
    const db = freshDb();
    ensureMigrationHistory(db);
    expect(() => ensureMigrationHistory(db)).not.toThrow();
    db.close();
  });
});

describe("getSchemaVersion", () => {
  it("returns 0 for an empty history", () => {
    const db = freshDb();
    ensureMigrationHistory(db);
    expect(getSchemaVersion(db)).toBe(0);
    db.close();
  });

  it("returns max stamped id", () => {
    const db = freshDb();
    ensureMigrationHistory(db);
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(2, "m2", 1000);
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(5, "m5", 1000);
    expect(getSchemaVersion(db)).toBe(5);
    db.close();
  });
});

describe("getExpectedVersion", () => {
  it("returns 0 for empty registry", () => {
    expect(getExpectedVersion([])).toBe(0);
  });

  it("returns the max id in the registry", () => {
    const migs: Migration[] = [
      { id: 1, name: "a", up() {} },
      { id: 5, name: "b", up() {} },
      { id: 3, name: "c", up() {} },
    ];
    expect(getExpectedVersion(migs)).toBe(5);
  });
});

describe("isLegacyDatabase / isFreshDatabase", () => {
  it("fresh DB: isFresh=true, isLegacy=false", () => {
    const db = freshDb();
    expect(isFreshDatabase(db)).toBe(true);
    expect(isLegacyDatabase(db)).toBe(false);
    db.close();
  });

  it("legacy DB (app tables, no history): isFresh=false, isLegacy=true", () => {
    const db = freshDb();
    db.exec("CREATE TABLE automation_rules (id TEXT PRIMARY KEY, name TEXT, trigger_topic TEXT, created_at INTEGER);");
    expect(isFreshDatabase(db)).toBe(false);
    expect(isLegacyDatabase(db)).toBe(true);
    db.close();
  });
});

describe("adoptLegacyDatabase", () => {
  it("stamps baseline without re-running up", () => {
    const db = freshDb();
    db.exec("CREATE TABLE automation_rules (id TEXT PRIMARY KEY, name TEXT, trigger_topic TEXT, created_at INTEGER);");
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES (?, ?, ?, ?)").run("r1", "Rule", "t", 1000);

    const baseline: Migration = { id: 1, name: "baseline", up() { throw new Error("should not run"); } };
    adoptLegacyDatabase(db, baseline, () => 9999);

    expect(getSchemaVersion(db)).toBe(1);
    // Data preserved
    const row = db.prepare("SELECT name FROM automation_rules WHERE id = 'r1'").get() as { name: string };
    expect(row.name).toBe("Rule");
    db.close();
  });
});

describe("findNewerThanBinary", () => {
  it("returns null when no record exceeds expected", () => {
    const db = freshDb();
    ensureMigrationHistory(db);
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(3, "m3", 1000);
    expect(findNewerThanBinary(db, 5)).toBeNull();
    db.close();
  });

  it("returns the offending id when a record exceeds expected", () => {
    const db = freshDb();
    ensureMigrationHistory(db);
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(10, "m10", 1000);
    expect(findNewerThanBinary(db, 5)).toBe(10);
    db.close();
  });
});

describe("runMigrations", () => {
  it("migrates a fresh DB to Expected_Version", () => {
    const db = freshDb();
    const result = runMigrations(db, realMigrations, { skipCheckpoint: true });
    expect(result.toVersion).toBe(getExpectedVersion(realMigrations));
    expect(result.applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.adoptedLegacy).toBe(false);
    db.close();
  });

  it("adopts a legacy DB and applies remaining migrations", () => {
    const db = freshDb();
    initSchema(db);
    const result = runMigrations(db, realMigrations, { skipCheckpoint: true });
    expect(result.adoptedLegacy).toBe(true);
    expect(result.toVersion).toBe(getExpectedVersion(realMigrations));
    // Baseline was adopted (not applied), so only 002 onward applied
    expect(result.applied).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    db.close();
  });

  it("is a no-op when already at Expected_Version", () => {
    const db = freshDb();
    runMigrations(db, realMigrations, { skipCheckpoint: true });
    const result = runMigrations(db, realMigrations, { skipCheckpoint: true });
    expect(result.applied).toEqual([]);
    expect(result.fromVersion).toBe(result.toVersion);
    db.close();
  });

  it("MigrationError includes failing id and cause message", () => {
    const db = freshDb();
    const migs: Migration[] = [
      { id: 1, name: "ok", up(d) { d.exec("CREATE TABLE _ok (x INT);"); } },
      { id: 2, name: "fail", up() { throw new Error("boom"); } },
    ];
    try {
      runMigrations(db, migs, { skipCheckpoint: true });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationError);
      expect((err as MigrationError).migrationId).toBe(2);
      expect((err as MigrationError).message).toContain("boom");
    }
    db.close();
  });

  it("DatabaseNewerThanBinaryError includes both versions", () => {
    const db = freshDb();
    ensureMigrationHistory(db);
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(99, "future", 1000);
    try {
      runMigrations(db, realMigrations, { skipCheckpoint: true });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseNewerThanBinaryError);
      expect((err as DatabaseNewerThanBinaryError).databaseVersion).toBe(99);
      expect((err as DatabaseNewerThanBinaryError).expectedVersion).toBe(getExpectedVersion(realMigrations));
    }
    db.close();
  });

  it("down() is never invoked", () => {
    const db = freshDb();
    const downSpy = vi.fn();
    const migs: Migration[] = [
      { id: 1, name: "with-down", up(d) { d.exec("CREATE TABLE _wd (x INT);"); }, down: downSpy },
    ];
    runMigrations(db, migs, { skipCheckpoint: true });
    expect(downSpy).not.toHaveBeenCalled();
    db.close();
  });

  it("foreign_keys is ON after successful run with reconstruction", () => {
    const db = freshDb();
    runMigrations(db, realMigrations, { skipCheckpoint: true });
    const fk = db.pragma("foreign_keys") as Array<{ foreign_keys: number }>;
    expect(fk[0].foreign_keys).toBe(1);
    db.close();
  });

  it("devices CHECK removal preserves rows and allows novel types", () => {
    // Create a legacy DB with CHECK constraint
    const db = freshDb();
    db.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('light','sensor','switch','climate','plug')),
        capabilities TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT '{}',
        integration TEXT NOT NULL DEFAULT 'mqtt', last_seen INTEGER NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE automation_rules (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_topic TEXT NOT NULL,
        condition_type TEXT, condition_value TEXT, action_type TEXT DEFAULT 'log',
        action_target TEXT DEFAULT '', action_params TEXT DEFAULT '{}',
        enabled INTEGER DEFAULT 1, created_at INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("d1", "Sensor", "sensor", 1000);

    runMigrations(db, realMigrations, { skipCheckpoint: true });

    // Row preserved
    const row = db.prepare("SELECT name, type FROM devices WHERE id = 'd1'").get() as { name: string; type: string };
    expect(row.name).toBe("Sensor");
    expect(row.type).toBe("sensor");

    // Novel type now works
    expect(() => {
      db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("d2", "Custom", "robot_arm", Date.now());
    }).not.toThrow();

    db.close();
  });
});
