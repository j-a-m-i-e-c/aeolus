import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { commandCapabilitySnapshot } from "./017-command-capability-snapshot.js";
import { commandTriggerProvenance } from "./018-command-trigger-provenance.js";

let db: DatabaseType;

/** A pre-018 command_records table: the migration-013 shape, nothing more. */
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
      VALUES (?, 'automation', 'dmx-1', 'device_action', 'dispatch', 'DISPATCHED', 1)`,
  ).run(commandId);
}

const TRIGGER_COLUMNS = ["trigger_kind", "trigger_id", "trigger_topic"] as const;

beforeEach(() => {
  db = new Database(":memory:");
  legacySchema(db);
});

afterEach(() => {
  db.close();
});

describe("migration 018 — command trigger provenance", () => {
  it("adds every trigger column to a pre-018 table", () => {
    commandTriggerProvenance.up(db);
    const columns = recordColumns();
    for (const column of TRIGGER_COLUMNS) {
      expect(columns.has(column)).toBe(true);
    }
  });

  it("leaves existing commands NULL rather than backfilling a trigger", () => {
    // A command written before this migration WAS caused by something; the schema
    // simply never recorded what. NULL is how that is said. Inventing a value here —
    // even an empty string — would assert that the command had no cause, which is the
    // one thing we know to be false.
    insertLegacyCommand("cmd-legacy");
    commandTriggerProvenance.up(db);

    const row = db
      .prepare(
        "SELECT trigger_kind, trigger_id, trigger_topic FROM command_records WHERE command_id = ?",
      )
      .get("cmd-legacy") as Record<string, unknown>;

    expect(row.trigger_kind).toBeNull();
    expect(row.trigger_id).toBeNull();
    expect(row.trigger_topic).toBeNull();
  });

  it("is idempotent across repeated application", () => {
    commandTriggerProvenance.up(db);
    expect(() => commandTriggerProvenance.up(db)).not.toThrow();
    const columns = recordColumns();
    for (const column of TRIGGER_COLUMNS) {
      expect(columns.has(column)).toBe(true);
    }
  });

  it("completes a run that stopped part-way through an earlier attempt", () => {
    // Each column is guarded individually, so a database left half-migrated must be
    // able to finish rather than trip over the first column that already exists.
    db.exec("ALTER TABLE command_records ADD COLUMN trigger_kind TEXT DEFAULT NULL;");
    expect(() => commandTriggerProvenance.up(db)).not.toThrow();
    const columns = recordColumns();
    expect(columns.has("trigger_id")).toBe(true);
    expect(columns.has("trigger_topic")).toBe(true);
  });

  it("composes with 017 in either order", () => {
    // The two migrations touch the same table and are independent. Ordering is fixed
    // by the registry, but neither may depend on the other having run.
    commandTriggerProvenance.up(db);
    commandCapabilitySnapshot.up(db);
    const columns = recordColumns();
    expect(columns.has("trigger_topic")).toBe(true);
    expect(columns.has("capability_ceiling")).toBe(true);
  });

  it("does not redefine the baseline execution index", () => {
    // The baseline already indexes (execution_id, requested_at DESC), which is what
    // grouping queries use. An index added here under that name would be silently
    // ignored on any existing database while looking like it did something.
    commandTriggerProvenance.up(db);
    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'command_records'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(indexes).not.toContain("idx_command_records_execution");
  });
});
