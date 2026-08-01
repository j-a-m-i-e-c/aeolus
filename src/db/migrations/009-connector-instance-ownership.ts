// src/db/migrations/009-connector-instance-ownership.ts — Record device → connector instance ownership

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the owning connector instance id to the device registry schema.
 *
 * The nullable column keeps every existing device row intact: MQTT devices
 * never set it, and connector devices discovered before this feature reacquire
 * their owner on the next discovery poll. Recording ownership lets action
 * routing dispatch to the exact owning instance and lets disable remove only an
 * instance's own devices, so two instances of one connector type coexist.
 */
export const connectorInstanceOwnership: Migration = {
  id: 9,
  name: "connector-instance-ownership",
  up(db: DatabaseType): void {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>)
        .map((column) => column.name),
    );

    if (!columns.has("connector_instance_id")) {
      db.exec("ALTER TABLE devices ADD COLUMN connector_instance_id TEXT DEFAULT NULL;");
    }
  },
};
