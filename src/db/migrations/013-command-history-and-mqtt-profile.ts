// src/db/migrations/013-command-history-and-mqtt-profile.ts
// phase-1-runtime-foundations — durable command history + generic MQTT command profile

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Phase 1 runtime foundations schema:
 *
 *  1. `devices.mqtt_command_profile` (TEXT, nullable JSON): per-device generic
 *     MQTT command behaviour (acknowledgement capability, QoS) that is not
 *     derivable from discovery. Guarded via PRAGMA table_info so it is a safe
 *     no-op when already present; existing rows read as NULL (dispatch-only).
 *
 *  2. `command_records`: one durable summary row per Verified Command, keyed by
 *     the stable `command_id`. `terminal_at` is the historical schema name for
 *     completion of the configured command wait: it is stamped when the caller's
 *     selected evidence tier succeeds or a final failure occurs. Do not infer
 *     lifecycle finality from that column: DISPATCHED and ACKNOWLEDGED can be
 *     successful completion states without being lifecycle-final states.
 *
 *  3. `command_transitions`: append-only, immutable record of every lifecycle
 *     transition for a command, ordered by autoincrement `id`.
 *
 * All statements are idempotent (guarded column add, CREATE TABLE/INDEX IF NOT
 * EXISTS) so the migration is a safe no-op when re-applied.
 */
export const commandHistoryAndMqttProfile: Migration = {
  id: 13,
  name: "command-history-and-mqtt-profile",
  up(db: DatabaseType): void {
    // 1. devices.mqtt_command_profile (nullable JSON column)
    const deviceColumns = new Set(
      (db.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!deviceColumns.has("mqtt_command_profile")) {
      db.exec("ALTER TABLE devices ADD COLUMN mqtt_command_profile TEXT DEFAULT NULL;");
    }

    // 2. command_records — durable per-command summary
    db.exec(`
      CREATE TABLE IF NOT EXISTS command_records (
        command_id TEXT PRIMARY KEY,
        correlation_id TEXT,
        source_kind TEXT NOT NULL,
        source_id TEXT,
        rule_id TEXT,
        execution_id TEXT,
        causation_id TEXT,
        target_device_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        requested_tier TEXT,
        effective_tier TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        success INTEGER,
        failure_kind TEXT,
        error TEXT,
        requested_at INTEGER NOT NULL,
        terminal_at INTEGER
      );
    `);

    // 3. command_transitions — append-only lifecycle timeline
    db.exec(`
      CREATE TABLE IF NOT EXISTS command_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        details TEXT,
        FOREIGN KEY(command_id) REFERENCES command_records(command_id) ON DELETE CASCADE
      );
    `);

    // Indexes: newest-first listing, per-device and per-execution filters,
    // correlation lookup (unique when present), and chronological transitions.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_command_records_requested_at
        ON command_records(requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_command_records_target_time
        ON command_records(target_device_id, requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_command_records_execution
        ON command_records(execution_id, requested_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_command_records_correlation
        ON command_records(correlation_id)
        WHERE correlation_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_command_transitions_command
        ON command_transitions(command_id, id);
    `);
  },
};
