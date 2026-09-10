// Feature: showcase-cleanup — migration 017 tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { commandCapabilitySnapshot } from "./017-command-capability-snapshot.js";

let db: DatabaseType;

/** A pre-017 command_records table: the migration-013 shape, nothing more. */
function legacySchema(database: DatabaseType): void {
  database.exec(`
    CREATE TABLE command_records (
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
}

function recordColumns(): Set<string> {
  return new Set(
    (db.prepare("PRAGMA table_info(command_records)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
}

function insertLegacyCommand(commandId: string): void {
  db.prepare(
    `INSERT INTO command_records
      (command_id, source_kind, target_device_id, action_type, effective_tier, lifecycle_state, requested_at)
      VALUES (?, 'automation', 'pump-1', 'device_action', 'dispatch', 'DISPATCHED', 1)`,
  ).run(commandId);
}

const SNAPSHOT_COLUMNS = [
  "capability_ceiling",
  "ack_available",
  "observation_configured",
  "observed_device_id",
  "condition_spec",
  "transport_kind",
  "target_device_name",
  "observed_device_name",
  "intent_label",
  "observed_label",
] as const;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  legacySchema(db);
});

afterEach(() => db.close());

describe("migration 017 — command capability snapshot", () => {
  it("adds every capability and intent column to command_records", () => {
    commandCapabilitySnapshot.up(db);

    const columns = recordColumns();
    for (const column of SNAPSHOT_COLUMNS) {
      expect(columns.has(column), `expected column ${column}`).toBe(true);
    }
  });

  it("leaves pre-existing commands reading NULL rather than a fabricated default", () => {
    // The distinction this pins down: a command recorded before the snapshot
    // existed does not know its ceiling. Backfilling `ack_available = 0` would
    // assert that its device could not acknowledge, which nothing established.
    insertLegacyCommand("old-1");

    commandCapabilitySnapshot.up(db);

    const row = db
      .prepare(
        `SELECT capability_ceiling, ack_available, observation_configured, condition_spec,
                transport_kind, target_device_name, intent_label
           FROM command_records WHERE command_id = 'old-1'`,
      )
      .get() as Record<string, unknown>;

    expect(row.capability_ceiling).toBeNull();
    expect(row.ack_available).toBeNull();
    expect(row.observation_configured).toBeNull();
    expect(row.condition_spec).toBeNull();
    expect(row.transport_kind).toBeNull();
    expect(row.target_device_name).toBeNull();
    expect(row.intent_label).toBeNull();
  });

  it("preserves the columns the earlier schema already had", () => {
    insertLegacyCommand("old-2");

    commandCapabilitySnapshot.up(db);

    const row = db
      .prepare("SELECT target_device_id, effective_tier, lifecycle_state FROM command_records WHERE command_id = 'old-2'")
      .get() as Record<string, unknown>;
    expect(row.target_device_id).toBe("pump-1");
    expect(row.effective_tier).toBe("dispatch");
    expect(row.lifecycle_state).toBe("DISPATCHED");
  });

  it("accepts a fully populated snapshot after migrating", () => {
    commandCapabilitySnapshot.up(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO command_records
            (command_id, source_kind, target_device_id, action_type, effective_tier, lifecycle_state,
             requested_at, capability_ceiling, ack_available, observation_configured, observed_device_id,
             condition_spec, transport_kind, target_device_name, observed_device_name, intent_label, observed_label)
            VALUES ('new-1','automation','pump-1','device_action','observed','OBSERVED',1,
                    'observed',1,1,'flow-1','{"field":"litresPerMinute","op":"gt","value":0}',
                    'mqtt','Transfer Pump','Transfer Flow Meter','Transfer 500 L','Flow detected')`,
        )
        .run(),
    ).not.toThrow();

    const row = db
      .prepare("SELECT * FROM command_records WHERE command_id = 'new-1'")
      .get() as Record<string, unknown>;
    expect(row.capability_ceiling).toBe("observed");
    expect(row.ack_available).toBe(1);
    expect(row.observed_device_name).toBe("Transfer Flow Meter");
    expect(row.intent_label).toBe("Transfer 500 L");
  });

  it("is a safe no-op when applied twice", () => {
    commandCapabilitySnapshot.up(db);
    expect(() => commandCapabilitySnapshot.up(db)).not.toThrow();
    expect(recordColumns().has("capability_ceiling")).toBe(true);
  });

  it("completes a part-applied earlier attempt rather than tripping on it", () => {
    // Each column is guarded individually, so a database left half-migrated by an
    // interrupted run can still be brought forward.
    db.exec("ALTER TABLE command_records ADD COLUMN capability_ceiling TEXT DEFAULT NULL;");

    expect(() => commandCapabilitySnapshot.up(db)).not.toThrow();

    const columns = recordColumns();
    for (const column of SNAPSHOT_COLUMNS) {
      expect(columns.has(column), `expected column ${column}`).toBe(true);
    }
  });
});
