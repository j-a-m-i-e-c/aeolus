import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { migrateLegacyHueCredentials } from "./migrate-legacy-hue.js";
import type { ConnectorStore } from "./connector-store.js";
import type { ConnectorRecord } from "./connector.interface.js";

// Mock config to use a temp directory
vi.mock("../config.js", () => ({
  config: { dbPath: "/tmp/aeolus-test/aeolus.db" },
}));

// Suppress logger output during tests
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeStore(): ConnectorStore & { saved: ConnectorRecord[] } {
  const saved: ConnectorRecord[] = [];
  return {
    saved,
    save: vi.fn((record: ConnectorRecord) => saved.push(record)),
    disable: vi.fn(),
    delete: vi.fn(),
    loadAll: vi.fn(() => []),
    loadEnabled: vi.fn(() => []),
  } as unknown as ConnectorStore & { saved: ConnectorRecord[] };
}

const CRED_DIR = "/tmp/aeolus-test";
const CRED_FILE = path.join(CRED_DIR, "hue-credentials.json");
const MIGRATED_FILE = `${CRED_FILE}.migrated`;

describe("migrateLegacyHueCredentials", () => {
  beforeEach(() => {
    fs.mkdirSync(CRED_DIR, { recursive: true });
    // Clean up any leftover files
    for (const f of [CRED_FILE, MIGRATED_FILE]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  afterEach(() => {
    for (const f of [CRED_FILE, MIGRATED_FILE]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it("does nothing when credentials file does not exist", () => {
    const store = makeStore();
    migrateLegacyHueCredentials(store);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("migrates valid credentials into ConnectorStore", () => {
    const creds = { bridgeIp: "192.168.1.100", apiKey: "test-key-123" };
    fs.writeFileSync(CRED_FILE, JSON.stringify(creds));

    const store = makeStore();
    migrateLegacyHueCredentials(store);

    expect(store.save).toHaveBeenCalledOnce();
    const record = store.saved[0];
    expect(record.connectorType).toBe("hue");
    expect(record.enabled).toBe(true);
    expect(record.config).toEqual({ bridgeIp: "192.168.1.100", apiKey: "test-key-123" });
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBeGreaterThan(0);
    expect(record.updatedAt).toBe(record.createdAt);
  });

  it("renames credentials file to .migrated after successful migration", () => {
    fs.writeFileSync(CRED_FILE, JSON.stringify({ bridgeIp: "10.0.0.1", apiKey: "abc" }));

    const store = makeStore();
    migrateLegacyHueCredentials(store);

    expect(fs.existsSync(CRED_FILE)).toBe(false);
    expect(fs.existsSync(MIGRATED_FILE)).toBe(true);
  });

  it("skips migration for malformed JSON", () => {
    fs.writeFileSync(CRED_FILE, "not valid json {{{");

    const store = makeStore();
    migrateLegacyHueCredentials(store);

    expect(store.save).not.toHaveBeenCalled();
    // File should still exist (not renamed)
    expect(fs.existsSync(CRED_FILE)).toBe(true);
  });

  it("skips migration when bridgeIp is missing", () => {
    fs.writeFileSync(CRED_FILE, JSON.stringify({ apiKey: "key-only" }));

    const store = makeStore();
    migrateLegacyHueCredentials(store);

    expect(store.save).not.toHaveBeenCalled();
  });

  it("skips migration when apiKey is missing", () => {
    fs.writeFileSync(CRED_FILE, JSON.stringify({ bridgeIp: "192.168.1.1" }));

    const store = makeStore();
    migrateLegacyHueCredentials(store);

    expect(store.save).not.toHaveBeenCalled();
  });
});
