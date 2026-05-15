// src/connectors/connector-store.test.ts — Unit tests for ConnectorStore

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { ConnectorStore } from "./connector-store.js";
import type { ConnectorRecord } from "./connector.interface.js";

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeRecord(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: "test-id-1",
    connectorType: "hue",
    enabled: true,
    config: { bridgeIp: "192.168.1.100", apiKey: "abc123" },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe("ConnectorStore", () => {
  let db: DatabaseType;
  let store: ConnectorStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        connector_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    store = new ConnectorStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should save and load a connector record", () => {
    const record = makeRecord();
    store.save(record);

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(record.id);
    expect(loaded[0].connectorType).toBe(record.connectorType);
    expect(loaded[0].enabled).toBe(true);
    expect(loaded[0].config).toEqual(record.config);
    expect(loaded[0].createdAt).toBe(record.createdAt);
    expect(loaded[0].updatedAt).toBe(record.updatedAt);
  });

  it("should upsert on save (update existing record)", () => {
    const record = makeRecord();
    store.save(record);

    const updated = makeRecord({ config: { bridgeIp: "10.0.0.1" }, updatedAt: 1700000001000 });
    store.save(updated);

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].config).toEqual({ bridgeIp: "10.0.0.1" });
    expect(loaded[0].updatedAt).toBe(1700000001000);
  });

  it("should disable a connector (set enabled=0, preserve config)", () => {
    const record = makeRecord();
    store.save(record);
    store.disable(record.id);

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].enabled).toBe(false);
    expect(loaded[0].config).toEqual(record.config);
  });

  it("should delete a connector record", () => {
    const record = makeRecord();
    store.save(record);
    store.delete(record.id);

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(0);
  });

  it("should load only enabled records with loadEnabled()", () => {
    store.save(makeRecord({ id: "enabled-1", enabled: true }));
    store.save(makeRecord({ id: "disabled-1", enabled: false }));
    store.save(makeRecord({ id: "enabled-2", enabled: true }));

    const enabled = store.loadEnabled();
    expect(enabled).toHaveLength(2);
    expect(enabled.map((r) => r.id).sort()).toEqual(["enabled-1", "enabled-2"]);
  });

  it("should return empty arrays when table is empty", () => {
    expect(store.loadAll()).toEqual([]);
    expect(store.loadEnabled()).toEqual([]);
  });

  it("should skip records with malformed JSON config", () => {
    // Insert a row with invalid JSON directly
    db.prepare(
      `INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("bad-json", "kasa", 1, "not-valid-json{", 1700000000000, 1700000000000);
    store.save(makeRecord({ id: "good-record" }));

    const loaded = store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("good-record");
  });
});
