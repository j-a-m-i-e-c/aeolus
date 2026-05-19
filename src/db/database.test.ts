// src/db/database.test.ts — Unit tests for database initialization and migration

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "./database.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("database", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  describe("initSchema", () => {
    it("creates all required tables", () => {
      initSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("devices");
      expect(tableNames).toContain("automation_rules");
      expect(tableNames).toContain("tabs");
      expect(tableNames).toContain("panes");
      expect(tableNames).toContain("connectors");
      expect(tableNames).toContain("services");
      expect(tableNames).toContain("automation_state");
      expect(tableNames).toContain("device_history");
      expect(tableNames).toContain("groups");
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("group_tab_assignments");
      expect(tableNames).toContain("refresh_tokens");
      expect(tableNames).toContain("mqtt_credentials");
      expect(tableNames).toContain("system_settings");
    });

    it("is idempotent — can be called multiple times", () => {
      initSchema(db);
      initSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      expect(tables.length).toBeGreaterThan(0);
    });

    it("creates device_history index", () => {
      initSchema(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_device_history_device_ts'")
        .all();
      expect(indexes).toHaveLength(1);
    });

    it("creates refresh_tokens indexes", () => {
      initSchema(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_refresh_tokens%'")
        .all();
      expect(indexes.length).toBe(2);
    });
  });

  describe("migrateRemoveTypeCheck", () => {
    it("migrates devices table with CHECK constraint", () => {
      // Create a devices table with a CHECK constraint (simulating old schema)
      db.exec(`
        CREATE TABLE devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('light', 'sensor', 'switch')),
          capabilities TEXT NOT NULL DEFAULT '[]',
          state TEXT NOT NULL DEFAULT '{}',
          integration TEXT NOT NULL DEFAULT 'mqtt',
          last_seen INTEGER NOT NULL
        );
      `);
      // Insert a row
      db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("d1", "Test", "light", 1000);

      // Run initSchema which should trigger migration
      initSchema(db);

      // Verify the data is preserved
      const row = db.prepare("SELECT * FROM devices WHERE id = ?").get("d1") as any;
      expect(row.name).toBe("Test");
      expect(row.type).toBe("light");

      // Verify the CHECK constraint is removed (can insert any type now)
      db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("d2", "Custom", "custom_type", 2000);
      const custom = db.prepare("SELECT * FROM devices WHERE id = ?").get("d2") as any;
      expect(custom.type).toBe("custom_type");
    });

    it("does not migrate when no CHECK constraint exists", () => {
      // Create a devices table without CHECK constraint (already migrated)
      db.exec(`
        CREATE TABLE devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          capabilities TEXT NOT NULL DEFAULT '[]',
          state TEXT NOT NULL DEFAULT '{}',
          integration TEXT NOT NULL DEFAULT 'mqtt',
          last_seen INTEGER NOT NULL
        );
      `);
      db.prepare("INSERT INTO devices (id, name, type, last_seen) VALUES (?, ?, ?, ?)").run("d1", "Test", "light", 1000);

      // Run initSchema — should not attempt migration
      initSchema(db);

      // Data should still be there
      const row = db.prepare("SELECT * FROM devices WHERE id = ?").get("d1") as any;
      expect(row.name).toBe("Test");
    });

    it("does not migrate when devices table does not exist", () => {
      // No devices table at all — initSchema will create it fresh
      initSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'devices'")
        .all();
      expect(tables).toHaveLength(1);
    });
  });
});
