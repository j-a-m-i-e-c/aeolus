// Feature: remove-hardcoded-restrictions, Property 1: Database accepts any non-empty device type string
// Task 1.2: Property test for database accepting any device type
// Task 1.3: Unit test for CHECK constraint migration
import { describe, expect, it, beforeEach } from "vitest";
import { test, fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "./database.js";

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// --- Property 1: Database accepts any non-empty device type string ---
// **Validates: Requirements 1.1, 1.2**
describe("Feature: remove-hardcoded-restrictions — Property 1: Database accepts any non-empty device type string", () => {
  /** Arbitrary non-empty string for device type (printable chars, 1–50 length) */
  const nonEmptyDeviceTypeArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

  test.prop([nonEmptyDeviceTypeArb, fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/)], { numRuns: 100 })(
    "Property 1: Any non-empty device type string is accepted and retrievable",
    (deviceType, deviceId) => {
      const db = new Database(":memory:");

      initSchema(db);

      // Insert a device row with the arbitrary type
      db.prepare(
        `INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen)
         VALUES (?, ?, ?, '[]', '{}', 'mqtt', ?)`
      ).run(deviceId, `Test ${deviceId}`, deviceType, Date.now());

      // Verify the row persists and is retrievable with the same type value
      const result = db.prepare(`SELECT id, type FROM devices WHERE id = ?`).get(deviceId) as { id: string; type: string } | undefined;
      expect(result).toBeDefined();
      expect(result!.id).toBe(deviceId);
      expect(result!.type).toBe(deviceType);

      db.close();
    }
  );
});

// --- Task 1.3: Unit test for CHECK constraint migration ---
// **Validates: Requirement 1.4**
describe("Feature: remove-hardcoded-restrictions — CHECK constraint migration", () => {
  it("migrates an existing database with CHECK constraint so that novel device types succeed", () => {
    const db = new Database(":memory:");

    // Manually create the devices table WITH the old CHECK constraint
    db.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('light', 'sensor', 'switch', 'climate', 'plug')),
        capabilities TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT '{}',
        integration TEXT NOT NULL DEFAULT 'mqtt',
        last_seen INTEGER NOT NULL
      );
    `);

    // Verify the CHECK constraint is present before migration
    const beforeRow = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'`
    ).get() as { sql: string };
    expect(beforeRow.sql).toMatch(/CHECK/i);

    // Run initSchema — this should trigger migrateRemoveTypeCheck
    initSchema(db);

    // Verify the CHECK constraint has been removed
    const afterRow = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'`
    ).get() as { sql: string };
    expect(afterRow.sql).not.toMatch(/CHECK/i);

    // Verify that inserting a device with type "valve" succeeds after migration
    expect(() => {
      db.prepare(
        `INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen)
         VALUES ('valve-1', 'Test Valve', 'valve', '[]', '{}', 'mqtt', ?)`
      ).run(Date.now());
    }).not.toThrow();

    // Verify the row was actually inserted
    const valveResult = db.prepare(`SELECT id, type FROM devices WHERE id = 'valve-1'`).get() as { id: string; type: string };
    expect(valveResult.type).toBe("valve");

    db.close();
  });
});
