// src/connectors/connector-store.test.ts — Unit tests for ConnectorStore

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { ConnectorStore } from "./connector-store.js";
import type { ConnectorRecord } from "./connector.interface.js";
import { BUNDLED_CONNECTOR_MODULES, secretFieldLookup } from "./bundled.js";
import { createSecretCodec, installSecretCodec, secretCodec } from "../secrets/secret-store.js";
import { generateKeyring } from "../secrets/keyring.js";

const lookup = secretFieldLookup(BUNDLED_CONNECTOR_MODULES);
const storedConfig = (db: DatabaseType, id: string) =>
  JSON.parse((db.prepare("SELECT config FROM connectors WHERE id = ?").get(id) as { config: string }).config) as Record<string, unknown>;

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
    store = new ConnectorStore(db, lookup);
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

  it("stores password fields encrypted and other fields as they are (H2b)", () => {
    store.save(makeRecord());
    const stored = storedConfig(db, "test-id-1");
    expect(stored.bridgeIp).toBe("192.168.1.100");
    expect(stored.apiKey).toMatch(/^aeolus-enc:v1:/);
    expect(JSON.stringify(stored)).not.toContain("abc123");
    // A new nonce on every save, so equal secrets never produce equal ciphertexts.
    store.save(makeRecord());
    expect(storedConfig(db, "test-id-1").apiKey).not.toBe(stored.apiKey);
    expect(store.loadAll()[0]!.config.apiKey).toBe("abc123");
  });

  it("leaves empty secrets and connectors without secret fields unchanged", () => {
    store.save(makeRecord({ id: "kasa-1", connectorType: "kasa", config: { pollInterval: 30 } }));
    store.save(makeRecord({ id: "hue-empty", config: { bridgeIp: "10.0.0.2", apiKey: "" } }));
    expect(storedConfig(db, "kasa-1")).toEqual({ pollInterval: 30 });
    expect(storedConfig(db, "hue-empty")).toEqual({ bridgeIp: "10.0.0.2", apiKey: "" });
  });

  it("seals a posted value that merely looks like an envelope, so it is never trusted as one", () => {
    const foreign = secretCodec().sealConnectorField("other-instance", "apiKey", "stolen");
    store.save(makeRecord({ config: { bridgeIp: "10.0.0.2", apiKey: foreign } }));
    expect(storedConfig(db, "test-id-1").apiKey).not.toBe(foreign);
    expect(store.loadAll()[0]!.config.apiKey).toBe(foreign);
  });

  it("refuses a plaintext secret field on load: no plaintext fallback", () => {
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)")
      .run("plain", "hue", JSON.stringify({ bridgeIp: "10.0.0.2", apiKey: "plaintext-key" }));
    expect(() => store.loadAll()).toThrow(/Connector plain field apiKey holds an unencrypted value/);
  });

  it("refuses an envelope moved from another connector (record swap)", () => {
    store.save(makeRecord({ id: "a" }));
    const moved = storedConfig(db, "a").apiKey as string;
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)")
      .run("b", "hue", JSON.stringify({ bridgeIp: "10.0.0.2", apiKey: moved }));
    expect(() => store.loadEnabled()).toThrow(/Connector b field apiKey cannot be decrypted/);
  });

  it("refuses to load with a different keyring, and to save or load with none", () => {
    store.save(makeRecord());
    const original = secretCodec();
    try {
      installSecretCodec(createSecretCodec(generateKeyring()));
      expect(() => store.loadAll()).toThrow(/cannot be decrypted/);
      installSecretCodec(null);
      expect(() => store.loadAll()).toThrow(/keyring has not been loaded/);
      expect(() => store.save(makeRecord())).toThrow(/keyring has not been loaded/);
    } finally {
      installSecretCodec(original);
    }
  });

  it("refuses to save a connector whose type is not registered (its secret fields are unknown)", () => {
    expect(() => store.save(makeRecord({ connectorType: "unknown-type" }))).toThrow(/not registered/);
    // An unregistered type already stored is loaded as stored; no connector can run it.
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)")
      .run("old", "retired-type", JSON.stringify({ token: "x" }));
    expect(store.loadAll().find((r) => r.id === "old")!.config).toEqual({ token: "x" });
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
