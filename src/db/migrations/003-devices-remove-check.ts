// src/db/migrations/003-devices-remove-check.ts — Remove CHECK constraint from devices table

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Removes the old CHECK(type IN (...)) constraint from the devices table
 * via table rename → recreate → copy → drop.
 *
 * Guarded: inspects sqlite_master for the CHECK pattern; returns immediately
 * (safe no-op) if the constraint is already absent.
 *
 * NOTE: This migration does NOT manage BEGIN/COMMIT/ROLLBACK or the
 * foreign_keys pragma — the runner owns both. The pragma is set to OFF outside
 * the transaction before this migration runs, and restored to ON after.
 */
export const devicesRemoveCheck: Migration = {
  id: 3,
  name: "devices-remove-check",
  up(db: DatabaseType): void {
    const row = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='devices'",
    ).get() as { sql: string } | undefined;

    if (!row || !/CHECK\s*\(/i.test(row.sql)) {
      return; // Already migrated or fresh database (R5.5)
    }

    db.exec("ALTER TABLE devices RENAME TO devices_old;");
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
    db.exec(`
      INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen)
      SELECT id, name, type, capabilities, state, integration, last_seen
      FROM devices_old;
    `);
    db.exec("DROP TABLE devices_old;");
  },
};
