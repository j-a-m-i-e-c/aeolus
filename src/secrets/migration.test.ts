// src/secrets/migration.test.ts — staged encryption of existing secrets (H2b) against
// synthetic pre-H2 databases: older schema revisions, every MQTT mode, with and without a
// database JWT secret, interrupted before and after every stage boundary.
import type { Database as DatabaseType } from "better-sqlite3";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_CONNECTOR_MODULES, secretFieldLookup } from "../connectors/bundled.js";
import { buildSyntheticDatabase, upgradeSchema, type Fixture, type FixtureOptions } from "../__test-helpers__/secrets-fixtures.js";
import { bootstrapSecrets } from "./bootstrap.js";
import { isEnvelope } from "./envelope.js";
import { SecretsUnavailableError } from "./errors.js";
import { generateKeyring, type Keyring } from "./keyring.js";
import { collectSecretValues, locationId } from "./locations.js";
import { MIGRATION_SETTING, migrateSecrets, readMarker, type MigrationOptions, type MigrationPoint } from "./migration.js";
import { createSecretCodec } from "./secret-store.js";

const lookup = secretFieldLookup(BUNDLED_CONNECTOR_MODULES);
let root = "";
let dbPath = "";
let secretsDir = "";
let open: DatabaseType[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-migration-"));
  dbPath = path.join(root, "data", "aeolus.db");
  secretsDir = path.join(root, "secrets");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  open = [];
});
afterEach(() => {
  for (const db of open) if (db.open) db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

class Crash extends Error {}

function setup(options: FixtureOptions = {}): { db: DatabaseType; fixture: Fixture; keyring: Keyring } {
  const { db, fixture } = buildSyntheticDatabase(dbPath, options);
  open.push(db);
  upgradeSchema(db);
  const { keyring } = bootstrapSecrets(db, dbPath, lookup, { env: {} as NodeJS.ProcessEnv });
  return { db, fixture, keyring };
}

function run(db: DatabaseType, keyring: Keyring, extra: Partial<MigrationOptions> = {}) {
  return migrateSecrets(db, keyring, { lookup, checkpointDir: secretsDir, dbPath, ...extra });
}

const crashAt = (target: MigrationPoint) => (point: MigrationPoint) => { if (point === target) throw new Crash(point); };

/** Current value per location id, as stored. */
function stored(db: DatabaseType): Map<string, string> {
  return new Map(collectSecretValues(db, lookup).values.map((item) => [locationId(item.location), item.value]));
}

/** Every expected secret is stored in plaintext, unchanged. */
function expectAllPlaintext(db: DatabaseType, fixture: Fixture): void {
  const now = stored(db);
  for (const [where, value] of fixture.secrets) expect(now.get(where), where).toBe(value);
}

/** Every expected secret is an envelope at its location that decrypts to the original. */
function expectAllEncrypted(db: DatabaseType, fixture: Fixture, keyring: Keyring): void {
  const codec = createSecretCodec(keyring);
  const now = stored(db);
  expect(now.size).toBe(fixture.secrets.size);
  for (const [where, value] of fixture.secrets) {
    const envelope = now.get(where)!;
    expect(isEnvelope(envelope), where).toBe(true);
    const [kind, a, b] = where.split(":") as [string, string, string?];
    const opened = kind === "setting" ? codec.openSetting(a as "jwt_secret", envelope) : codec.openConnectorField(a, b!, envelope);
    expect(opened === value, where).toBe(true);
  }
}

/** No plaintext secret appears anywhere in the database files' bytes. */
function expectNoPlaintextInFiles(fixture: Fixture): void {
  for (const file of [dbPath, `${dbPath}-wal`]) {
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    for (const [where, value] of fixture.secrets) expect(bytes.includes(Buffer.from(value, "utf8")), `${where} in ${path.basename(file)}`).toBe(false);
  }
}

function expectFinal(db: DatabaseType, fixture: Fixture, keyring: Keyring): void {
  expectAllEncrypted(db, fixture, keyring);
  const marker = readMarker(db)!;
  expect(marker.state).toBe("encrypted");
  expect(marker.cleanedAt).toEqual(expect.any(Number));
  expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'secret_migration'").get()).toBeUndefined();
  expect(fs.existsSync(secretsDir) ? fs.readdirSync(secretsDir).filter((name) => name.startsWith("pre-secrets-")) : []).toEqual([]);
  expect((db.prepare("SELECT config FROM connectors WHERE id = ?").get(fixture.kasaId) as { config: string }).config).toBe(fixture.kasaConfig);
}

function noSecretIn(text: string, fixture: Fixture): void {
  for (const value of fixture.secrets.values()) expect(text.includes(value)).toBe(false);
}

describe("synthetic databases", () => {
  const cases: Array<[string, FixtureOptions]> = [
    ["baseline schema (1), shared password, database JWT", { schemaVersion: 1, mqttMode: "shared_password" }],
    ["schema 13, per-device credentials, database JWT", { schemaVersion: 13, mqttMode: "per_device" }],
    ["schema 19, open MQTT, external JWT_SECRET (no database JWT)", { schemaVersion: 19, mqttMode: "open", jwtInDatabase: false }],
    ["current schema, shared password, no database JWT", { mqttMode: "shared_password", jwtInDatabase: false }],
    ["current schema, per-device, database JWT", { mqttMode: "per_device" }],
  ];

  it.each(cases)("%s: every secret is encrypted in place, unchanged, and gone from the database file", (_name, options) => {
    const { db, fixture, keyring } = setup(options);
    const hashes = db.prepare("SELECT username, password_hash FROM mqtt_credentials ORDER BY username").all();
    const report = run(db, keyring);
    expect(report.outcome).toBe("migrated");
    expect(report.encrypted.settings + report.encrypted.connectorFields).toBe(fixture.secrets.size);
    expect(report.encrypted.connectorFields).toBe(3);
    expect(report.cleaned).toBe(true);
    expectFinal(db, fixture, keyring);
    // MQTT hashes are verification data, not secrets to migrate: unchanged.
    expect(db.prepare("SELECT username, password_hash FROM mqtt_credentials ORDER BY username").all()).toEqual(hashes);
    db.close();
    expectNoPlaintextInFiles(fixture);
  });

  it("is idempotent: a second run changes nothing", () => {
    const { db, fixture, keyring } = setup();
    run(db, keyring);
    const before = stored(db);
    const again = run(db, keyring);
    expect(again.outcome).toBe("already-encrypted");
    expect(again.verified).toBe(fixture.secrets.size);
    expect(stored(db)).toEqual(before);
  });

  it("a fresh database: nothing to encrypt, and it is marked encrypted so plaintext is refused from the start", () => {
    const db = new Database(dbPath);
    open.push(db);
    upgradeSchema(db);
    const { keyring } = bootstrapSecrets(db, dbPath, lookup, { env: {} as NodeJS.ProcessEnv });
    const report = run(db, keyring);
    expect(report.outcome).toBe("no-secrets");
    expect(readMarker(db)).toMatchObject({ state: "encrypted", cleanedAt: expect.any(Number) });
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('mqtt_shared_password', 'later-plaintext')").run();
    expect(() => run(db, keyring)).toThrow(/now hold plaintext/);
  });

  it("an in-memory database (no checkpoint directory) migrates the same way", () => {
    const { db, fixture } = buildSyntheticDatabase(":memory:");
    open.push(db);
    const keyring = generateKeyring();
    const report = migrateSecrets(db, keyring, { lookup, checkpointDir: null });
    expect(report.outcome).toBe("migrated");
    expectAllEncrypted(db, fixture, keyring);
  });

  it("clears the literal placeholder instead of encrypting it, and reports the location", () => {
    const { db, fixture, keyring } = setup({ placeholderConnector: true });
    const report = run(db, keyring);
    expect(report.clearedPlaceholders).toEqual([`connector ${fixture.placeholderId} field apiKey`]);
    const config = JSON.parse((db.prepare("SELECT config FROM connectors WHERE id = ?").get(fixture.placeholderId) as { config: string }).config) as Record<string, unknown>;
    expect(config).toEqual({ bridgeIp: "192.168.50.21", apiKey: "" });
  });

  it("names older copies beside the database that may still hold plaintext, and does not delete them", () => {
    const { db, keyring } = setup();
    const bak = `${dbPath}.pre-migration.2026-01-01T00-00-00-000Z.bak`;
    const hue = path.join(path.dirname(dbPath), "hue-credentials.json.migrated");
    fs.writeFileSync(bak, "x");
    fs.writeFileSync(hue, "{}");
    expect(run(db, keyring).plaintextCopies).toEqual([bak, hue].sort());
    expect(fs.existsSync(bak) && fs.existsSync(hue)).toBe(true);
  });

  it("leaves connectors of unregistered types and unreadable configs alone, and counts them", () => {
    const { db, fixture, keyring } = setup();
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES ('u', 'retired', 0, ?, 1, 1)").run(JSON.stringify({ token: "kept" }));
    db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES ('m', 'hue', 0, 'not json', 1, 1)").run();
    const report = run(db, keyring);
    expect(report.unknownConnectorTypes).toBe(1);
    expect(report.malformedConnectors).toBe(1);
    expectAllEncrypted(db, fixture, keyring);
    expect((db.prepare("SELECT config FROM connectors WHERE id = 'u'").get() as { config: string }).config).toBe(JSON.stringify({ token: "kept" }));
  });
});

describe("interruption at every boundary", () => {
  const beforeSwitch: MigrationPoint[] = ["after-checkpoint", "in-shadow", "after-shadow", "after-verify", "in-switch"];
  const afterSwitch: MigrationPoint[] = ["after-switch", "after-post-verify", "after-checkpoint-removed", "after-vacuum", "after-wal-truncate"];

  it.each(beforeSwitch)("crash at %s: every secret is still plaintext and working, nothing is marked encrypted; the restart completes it", (point) => {
    const { db, fixture, keyring } = setup();
    expect(() => run(db, keyring, { fault: crashAt(point) })).toThrow(Crash);
    expectAllPlaintext(db, fixture);
    expect(readMarker(db)?.state ?? "none").not.toBe("encrypted");
    const resumed = run(db, keyring);
    expect(resumed.outcome).toBe("migrated");
    expectFinal(db, fixture, keyring);
  });

  it.each(afterSwitch)("crash at %s: every secret is already an envelope that decrypts; the restart finishes the clean-up", (point) => {
    const { db, fixture, keyring } = setup();
    expect(() => run(db, keyring, { fault: crashAt(point) })).toThrow(Crash);
    expectAllEncrypted(db, fixture, keyring);
    expect(readMarker(db)!.state).toBe("encrypted");
    const resumed = run(db, keyring);
    expect(resumed.outcome).toBe("already-encrypted");
    expect(resumed.cleaned).toBe(true);
    expectFinal(db, fixture, keyring);
    db.close();
    expectNoPlaintextInFiles(fixture);
  });

  it("a stage-1 side table that was tampered with fails verification and keeps plaintext; the restart rebuilds it", () => {
    const { db, fixture, keyring } = setup();
    const corrupt = (point: MigrationPoint) => {
      if (point === "after-shadow") db.prepare("UPDATE secret_migration SET envelope = 'aeolus-enc:v1:kx:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA' WHERE rowid = 1").run();
    };
    const message = (() => { try { run(db, keyring, { fault: corrupt }); } catch (error) { return (error as Error).message; } return ""; })();
    expect(message).toMatch(/verification failed.*plaintext was kept/);
    noSecretIn(message, fixture);
    expectAllPlaintext(db, fixture);
    expect(run(db, keyring).outcome).toBe("migrated");
    expectFinal(db, fixture, keyring);
  });

  it("a staged row missing from the side table fails verification", () => {
    const { db, fixture, keyring } = setup();
    const drop = (point: MigrationPoint) => { if (point === "after-shadow") db.prepare("DELETE FROM secret_migration WHERE rowid = 1").run(); };
    expect(() => run(db, keyring, { fault: drop })).toThrow(/staged envelopes for/);
    expectAllPlaintext(db, fixture);
  });

  it("a secret that changes between verification and the switch stops the switch; nothing is half-switched", () => {
    const { db, fixture, keyring } = setup();
    const change = (point: MigrationPoint) => {
      if (point === "after-verify") db.prepare("UPDATE system_settings SET value = 'changed' WHERE key = 'mqtt_backend_password'").run();
    };
    expect(() => run(db, keyring, { fault: change })).toThrow(/changed during the migration/);
    const now = stored(db);
    for (const [where, value] of fixture.secrets) if (where !== "setting:mqtt_backend_password") expect(now.get(where)).toBe(value);
    expect([...now.values()].some(isEnvelope)).toBe(false);
  });

  it("after a crash past the switch, a value that no longer matches the checkpoint stops startup and keeps the checkpoint", () => {
    const { db, fixture, keyring } = setup();
    expect(() => run(db, keyring, { fault: crashAt("after-switch") })).toThrow(Crash);
    const [checkpoint] = fs.readdirSync(secretsDir).filter((name) => name.startsWith("pre-secrets-"));
    const copy = new Database(path.join(secretsDir, checkpoint!));
    copy.prepare("UPDATE system_settings SET value = 'different' WHERE key = 'mqtt_backend_password'").run();
    copy.close();
    let message = "";
    try { run(db, keyring); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/does not decrypt to its previous value; the checkpoint was kept/);
    noSecretIn(message, fixture);
    expect(fs.existsSync(path.join(secretsDir, checkpoint!))).toBe(true);
  });
});

describe("after encryption there is no plaintext fallback", () => {
  it("plaintext appearing later stops startup, naming the location but not the value", () => {
    const { db, fixture, keyring } = setup();
    run(db, keyring);
    db.prepare("UPDATE system_settings SET value = 'restored-plaintext' WHERE key = 'mqtt_backend_password'").run();
    let message = "";
    try { run(db, keyring); } catch (error) { message = (error as Error).message; expect(error).toBeInstanceOf(SecretsUnavailableError); }
    expect(message).toMatch(/setting mqtt_backend_password/);
    expect(message).toMatch(/--reencrypt-plaintext/);
    expect(message).not.toContain("restored-plaintext");
    noSecretIn(message, fixture);
  });

  it("the explicit --reencrypt-plaintext decision encrypts it", () => {
    const { db, keyring } = setup();
    run(db, keyring);
    db.prepare("UPDATE system_settings SET value = 'restored-plaintext' WHERE key = 'mqtt_backend_password'").run();
    expect(run(db, keyring, { reencryptPlaintext: true }).encrypted.settings).toBe(1);
    expect(createSecretCodec(keyring).openSetting("mqtt_backend_password", stored(db).get("setting:mqtt_backend_password")!)).toBe("restored-plaintext");
    expect(run(db, keyring).outcome).toBe("already-encrypted");
  });

  it("a modified envelope stops startup", () => {
    const { db, fixture, keyring } = setup();
    run(db, keyring);
    const envelope = stored(db).get("setting:jwt_secret")!;
    const flipped = `${envelope.slice(0, -2)}${envelope.endsWith("A") ? "B" : "A"}${envelope.slice(-1)}`;
    db.prepare("UPDATE system_settings SET value = ? WHERE key = 'jwt_secret'").run(flipped);
    let message = "";
    try { run(db, keyring); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/Setting jwt_secret cannot be decrypted/);
    noSecretIn(message, fixture);
  });

  it("an envelope swapped between the two Remote connectors stops startup", () => {
    const { db, fixture, keyring } = setup();
    run(db, keyring);
    const [a, b] = fixture.remoteIds;
    const configA = (db.prepare("SELECT config FROM connectors WHERE id = ?").get(a) as { config: string }).config;
    const configB = (db.prepare("SELECT config FROM connectors WHERE id = ?").get(b) as { config: string }).config;
    db.prepare("UPDATE connectors SET config = ? WHERE id = ?").run(configB, a);
    db.prepare("UPDATE connectors SET config = ? WHERE id = ?").run(configA, b);
    expect(() => run(db, keyring)).toThrow(/cannot be decrypted/);
  });

  it("a different keyring cannot open the database's secrets", () => {
    const { db, keyring } = setup();
    run(db, keyring);
    expect(() => run(db, { ...generateKeyring(), installationId: keyring.installationId })).toThrow(/does not hold|cannot be decrypted/);
  });

  it("a malformed migration marker stops startup", () => {
    const { db, keyring } = setup();
    db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run(MIGRATION_SETTING, "{bad");
    expect(() => run(db, keyring)).toThrow(/marker is not valid JSON/);
    db.prepare("UPDATE system_settings SET value = ? WHERE key = ?").run(JSON.stringify({ version: 2 }), MIGRATION_SETTING);
    expect(() => run(db, keyring)).toThrow(/marker is malformed/);
  });
});
