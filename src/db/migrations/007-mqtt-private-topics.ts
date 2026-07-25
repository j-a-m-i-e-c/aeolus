// src/db/migrations/007-mqtt-private-topics.ts — Admin-managed private MQTT topic filters

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Creates the `mqtt_private_topics` table: the set of MQTT topic filters whose
 * raw messages must NOT be broadcast on the public inspector feed. The raw MQTT
 * feed is public by default (a discovery firehose); a message whose topic
 * matches any stored filter is downgraded to admin-only visibility instead.
 *
 * `pattern` is a standard MQTT topic filter (may contain `+`/`#`) and is unique
 * so the same filter cannot be registered twice.
 */
export const mqttPrivateTopics: Migration = {
  id: 7,
  name: "mqtt-private-topics",
  up(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mqtt_private_topics (
        id         TEXT PRIMARY KEY,
        pattern    TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
    `);
  },
};
