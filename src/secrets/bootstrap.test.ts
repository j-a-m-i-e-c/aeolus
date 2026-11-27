// src/secrets/bootstrap.test.ts — the startup decision: create a keyring only for a
// database that never had one; refuse a missing or different keyring for one that did;
// refuse (until `adopt`) a database without a binding once the keyring has been bound.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSchema } from "../db/database.js";
import { BUNDLED_CONNECTOR_MODULES, secretFieldLookup } from "../connectors/bundled.js";
import { bindingFor, decideBootstrap, readBinding, scanEnvelopes, SecretsBindingError, writeBinding, BINDING_SETTING } from "./binding.js";
import { adoptDatabase, bootstrapSecrets, resolveSecretsPaths, SecretsUnavailableError, type BootstrapPoint } from "./bootstrap.js";
import { connectorContext, sealSecret, settingContext } from "./envelope.js";
import { activeKey, createKeyringExclusive, generateKeyring, loadKeyring } from "./keyring.js";

const lookup = secretFieldLookup(BUNDLED_CONNECTOR_MODULES);
let root = "";
let dbPath = "";
let db: Database.Database;
const env = (extra: Record<string, string> = {}) => ({ ...extra }) as NodeJS.ProcessEnv;
const boot = (fault?: (point: BootstrapPoint) => void) => bootstrapSecrets(db, dbPath, lookup, { env: env(), fault });

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
const keyringText = () => fs.readFileSync(keyringFile(), "utf8");

function refused(work: () => unknown): string {
  try { work(); } catch (error) { if (error instanceof SecretsUnavailableError) return error.message; throw error; }
  throw new Error("expected startup to be refused");
}

class Crash extends Error {}
const crashAt = (target: BootstrapPoint) => (point: BootstrapPoint) => { if (point === target) throw new Crash(point); };

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

describe("first boot", () => {
  it("a genuinely new installation: creates a keyring, binds the database, and records the binding in the keyring", () => {
    const result = boot();
    expect(result.outcome).toBe("create-keyring-and-bind");
    const ring = loadKeyring(keyringFile());
    expect(ring.installationId).toBe(result.keyring.installationId);
    expect(ring.boundAt).toEqual(expect.any(Number));
    expect(readBinding(db)).toEqual(bindingFor(result.keyring));
  });

  it("a legacy (pre-H2) installation upgraded for the first time: same as new, with its plaintext untouched by the bootstrap", () => {
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('jwt_secret', 'legacy-plaintext')").run();
    expect(boot().outcome).toBe("create-keyring-and-bind");
    // Encryption is the migration's job (migration.test.ts); the bootstrap only binds.
    expect((db.prepare("SELECT value FROM system_settings WHERE key = 'jwt_secret'").get() as { value: string }).value).toBe("legacy-plaintext");
  });

  it("a keyring created or restored before the first start (never bound): binds to it and never replaces it", () => {
    const ring = generateKeyring();
    createKeyringExclusive(keyringFile(), ring);
    const result = boot();
    expect(result.outcome).toBe("bind-existing-keyring");
    expect(result.keyring.installationId).toBe(ring.installationId);
    expect(loadKeyring(keyringFile()).keys[0]!.key).toBe(ring.keys[0]!.key);
    expect(loadKeyring(keyringFile()).boundAt).toEqual(expect.any(Number));
  });
});

describe("normal restart", () => {
  it("an already-bound installation: ready, and the keyring file is not rewritten", () => {
    boot();
    const before = keyringText();
    expect(boot().outcome).toBe("ready");
    expect(keyringText()).toBe(before);
  });

  it("an H2a keyring (bound database, no boundAt yet) gains boundAt on its next start", () => {
    const ring = generateKeyring();
    createKeyringExclusive(keyringFile(), ring);
    writeBinding(db, bindingFor(ring));
    expect(boot().outcome).toBe("ready");
    expect(loadKeyring(keyringFile()).boundAt).toEqual(expect.any(Number));
  });
});

describe("restored older database", () => {
  it("lost its binding while the bound keyring remains: refused, nothing changed, and it is not treated as new", () => {
    boot();
    db.prepare("DELETE FROM system_settings WHERE key = ?").run(BINDING_SETTING);
    const before = keyringText();
    const message = refused(() => boot());
    expect(message).toMatch(/records no binding/);
    expect(message).toMatch(/aeolus-secrets adopt --db/);
    expect(readBinding(db)).toBeNull();
    expect(keyringText()).toBe(before);
  });

  it("adopt binds it explicitly; the next start is ready", () => {
    const first = boot().keyring;
    db.prepare("DELETE FROM system_settings WHERE key = ?").run(BINDING_SETTING);
    const adopted = adoptDatabase(db, keyringFile(), lookup);
    expect(adopted.installationId).toBe(first.installationId);
    expect(readBinding(db)).toEqual(bindingFor(first));
    expect(boot().outcome).toBe("ready");
  });

  it("adopt refuses a database that is already bound, bound elsewhere, or holds envelopes without a binding", () => {
    const ring = boot().keyring;
    expect(() => adoptDatabase(db, keyringFile(), lookup)).toThrow(/already bound to this keyring/);
    writeBinding(db, bindingFor(generateKeyring()));
    expect(() => adoptDatabase(db, keyringFile(), lookup)).toThrow(/different installation/);
    db.prepare("DELETE FROM system_settings WHERE key = ?").run(BINDING_SETTING);
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run("jwt_secret", sealSecret("s", activeKey(ring), "setting-secret", settingContext("jwt_secret")));
    expect(() => adoptDatabase(db, keyringFile(), lookup)).toThrow(/cannot be adopted/);
    expect(() => adoptDatabase(db, path.join(root, "none.json"), lookup)).toThrow(/no keyring/);
  });
});

