// Feature: remove-hardcoded-restrictions, Property 1: Database accepts any non-empty device type string
// Task 1.2: Property test for database accepting any device type
// Task 1.3: Unit test for CHECK constraint migration
import { describe, expect, it, beforeEach } from "vitest";
import { test, fc } from "@fast-check/vitest";
import initSqlJs, { type Database } from "sql.js";
import { initSchema } from "./database.js";

// Mock persistDatabase to no-op in tests
vi.mock("./database.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./database.js")>();
  return {
    ...actual,
    persistDatabase: vi.fn(),
  };
});

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
    async (deviceType, deviceId) => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();

      initSchema(db);

      // Insert a device row with the arbitrary type
      db.run(
        `INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen)
         VALUES (?, ?, ?, '[]', '{}', 'mqtt', ?)`,
        [deviceId, `Test ${deviceId}`, deviceType, Date.now()]
      );

      // Verify the row persists and is retrievable with the same type value
      const result = db.exec(`SELECT id, type FROM devices WHERE id = ?`, [deviceId]);
      expect(result.length).toBe(1);
      expect(result[0].values.length).toBe(1);
      expect(result[0].values[0][0]).toBe(deviceId);
      expect(result[0].values[0][1]).toBe(deviceType);

      db.close();
    }
  );
});

// --- Task 1.3: Unit test for CHECK constraint migration ---
// **Validates: Requirement 1.4**
describe("Feature: remove-hardcoded-restrictions — CHECK constraint migration", () => {
  it("migrates an existing database with CHECK constraint so that novel device types succeed", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // Manually create the devices table WITH the old CHECK constraint
    db.run(`
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
    const beforeResult = db.exec(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'`
    );
    expect(beforeResult.length).toBe(1);
    const beforeSql = beforeResult[0].values[0][0] as string;
    expect(beforeSql).toMatch(/CHECK/i);

    // Run initSchema — this should trigger migrateRemoveTypeCheck
    initSchema(db);

    // Verify the CHECK constraint has been removed
    const afterResult = db.exec(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'`
    );
    expect(afterResult.length).toBe(1);
    const afterSql = afterResult[0].values[0][0] as string;
    expect(afterSql).not.toMatch(/CHECK/i);

    // Verify that inserting a device with type "valve" succeeds after migration
    expect(() => {
      db.run(
        `INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen)
         VALUES ('valve-1', 'Test Valve', 'valve', '[]', '{}', 'mqtt', ?)`,
        [Date.now()]
      );
    }).not.toThrow();

    // Verify the row was actually inserted
    const valveResult = db.exec(`SELECT id, type FROM devices WHERE id = 'valve-1'`);
    expect(valveResult.length).toBe(1);
    expect(valveResult[0].values[0][1]).toBe("valve");

    db.close();
  });
});
