// src/secrets/bootstrap.test.ts — the startup decision: create a keyring only for a
// database that never had one; refuse a missing or different keyring for one that did.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSchema } from "../db/database.js";
import { bindingFor, decideBootstrap, readBinding, scanEnvelopes, SecretsBindingError, writeBinding, BINDING_SETTING } from "./binding.js";
import { bootstrapSecrets, resolveSecretsPaths, SecretsUnavailableError } from "./bootstrap.js";
import { connectorContext, sealSecret, settingContext } from "./envelope.js";
import { activeKey, createKeyringExclusive, generateKeyring, loadKeyring } from "./keyring.js";

let root = "";
let dbPath = "";
let db: Database.Database;
const env = (extra: Record<string, string> = {}) => ({ ...extra }) as NodeJS.ProcessEnv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-bootstrap-"));
  dbPath = path.join(root, "data", "aeolus.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  initSchema(db);
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const keyringFile = () => path.join(root, "secrets", "keyring.json");

function refused(work: () => unknown): string {
  try { work(); } catch (error) { if (error instanceof SecretsUnavailableError) return error.message; throw error; }
  throw new Error("expected startup to be refused");
}

describe("paths", () => {
  it("puts the keyring beside the database directory by default", () => {
    expect(resolveSecretsPaths("/app/data/aeolus.db", env())).toEqual({ dir: path.resolve("/app/secrets"), keyringFile: path.resolve("/app/secrets/keyring.json") });
    expect(resolveSecretsPaths(dbPath, env({ AEOLUS_SECRETS_DIR: path.join(root, "s") })).keyringFile).toBe(path.join(root, "s", "keyring.json"));
    expect(resolveSecretsPaths(dbPath, env({ AEOLUS_KEYRING_FILE: path.join(root, "k.json") })).keyringFile).toBe(path.join(root, "k.json"));
  });

  it("refuses a keyring inside the database directory, which database backups copy", () => {
    expect(() => resolveSecretsPaths(dbPath, env({ AEOLUS_SECRETS_DIR: path.join(root, "data") }))).toThrow(SecretsUnavailableError);
    expect(() => resolveSecretsPaths(dbPath, env({ AEOLUS_KEYRING_FILE: path.join(root, "data", "keys", "k.json") }))).toThrow(/must not be inside the database directory/);
  });
});

describe("startup decision", () => {
  it("fresh database: creates a keyring and binds to it", () => {
    const result = bootstrapSecrets(db, dbPath, env());
    expect(result.outcome).toBe("create-keyring-and-bind");
    expect(loadKeyring(keyringFile()).installationId).toBe(result.keyring.installationId);
    expect(readBinding(db)).toEqual(bindingFor(result.keyring));
    // The next start is ready, with the same keyring.
    expect(bootstrapSecrets(db, dbPath, env()).outcome).toBe("ready");
  });

  it("database without a binding and an existing keyring: binds to it, never replaces it", () => {
    const ring = generateKeyring();
    createKeyringExclusive(keyringFile(), ring);
    const result = bootstrapSecrets(db, dbPath, env());
    expect(result.outcome).toBe("bind-existing-keyring");
    expect(result.keyring.installationId).toBe(ring.installationId);
    expect(loadKeyring(keyringFile()).keys[0]!.key).toBe(ring.keys[0]!.key);
  });

  it("bound database with its keyring missing: refuses, and does not create one", () => {
    bootstrapSecrets(db, dbPath, env());
    fs.rmSync(keyringFile());
    expect(refused(() => bootstrapSecrets(db, dbPath, env()))).toMatch(/bound to a keyring that is missing.*never generated/s);
    expect(fs.existsSync(keyringFile())).toBe(false);
  });

  it("bound database with a different keyring: refuses", () => {
    bootstrapSecrets(db, dbPath, env());
    fs.rmSync(keyringFile());
    createKeyringExclusive(keyringFile(), generateKeyring());
    expect(refused(() => bootstrapSecrets(db, dbPath, env()))).toMatch(/different installation/);
  });

  it("bound database with the right installation but different key material: refuses, naming the key id", () => {
    const first = bootstrapSecrets(db, dbPath, env()).keyring;
    fs.rmSync(keyringFile());
    const forged = { ...first, keys: [{ ...first.keys[0]!, key: generateKeyring().keys[0]!.key }] };
    createKeyringExclusive(keyringFile(), forged);
    expect(refused(() => bootstrapSecrets(db, dbPath, env()))).toContain(first.keys[0]!.id);
  });

  it("envelopes with no binding: refuses rather than guess", () => {
    const ring = generateKeyring();
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run("jwt_secret", sealSecret("s", activeKey(ring), "setting-secret", settingContext("jwt_secret")));
    expect(refused(() => bootstrapSecrets(db, dbPath, env()))).toMatch(/no keyring binding/);
    expect(fs.existsSync(keyringFile())).toBe(false);
  });

  it("an unreadable binding or an insecure keyring refuses", () => {
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run(BINDING_SETTING, "{not json");
    expect(refused(() => bootstrapSecrets(db, dbPath, env()))).toMatch(/not valid JSON/);
    db.prepare("UPDATE system_settings SET value = ? WHERE key = ?").run(JSON.stringify({ installationId: "x", keys: [] }), BINDING_SETTING);
    expect(() => readBinding(db)).toThrow(SecretsBindingError);
  });

  it("cleans a temporary file left by an interrupted keyring write before deciding", () => {
    fs.mkdirSync(path.join(root, "secrets"), { recursive: true });
    fs.writeFileSync(path.join(root, "secrets", ".keyring.9.ff.tmp"), "partial");
    expect(bootstrapSecrets(db, dbPath, env()).outcome).toBe("create-keyring-and-bind");
    expect(fs.readdirSync(path.join(root, "secrets")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("decision table and envelope scan", () => {
  it("counts envelopes in connector configs and settings, with their key ids", () => {
    const ring = generateKeyring();
    const key = activeKey(ring);
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)")
      .run("c1", "hue", JSON.stringify({ bridgeIp: "10.0.0.2", apiKey: sealSecret("k", key, "connector-secret", connectorContext("c1", "apiKey")) }));
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run("mqtt_shared_password", sealSecret("p", key, "setting-secret", settingContext("mqtt_shared_password")));
    writeBinding(db, bindingFor(ring));
    expect(scanEnvelopes(db)).toEqual({ count: 2, keyIds: [key.id] });
    expect(decideBootstrap(readBinding(db), scanEnvelopes(db), ring)).toEqual({ action: "ready" });
    // A keyring missing a key the envelopes use is refused even if the binding lists only others.
    const partial = { ...ring, keys: [{ ...ring.keys[0]!, id: "other" }] };
    expect(decideBootstrap({ installationId: ring.installationId, keys: [] }, scanEnvelopes(db), partial).action).toBe("refuse");
  });
});
