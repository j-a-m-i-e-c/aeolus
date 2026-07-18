// src/db/migrations/005-devices-ack-capable.ts — Add ack_capable column to devices

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the nullable ack_capable column to the devices table.
 *
 * Guarded: checks PRAGMA table_info before the ALTER so it is a safe no-op when
 * the column already exists. Defaults to 0 (false) — existing devices are
 * unaffected.
 */
export const devicesAckCapable: Migration = {
  id: 5,
  name: "devices-ack-capable",
  up(db: DatabaseType): void {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>)
        .map((c) => c.name),
    );

    if (!existing.has("ack_capable")) {
      db.exec("ALTER TABLE devices ADD COLUMN ack_capable INTEGER NOT NULL DEFAULT 0;");
    }
  },
};