describe("missing, corrupt or mismatched keyring", () => {
  it("bound database with its keyring missing: refuses, and does not create one", () => {
    boot();
    fs.rmSync(keyringFile());
    expect(refused(() => boot())).toMatch(/bound to a keyring that is missing.*never generated/s);
    expect(fs.existsSync(keyringFile())).toBe(false);
  });

  it("corrupt keyring: refuses without replacing it", () => {
    boot();
    fs.writeFileSync(keyringFile(), "{ not json", { mode: 0o600 });
    expect(refused(() => boot())).toMatch(/malformed/);
    expect(keyringText()).toBe("{ not json");
  });

  it("bound database with a different installation's keyring: refuses", () => {
    boot();
    fs.rmSync(keyringFile());
    createKeyringExclusive(keyringFile(), generateKeyring());
    expect(refused(() => boot())).toMatch(/different installation/);
  });

  it("bound database with the right installation but different key material: refuses, naming the key id", () => {
    const first = boot().keyring;
    fs.rmSync(keyringFile());
    const forged = { ...first, keys: [{ ...first.keys[0]!, key: generateKeyring().keys[0]!.key }] };
    createKeyringExclusive(keyringFile(), forged);
    expect(refused(() => boot())).toContain(first.keys[0]!.id);
  });

  it("envelopes with no binding: refuses rather than guess", () => {
    const ring = generateKeyring();
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run("jwt_secret", sealSecret("s", activeKey(ring), "setting-secret", settingContext("jwt_secret")));
    expect(refused(() => boot())).toMatch(/no keyring binding/);
    expect(fs.existsSync(keyringFile())).toBe(false);
  });

  it("an unreadable binding refuses", () => {
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run(BINDING_SETTING, "{not json");
    expect(refused(() => boot())).toMatch(/not valid JSON/);
    db.prepare("UPDATE system_settings SET value = ? WHERE key = ?").run(JSON.stringify({ installationId: "x", keys: [] }), BINDING_SETTING);
    expect(() => readBinding(db)).toThrow(SecretsBindingError);
  });
});

describe("crash between keyring creation and binding", () => {
  it("after the keyring is created, before the binding commits: the next start binds that same keyring", () => {
    expect(() => boot(crashAt("after-keyring-created"))).toThrow(Crash);
    const created = loadKeyring(keyringFile());
    expect(created.boundAt).toBeUndefined();
    expect(readBinding(db)).toBeNull();
    const result = boot();
    expect(result.outcome).toBe("bind-existing-keyring");
    expect(result.keyring.keys[0]!.key).toBe(created.keys[0]!.key);
    expect(loadKeyring(keyringFile()).boundAt).toEqual(expect.any(Number));
  });

  it("after the binding commits, before the keyring records it: the next start is ready and records it", () => {
    expect(() => boot(crashAt("after-binding-committed"))).toThrow(Crash);
    expect(readBinding(db)).not.toBeNull();
    expect(loadKeyring(keyringFile()).boundAt).toBeUndefined();
    expect(boot().outcome).toBe("ready");
    expect(loadKeyring(keyringFile()).boundAt).toEqual(expect.any(Number));
  });

  it("cleans a temporary file left by an interrupted keyring write before deciding", () => {
    fs.mkdirSync(path.join(root, "secrets"), { recursive: true });
    fs.writeFileSync(path.join(root, "secrets", ".keyring.9.ff.tmp"), "partial");
    expect(boot().outcome).toBe("create-keyring-and-bind");
    expect(fs.readdirSync(path.join(root, "secrets")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("decision table and envelope scan", () => {
  it("counts envelopes in secret locations, with their key ids", () => {
    const ring = generateKeyring();
    const key = activeKey(ring);
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)")
      .run("c1", "hue", JSON.stringify({ bridgeIp: "10.0.0.2", apiKey: sealSecret("k", key, "connector-secret", connectorContext("c1", "apiKey")) }));
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run("mqtt_shared_password", sealSecret("p", key, "setting-secret", settingContext("mqtt_shared_password")));
    writeBinding(db, bindingFor(ring));
    expect(scanEnvelopes(db, lookup)).toEqual({ count: 2, keyIds: [key.id] });
    expect(decideBootstrap(readBinding(db), scanEnvelopes(db, lookup), { ...ring, boundAt: 1 })).toEqual({ action: "ready" });
    // A keyring missing a key the envelopes use is refused even if the binding lists only others.
    const partial = { ...ring, keys: [{ ...ring.keys[0]!, id: "other" }] };
    expect(decideBootstrap({ installationId: ring.installationId, keys: [] }, scanEnvelopes(db, lookup), partial).action).toBe("refuse");
  });

  it("ignores envelope-looking text in non-secret fields (an admin cannot block startup with it) but counts unknown connector types", () => {
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)")
      .run("c1", "hue", JSON.stringify({ bridgeIp: "aeolus-enc:v1:fake:AAAA:BBBB" }));
    expect(scanEnvelopes(db, lookup).count).toBe(0);
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)")
      .run("c2", "retired", JSON.stringify({ token: "aeolus-enc:v1:kold:AAAA:BBBB" }));
    expect(scanEnvelopes(db, lookup)).toEqual({ count: 1, keyIds: ["kold"] });
  });
});
