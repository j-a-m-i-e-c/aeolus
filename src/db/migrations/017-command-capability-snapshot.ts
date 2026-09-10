// src/db/migrations/017-command-capability-snapshot.ts
// showcase-cleanup — explain a command's skipped evidence stages, permanently.

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Snapshot, on each Verified Command, the capability context that decides which
 * evidence stages were even possible — plus the author's semantic intent.
 *
 * Why this has to be a snapshot rather than a lookup. A command's evidence ladder
 * is read long after the command settled, and the presentation has to distinguish
 * "this device cannot acknowledge" from "an acknowledgement was not required for
 * this command" from "it was required and never came". All three render the
 * ACKNOWLEDGED stage as unreached; only the recorded reason separates them. Deriving
 * that reason at read time from the device's *current* profile would silently
 * rewrite history the moment someone edits an MQTT command profile or a connector
 * gains an ack capability: last week's dispatch-only command would start claiming
 * its device could have acknowledged. So the ceiling, the two capability booleans
 * and the observation contract are frozen at acceptance time.
 *
 * Every column is nullable and no backfill is attempted. A row written before this
 * migration genuinely does not know its ceiling, and NULL is how that is said. The
 * presentation treats an absent snapshot as "not recorded" rather than inventing
 * `false`, which would assert that an old command's device lacked capabilities it
 * may well have had.
 *
 * `condition_spec` deliberately duplicates data already in
 * `command_transitions.details`. They answer different questions: the per-rung copy
 * is what was stated at the moment that rung was reached, while this one is the
 * contract the command was accepted under. Reading the contract must not require
 * walking a timeline and guessing which rung stated it.
 *
 * Idempotent: every column add is guarded by PRAGMA table_info, so re-applying is
 * a no-op.
 */
export const commandCapabilitySnapshot: Migration = {
  id: 17,
  name: "command-capability-snapshot",
  up(db: DatabaseType): void {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(command_records)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );

    // Guarded individually rather than as a batch: a database part-way through a
    // failed earlier attempt must be able to complete, not trip over the first
    // column that already exists.
    const add = (column: string, ddl: string): void => {
      if (!columns.has(column)) {
        db.exec(`ALTER TABLE command_records ADD COLUMN ${column} ${ddl};`);
      }
    };

    // ── Capability context, frozen at acceptance ──
    /** Highest tier this command could have proven: dispatch | acknowledged | observed. */
    add("capability_ceiling", "TEXT DEFAULT NULL");
    /** 1 when the target declared a correlated-acknowledgement capability. */
    add("ack_available", "INTEGER DEFAULT NULL");
    /** 1 when this command carried an observation contract. Not a claim about the site's sensors. */
    add("observation_configured", "INTEGER DEFAULT NULL");
    /** Device whose telemetry settled the question; may equal the target. */
    add("observed_device_id", "TEXT DEFAULT NULL");
    /** The observation contract as plain JSON, exactly as accepted. */
    add("condition_spec", "TEXT DEFAULT NULL");
    /** Integration the command was handed to, e.g. "mqtt", "hue". Names the transport, not the device. */
    add("transport_kind", "TEXT DEFAULT NULL");

    // ── Display identity, resolved at acceptance ──
    // Names are snapshotted so historical evidence still reads in human terms after
    // a device is renamed or removed. The ids above remain the durable identity.
    add("target_device_name", "TEXT DEFAULT NULL");
    add("observed_device_name", "TEXT DEFAULT NULL");

    // ── Author-supplied semantic context ──
    // What operation this was ("Transfer 500 L"), and what the observation means
    // ("Flow detected"). Bounded and sanitised at the boundary before it lands here.
    // Never the lifecycle state itself, which stays platform-owned.
    add("intent_label", "TEXT DEFAULT NULL");
    add("observed_label", "TEXT DEFAULT NULL");
  },
};
