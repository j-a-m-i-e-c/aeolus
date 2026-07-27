// src/db/migrations/008-mqtt-device-source-topics.ts — Preserve MQTT source routing metadata

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Adds the exact MQTT state and command topics to the device registry schema.
 * The nullable columns keep every existing device row intact; an existing
 * legacy ID is associated with its source topic on its next MQTT observation.
 * The unique source index prevents two rows from claiming the same integration
 * and topic, avoiding the historical lossy-slug collision.
 */
export const mqttDeviceSourceTopics: Migration = {
  id: 8,
  name: "mqtt-device-source-topics",
  up(db: DatabaseType): void {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>)
        .map((column) => column.name),
    );

    if (!columns.has("topic")) {
      db.exec("ALTER TABLE devices ADD COLUMN topic TEXT DEFAULT NULL;");
    }
    if (!columns.has("command_topic")) {
      db.exec("ALTER TABLE devices ADD COLUMN command_topic TEXT DEFAULT NULL;");
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_integration_topic
      ON devices(integration, topic)
      WHERE topic IS NOT NULL;
    `);
  },
};
