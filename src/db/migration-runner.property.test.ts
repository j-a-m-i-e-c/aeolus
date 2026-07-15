// src/db/migration-runner.property.test.ts
// Feature: versioned-db-migrations — Properties 1–13

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  ensureMigrationHistory,
  getSchemaVersion,
  getExpectedVersion,
  getPendingMigrations,
  isLegacyDatabase,
  isFreshDatabase,
  runMigrations,
} from "./migration-runner.js";
import { assertUniqueIds, type Migration, migrations as realMigrations } from "./migrations/index.js";
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

/** Create a simple migration that just creates a table */
function makeMigration(id: number, name?: string): Migration {
  return {
    id,
    name: name ?? `migration-${id}`,
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS _m${id} (x INTEGER);`);
    },
  };
}

// ─── Property 1: Migration history records each applied migration exactly once with a timestamp ─

// Feature: versioned-db-migrations, Property 1: Migration history records each applied migration exactly once with a timestamp
describe("Property 1: Migration history records each applied migration exactly once with a timestamp", () => {
  it("after runMigrations, each applied id has exactly one row with a non-null applied_at", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (count) => {
          const db = freshDb();
          const migs = Array.from({ length: count }, (_, i) => makeMigration(i + 1));
          const result = runMigrations(db, migs, { skipCheckpoint: true, now: () => 1000 });

          const rows = db.prepare("SELECT id, applied_at FROM schema_migrations").all() as Array<{ id: number; applied_at: number }>;
          expect(rows.length).toBe(count);
          for (const row of rows) {
            expect(row.applied_at).toBe(1000);
          }
          // No duplicates
          const ids = rows.map((r) => r.id);
          expect(new Set(ids).size).toBe(ids.length);

          expect(result.applied.length).toBe(count);
          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Schema_Version equals the maximum recorded Migration_Id ────

// Feature: versioned-db-migrations, Property 2: Schema_Version equals the maximum recorded Migration_Id
describe("Property 2: Schema_Version equals the maximum recorded Migration_Id", () => {
  it("getSchemaVersion returns max stamped id or 0 when empty", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 10 }),
        (stampedIds) => {
          const db = freshDb();
          ensureMigrationHistory(db);
          for (const id of stampedIds) {
            db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(id, `m${id}`, Date.now());
          }
          const expected = stampedIds.length > 0 ? Math.max(...stampedIds) : 0;
          expect(getSchemaVersion(db)).toBe(expected);
          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Pending migrations are exactly the unrecorded migrations, ascending ─

// Feature: versioned-db-migrations, Property 3: Pending migrations are exactly the unrecorded migrations, ascending
describe("Property 3: Pending migrations are exactly the unrecorded migrations, ascending", () => {
  it("getPendingMigrations returns unrecorded migrations in ascending order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
        fc.uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 0, maxLength: 5 }),
        (registryIds, stampedIds) => {
          const db = freshDb();
          ensureMigrationHistory(db);
          const migs = registryIds.map((id) => makeMigration(id));

          for (const id of stampedIds) {
            try {
              db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(id, `m${id}`, Date.now());
            } catch { /* ignore duplicate inserts */ }
          }

          const pending = getPendingMigrations(db, migs);
          const stampedSet = new Set(stampedIds);
          const expectedIds = registryIds.filter((id) => !stampedSet.has(id)).sort((a, b) => a - b);

          expect(pending.map((m) => m.id)).toEqual(expectedIds);
          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Migrations are applied in ascending id order ────────────────

// Feature: versioned-db-migrations, Property 4: Migrations are applied in ascending id order
describe("Property 4: Migrations are applied in ascending id order", () => {
  it("up() functions are invoked in strictly ascending id order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { minLength: 2, maxLength: 8 }),
        (ids) => {
          const db = freshDb();
          const order: number[] = [];
          const migs: Migration[] = ids.map((id) => ({
            id,
            name: `m${id}`,
            up() { order.push(id); },
          }));
          // Shuffle to ensure source order doesn't matter
          const shuffled = [...migs].sort(() => Math.random() - 0.5);
          runMigrations(db, shuffled, { skipCheckpoint: true });

          const sorted = [...ids].sort((a, b) => a - b);
          expect(order).toEqual(sorted);
          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: Duplicate ids are rejected ──────────────────────────────────

// Feature: versioned-db-migrations, Property 5: Duplicate ids are rejected
describe("Property 5: Duplicate ids are rejected", () => {
  it("assertUniqueIds throws naming the duplicated id", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (duplicateId) => {
          const migs: Migration[] = [
            makeMigration(duplicateId),
            makeMigration(duplicateId + 1),
            makeMigration(duplicateId), // duplicate
          ];
          expect(() => assertUniqueIds(migs)).toThrow(String(duplicateId));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("runMigrations rejects duplicate ids before any mutation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (duplicateId) => {
          const db = freshDb();
          const migs: Migration[] = [makeMigration(duplicateId), makeMigration(duplicateId)];
          expect(() => runMigrations(db, migs, { skipCheckpoint: true })).toThrow(String(duplicateId));
          // No schema_migrations rows should exist
          ensureMigrationHistory(db);
          expect(getSchemaVersion(db)).toBe(0);
          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Convergence to Expected_Version with an equivalent final schema ─

// Feature: versioned-db-migrations, Property 6: Convergence to Expected_Version with an equivalent final schema
describe("Property 6: Convergence to Expected_Version with equivalent final schema", () => {
  it("fresh DB migrated reaches Expected_Version", () => {
    const db = freshDb();
    const result = runMigrations(db, realMigrations, { skipCheckpoint: true });
    expect(result.toVersion).toBe(getExpectedVersion(realMigrations));
    db.close();
  });

  it("legacy DB adopted then migrated reaches same version as fresh", () => {
    // Create a legacy DB using initSchema (simulates pre-migration-runner state)
    const legacyDb = freshDb();
    initSchema(legacyDb);
    // It has app tables but no schema_migrations
    expect(isLegacyDatabase(legacyDb)).toBe(true);

    const result = runMigrations(legacyDb, realMigrations, { skipCheckpoint: true });
    expect(result.toVersion).toBe(getExpectedVersion(realMigrations));
    expect(result.adoptedLegacy).toBe(true);

    // Fresh DB for comparison
    const freshDatabase = freshDb();
    runMigrations(freshDatabase, realMigrations, { skipCheckpoint: true });

    // Compare table sets
    const legacyTables = (legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    const freshTables = (freshDatabase.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    expect(legacyTables).toEqual(freshTables);

    legacyDb.close();
    freshDatabase.close();
  });
});

// ─── Property 7: Idempotence and exactly-once application ────────────────────

// Feature: versioned-db-migrations, Property 7: Idempotence and exactly-once application
describe("Property 7: Idempotence and exactly-once application", () => {
  it("running runMigrations twice applies nothing on second run", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (count) => {
          const db = freshDb();
          let callCount = 0;
          const migs: Migration[] = Array.from({ length: count }, (_, i) => ({
            id: i + 1,
            name: `m${i + 1}`,
            up(database: DatabaseType) { callCount++; database.exec(`CREATE TABLE IF NOT EXISTS _t${i + 1} (x INTEGER);`); },
          }));

          runMigrations(db, migs, { skipCheckpoint: true });
          expect(callCount).toBe(count);
          const versionAfterFirst = getSchemaVersion(db);

          // Second run
          callCount = 0;
          const result = runMigrations(db, migs, { skipCheckpoint: true });
          expect(callCount).toBe(0);
          expect(result.applied).toEqual([]);
          expect(getSchemaVersion(db)).toBe(versionAfterFirst);

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Halt-and-rollback leaves the prior consistent state ─────────

// Feature: versioned-db-migrations, Property 8: Halt-and-rollback leaves the prior consistent state
describe("Property 8: Halt-and-rollback leaves prior consistent state", () => {
  it("failing migration k is rolled back; earlier records retained; FK enabled", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        (total, failOffset) => {
          const failAt = (failOffset % total) + 1; // 1-based index into the sequence
          const db = freshDb();
          const migs: Migration[] = Array.from({ length: total }, (_, i) => ({
            id: i + 1,
            name: `m${i + 1}`,
            up(database: DatabaseType) {
              if (i + 1 === failAt) throw new Error(`intentional failure at ${failAt}`);
              database.exec(`CREATE TABLE IF NOT EXISTS _f${i + 1} (x INTEGER);`);
            },
          }));

          try {
            runMigrations(db, migs, { skipCheckpoint: true });
          } catch (err) {
            expect(err).toBeInstanceOf(MigrationError);
            expect((err as MigrationError).migrationId).toBe(failAt);
          }

          // Schema_Version is the id just before the failing one
          const expectedVersion = failAt - 1;
          expect(getSchemaVersion(db)).toBe(expectedVersion);

          // Earlier records retained
          const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>;
          expect(rows.map((r) => r.id)).toEqual(
            Array.from({ length: expectedVersion }, (_, i) => i + 1),
          );

          // FK enforcement is restored
          const fk = db.pragma("foreign_keys") as Array<{ foreign_keys: number }>;
          expect(fk[0].foreign_keys).toBe(1);

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: Data preservation across adoption and reconstruction ────────

// Feature: versioned-db-migrations, Property 9: Data preservation across adoption and reconstruction
describe("Property 9: Data preservation across adoption and reconstruction", () => {
  it("seeded device rows survive adoption and CHECK-removal migration", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 20 }),
            type: fc.string({ minLength: 1, maxLength: 10 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (devices) => {
          // Create a legacy DB with CHECK constraint on devices
          const db = freshDb();
          db.exec(`
            CREATE TABLE devices (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              type TEXT NOT NULL CHECK(type IN ('light','sensor','switch','climate','plug','custom')),
              capabilities TEXT NOT NULL DEFAULT '[]',
              state TEXT NOT NULL DEFAULT '{}',
              integration TEXT NOT NULL DEFAULT 'mqtt',
              last_seen INTEGER NOT NULL
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

          // Seed device rows (use valid types for the CHECK constraint)
          const validTypes = ["light", "sensor", "switch", "climate", "plug", "custom"];
          for (const d of devices) {
            const t = validTypes[Math.abs(d.type.charCodeAt(0)) % validTypes.length];
            db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run(d.id, d.name, t, 1000);
          }

          // Run the migration runner (it should detect legacy, adopt, then apply 002 + 003)
          runMigrations(db, realMigrations, { skipCheckpoint: true });

          // All rows preserved
          const rows = db.prepare("SELECT id, name FROM devices").all() as Array<{ id: string; name: string }>;
          expect(rows.length).toBe(devices.length);
          for (const d of devices) {
            const found = rows.find((r) => r.id === d.id);
            expect(found).toBeDefined();
            expect(found!.name).toBe(d.name);
          }

          // CHECK constraint is gone — insert a novel type
          expect(() => {
            db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("test-novel", "Novel", "custom_novel_xyz", Date.now());
          }).not.toThrow();

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Legacy database classification ─────────────────────────────

// Feature: versioned-db-migrations, Property 10: Legacy database classification
describe("Property 10: Legacy database classification", () => {
  it("fresh DB is not legacy", () => {
    const db = freshDb();
    expect(isLegacyDatabase(db)).toBe(false);
    expect(isFreshDatabase(db)).toBe(true);
    db.close();
  });

  it("DB with app tables but no schema_migrations is legacy", () => {
    const db = freshDb();
    db.exec("CREATE TABLE automation_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_topic TEXT NOT NULL, created_at INTEGER NOT NULL);");
    expect(isLegacyDatabase(db)).toBe(true);
    expect(isFreshDatabase(db)).toBe(false);
    db.close();
  });

  it("DB with app tables AND schema_migrations rows is not legacy", () => {
    const db = freshDb();
    db.exec("CREATE TABLE automation_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_topic TEXT NOT NULL, created_at INTEGER NOT NULL);");
    ensureMigrationHistory(db);
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (1, 'baseline', 1000)").run();
    expect(isLegacyDatabase(db)).toBe(false);
    expect(isFreshDatabase(db)).toBe(false);
    db.close();
  });

  it("DB with empty schema_migrations table (no rows) is still legacy", () => {
    const db = freshDb();
    db.exec("CREATE TABLE automation_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_topic TEXT NOT NULL, created_at INTEGER NOT NULL);");
    ensureMigrationHistory(db);
    expect(isLegacyDatabase(db)).toBe(true);
    db.close();
  });
});

// ─── Property 11: Guarded migrations are safe no-ops when change already exists ─

// Feature: versioned-db-migrations, Property 11: Guarded migrations are safe no-ops when their change already exists
describe("Property 11: Guarded migrations are safe no-ops when change already exists", () => {
  it("migration 002 is a no-op when all columns already exist", () => {
    const db = freshDb();
    // Use initSchema which already creates all columns
    initSchema(db);
    ensureMigrationHistory(db);
    // Stamp baseline so only 002+ are pending
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (1, 'baseline', 1000)").run();

    // Seed a row
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, rule_type, created_at) VALUES (?, ?, ?, ?, ?)").run("r1", "Rule1", "t/1", "script", Date.now());

    // Apply 002 — should be a no-op (columns already there)
    runMigrations(db, realMigrations, { skipCheckpoint: true });

    // Row unchanged
    const row = db.prepare("SELECT rule_type FROM automation_rules WHERE id = 'r1'").get() as { rule_type: string };
    expect(row.rule_type).toBe("script"); // NOT overwritten to 'form'
    db.close();
  });

  it("migration 003 is a no-op when CHECK constraint already removed", () => {
    const db = freshDb();
    // Apply all migrations fresh (no CHECK on devices)
    runMigrations(db, realMigrations, { skipCheckpoint: true });

    // Seed a device
    db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("d1", "Dev", "custom_type", Date.now());

    // Run again — should be idempotent no-op
    const result = runMigrations(db, realMigrations, { skipCheckpoint: true });
    expect(result.applied).toEqual([]);

    // Device still there
    const row = db.prepare("SELECT type FROM devices WHERE id = 'd1'").get() as { type: string };
    expect(row.type).toBe("custom_type");
    db.close();
  });
});

// ─── Property 12: Newer-than-binary databases are rejected without mutation ──

// Feature: versioned-db-migrations, Property 12: Newer-than-binary databases are rejected without mutation
describe("Property 12: Newer-than-binary databases are rejected without mutation", () => {
  it("throws DatabaseNewerThanBinaryError and does not mutate the DB", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        (futureId) => {
          const db = freshDb();
          ensureMigrationHistory(db);
          // Stamp a future version
          db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(futureId, "future", Date.now());

          // Our registry only goes up to id 3
          const tablesBefore = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);

          expect(() => runMigrations(db, realMigrations, { skipCheckpoint: true })).toThrow(DatabaseNewerThanBinaryError);

          // No mutation
          const tablesAfter = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
          expect(tablesAfter).toEqual(tablesBefore);

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 13: Referential integrity holds after table reconstruction ─────

// Feature: versioned-db-migrations, Property 13: Referential integrity holds after table reconstruction
describe("Property 13: Referential integrity holds after table reconstruction", () => {
  it("PRAGMA foreign_key_check reports no violations after devices reconstruction", () => {
    // Create a legacy DB with CHECK constraint
    const db = freshDb();
    db.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('light','sensor','switch')),
        capabilities TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT '{}',
        integration TEXT NOT NULL DEFAULT 'mqtt',
        last_seen INTEGER NOT NULL
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
    db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("d1", "Light", "light", Date.now());

    // Run all migrations
    runMigrations(db, realMigrations, { skipCheckpoint: true });

    // Check integrity
    db.pragma("foreign_keys = ON");
    const violations = db.pragma("foreign_key_check") as unknown[];
    expect(violations).toEqual([]);

    db.close();
  });
});
