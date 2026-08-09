// Feature: phase-1-runtime-foundations — migration 013 tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { commandHistoryAndMqttProfile } from "./013-command-history-and-mqtt-profile.js";

let db: DatabaseType;

/** A pre-013 schema: a devices table without the mqtt_command_profile column. */
function legacySchema(database: DatabaseType): void {
  database.exec(`
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT '{}',
      integration TEXT NOT NULL DEFAULT 'mqtt',
      last_seen INTEGER NOT NULL,
      topic TEXT DEFAULT NULL,
      command_topic TEXT DEFAULT NULL,
      connector_instance_id TEXT DEFAULT NULL
    );
  `);
}

function deviceColumns(): Set<string> {
  return new Set(
    (db.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>).map((c) => c.name),
  );
}

function tableExists(name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) !== undefined
  );
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  legacySchema(db);
});

afterEach(() => db.close());

describe("migration 013 — command history and MQTT command profile", () => {
  it("adds the nullable mqtt_command_profile column to devices", () => {
    commandHistoryAndMqttProfile.up(db);
    expect(deviceColumns().has("mqtt_command_profile")).toBe(true);
  });

  it("existing devices read the profile column as NULL after migration", () => {
    db.prepare(
      "INSERT INTO devices (id, name, type, last_seen) VALUES ('d1','D1','pump',1)",
    ).run();

    commandHistoryAndMqttProfile.up(db);

    const row = db
      .prepare("SELECT mqtt_command_profile FROM devices WHERE id = 'd1'")
      .get() as { mqtt_command_profile: string | null };
    expect(row.mqtt_command_profile).toBeNull();
  });

  it("creates the command_records and command_transitions tables", () => {
    commandHistoryAndMqttProfile.up(db);
    expect(tableExists("command_records")).toBe(true);
    expect(tableExists("command_transitions")).toBe(true);
  });

  it("command_records enforces a unique correlation_id only when present", () => {
    commandHistoryAndMqttProfile.up(db);

    const insert = db.prepare(
      `INSERT INTO command_records
        (command_id, correlation_id, source_kind, target_device_id, action_type, effective_tier, lifecycle_state, requested_at)
        VALUES (?, ?, 'rest', 'dev', 'toggle', 'dispatch', 'REQUESTED', 1)`,
    );

    // Two NULL correlation ids are allowed (partial unique index).
    expect(() => insert.run("c1", null)).not.toThrow();
    expect(() => insert.run("c2", null)).not.toThrow();

    // A concrete correlation id is unique.
    expect(() => insert.run("c3", "K1")).not.toThrow();
    expect(() => insert.run("c4", "K1")).toThrow();
  });

  it("command_transitions cascade-delete with their command record", () => {
    commandHistoryAndMqttProfile.up(db);

    db.prepare(
      `INSERT INTO command_records
        (command_id, source_kind, target_device_id, action_type, effective_tier, lifecycle_state, requested_at)
        VALUES ('cmd1','rest','dev','toggle','dispatch','REQUESTED',1)`,
    ).run();
    db.prepare(
      "INSERT INTO command_transitions (command_id, to_state, timestamp) VALUES ('cmd1','REQUESTED',1)",
    ).run();

    db.prepare("DELETE FROM command_records WHERE command_id = 'cmd1'").run();

    const remaining = db
      .prepare("SELECT COUNT(*) AS n FROM command_transitions WHERE command_id = 'cmd1'")
      .get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it("is a safe no-op when applied twice", () => {
    commandHistoryAndMqttProfile.up(db);
    expect(() => commandHistoryAndMqttProfile.up(db)).not.toThrow();
    expect(deviceColumns().has("mqtt_command_profile")).toBe(true);
    expect(tableExists("command_records")).toBe(true);
  });
});
