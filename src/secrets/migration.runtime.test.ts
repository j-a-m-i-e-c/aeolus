// src/secrets/migration.runtime.test.ts — after H2b's startup migration, the services that
// use secrets keep working with the same values, and none of their write paths puts a
// plaintext secret back into SQLite.
import type { Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import jwt from "jsonwebtoken";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_CONNECTOR_MODULES, secretFieldLookup } from "../connectors/bundled.js";
import { ConnectorStore } from "../connectors/connector-store.js";
import { ConnectorConfigError, PASSWORD_MASK, redactConfig, resolveConfigUpdate } from "../connectors/connector-config.js";
import * as hueModule from "../connectors/hue/index.js";
import { verifyMosquittoPassword } from "../mqtt/mosquitto-password-hash.js";
import type { MosquittoConfigWriter } from "../mqtt/mosquitto-config-writer.js";
import type { MosquittoReloader } from "../mqtt/mosquitto-reloader.js";
import type { MqttService } from "../mqtt/mqtt-service.js";
import { buildSyntheticDatabase, upgradeSchema, type Fixture, type FixtureOptions } from "../__test-helpers__/secrets-fixtures.js";
import { isEnvelope } from "./envelope.js";
import { SecretsUnavailableError } from "./errors.js";
import { collectSecretValues } from "./locations.js";
import { readSecretSetting, secretCodec, installSecretCodec, type SecretCodec } from "./secret-store.js";
import { startSecrets } from "./startup.js";

let testDb: DatabaseType;
vi.mock("../db/database.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/database.js")>()),
  getDatabase: () => testDb,
}));

const { getSecret, verifyAccessToken, _resetSecretCache } = await import("../auth/token-service.js");
const { ensureBackendCredential } = await import("../auth/mqtt-credential-service.js");
const { MqttProvisioningService } = await import("../mqtt/mqtt-provisioning-service.js");

const lookup = secretFieldLookup(BUNDLED_CONNECTOR_MODULES);
let root = "";
let dbPath = "";
let passwordFile = "";
let fixture: Fixture;
let testCodec: SecretCodec;

function setup(options: FixtureOptions = {}): void {
  const built = buildSyntheticDatabase(dbPath, options);
  testDb = built.db;
  fixture = built.fixture;
  upgradeSchema(testDb);
}

const start = () => startSecrets(testDb, dbPath, lookup, {} as NodeJS.ProcessEnv);

beforeEach(() => {
  testCodec = secretCodec();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-h2b-runtime-"));
  dbPath = path.join(root, "data", "aeolus.db");
  passwordFile = path.join(root, "mosquitto", "password_file");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  vi.stubEnv("MQTT_PASSWORD_FILE", passwordFile);
  vi.stubEnv("JWT_SECRET", "");
  delete process.env.JWT_SECRET;
  _resetSecretCache();
});

afterEach(() => {
  if (testDb?.open) testDb.close();
  installSecretCodec(testCodec);
  vi.unstubAllEnvs();
  _resetSecretCache();
  fs.rmSync(root, { recursive: true, force: true });
});

function provisioning(): { service: InstanceType<typeof MqttProvisioningService>; credentials: Array<{ username: string; password: string } | null> } {
  const credentials: Array<{ username: string; password: string } | null> = [];
  const mqtt = { setCredentials: (c: { username: string; password: string } | null) => credentials.push(c), isConnected: () => true, reconnectWithCredentials: async () => undefined } as unknown as MqttService;
  const writer = { writeOpenConfig: () => undefined, writeAuthenticatedConfig: () => undefined } as unknown as MosquittoConfigWriter;
  const reloader = { reload: async () => undefined } as unknown as MosquittoReloader;
  return { service: new MqttProvisioningService(mqtt, writer, reloader), credentials };
}

function passwordLines(): Map<string, string> {
  return new Map(fs.readFileSync(passwordFile, "utf8").trim().split("\n").map((line) => {
    const at = line.indexOf(":");
    return [line.slice(0, at), line.slice(at + 1)] as [string, string];
  }));
}

/** Plaintext values that must never appear in the database files. */
function expectNotInFiles(values: string[]): void {
  testDb.pragma("wal_checkpoint(PASSIVE)");
  for (const file of [dbPath, `${dbPath}-wal`]) {
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    for (const value of values) expect(bytes.includes(Buffer.from(value, "utf8")), path.basename(file)).toBe(false);
  }
}

describe("services after the migration", () => {
  it("dashboard sessions signed before the upgrade still verify", () => {
    setup();
    const before = jwt.sign({ userId: "u1", username: "admin", role: "admin", groupId: null }, fixture.secrets.get("setting:jwt_secret")!, { algorithm: "HS256", expiresIn: "15m" });
    expect(start().migration.outcome).toBe("migrated");
    expect(verifyAccessToken(before)).toMatchObject({ userId: "u1", role: "admin" });
  });

  it("an external JWT_SECRET stays authoritative, and the database copy is still encrypted for a later switch", () => {
    setup();
    vi.stubEnv("JWT_SECRET", "external-secret-value");
    start();
    expect(getSecret()).toBe("external-secret-value");
    expect(readSecretSetting(testDb, "jwt_secret")).toBe(fixture.secrets.get("setting:jwt_secret"));
  });

  it("MQTT in shared mode reconnects with the same credentials: the password file verifies the original passwords", async () => {
    setup({ mqttMode: "shared_password" });
    start();
    const { service, credentials } = provisioning();
    await service.initialize();
    const lines = passwordLines();
    expect(verifyMosquittoPassword(fixture.secrets.get("setting:mqtt_shared_password")!, lines.get("aeolus-shared")!)).toBe(true);
    expect(verifyMosquittoPassword(fixture.secrets.get("setting:mqtt_backend_password")!, lines.get("aeolus-backend")!)).toBe(true);
    expect(credentials.at(-1)).toEqual({ username: "aeolus-backend", password: fixture.secrets.get("setting:mqtt_backend_password") });
    expect(service.getStatus().sharedCredential?.password).toBe(fixture.secrets.get("setting:mqtt_shared_password"));
  });

  it("MQTT in per-device mode keeps every device hash", async () => {
    setup({ mqttMode: "per_device" });
    start();
    await provisioning().service.initialize();
    const hashes = [...passwordLines().values()];
    for (const hash of fixture.deviceHashes) expect(hashes).toContain(hash);
  });

  it("Hue and both Remote connectors load with their original keys; Kasa is unchanged", () => {
    setup();
    start();
    const records = new ConnectorStore(testDb, lookup).loadEnabled();
    const byId = new Map(records.map((record) => [record.id, record]));
    expect(byId.get(fixture.hueId)!.config.apiKey).toBe(fixture.secrets.get(`connector:${fixture.hueId}:apiKey`));
    for (const id of fixture.remoteIds) expect(byId.get(id)!.config.apiKey).toBe(fixture.secrets.get(`connector:${id}:apiKey`));
    expect(JSON.stringify(byId.get(fixture.kasaId)!.config)).toBe(fixture.kasaConfig);
  });

  it("the ******** editing contract holds: the mask keeps the stored key, and is refused where none is stored", () => {
    setup({ placeholderConnector: true });
    start();
    const store = new ConnectorStore(testDb, lookup);
    const hue = store.loadAll().find((record) => record.id === fixture.hueId)!;
    expect(redactConfig(hue.config, hueModule).apiKey).toBe(PASSWORD_MASK);
    hue.config = resolveConfigUpdate(hue.config, { apiKey: PASSWORD_MASK, bridgeIp: "192.168.50.99" }, hueModule);
    store.save(hue);
    const reloaded = store.loadAll().find((record) => record.id === fixture.hueId)!;
    expect(reloaded.config).toEqual({ bridgeIp: "192.168.50.99", apiKey: fixture.secrets.get(`connector:${fixture.hueId}:apiKey`) });
    const cleared = store.loadAll().find((record) => record.id === fixture.placeholderId)!;
    expect(() => resolveConfigUpdate(cleared.config, { apiKey: PASSWORD_MASK }, hueModule)).toThrow(ConnectorConfigError);
  });

  it("restarts are stable: no re-encryption, the same envelopes, the same values", () => {
    setup();
    start();
    const first = collectSecretValues(testDb, lookup).values.map((item) => item.value);
    for (let i = 0; i < 3; i += 1) expect(start().migration.outcome).toBe("already-encrypted");
    expect(collectSecretValues(testDb, lookup).values.map((item) => item.value)).toEqual(first);
  });
});

describe("no write path stores plaintext after the cutover", () => {
  it("connector edits, MQTT rotation, backend credential regeneration and JWT initialisation all write envelopes", async () => {
    setup({ mqttMode: "shared_password", jwtInDatabase: false });
    start();
    const written: string[] = [];

    const store = new ConnectorStore(testDb, lookup);
    const remote = store.loadAll().find((record) => record.id === fixture.remoteIds[0])!;
    remote.config = { ...remote.config, apiKey: "aeo_0123456789abcdef_rotated-remote-key-value-000000000000" };
    written.push(remote.config.apiKey as string);
    store.save(remote);

    await provisioning().service.initialize();
    const rotated = await provisioning().service.regenerateSharedPassword();
    written.push(rotated.password);
    expect(verifyMosquittoPassword(rotated.password, passwordLines().get("aeolus-shared")!)).toBe(true);

    const backend = await ensureBackendCredential();
    written.push(backend.password);

    const generated = getSecret();
    written.push(generated);

    const values = collectSecretValues(testDb, lookup).values;
    expect(values.every((item) => isEnvelope(item.value))).toBe(true);
    expect(readSecretSetting(testDb, "mqtt_shared_password")).toBe(rotated.password);
    expect(readSecretSetting(testDb, "mqtt_backend_password")).toBe(backend.password);
    expect(readSecretSetting(testDb, "jwt_secret")).toBe(generated);
    expectNotInFiles([...written, ...fixture.secrets.values()]);
  });
});

describe("after the cutover, the wrong or missing keyring fails closed", () => {
  it("a missing keyring stops startup and installs no codec", () => {
    setup();
    start();
    fs.rmSync(path.join(root, "secrets", "keyring.json"));
    expect(() => start()).toThrow(SecretsUnavailableError);
    expect(() => secretCodec()).toThrow(/keyring has not been loaded/);
    expect(() => readSecretSetting(testDb, "jwt_secret")).toThrow(SecretsUnavailableError);
  });

  it("a keyring from another installation stops startup, naming no secret", () => {
    setup();
    start();
    const other = path.join(root, "other");
    fs.mkdirSync(path.join(other, "data"), { recursive: true });
    const { db } = buildSyntheticDatabase(path.join(other, "data", "aeolus.db"));
    startSecrets(db, path.join(other, "data", "aeolus.db"), lookup, {} as NodeJS.ProcessEnv);
    db.close();
    fs.copyFileSync(path.join(other, "secrets", "keyring.json"), path.join(root, "secrets", "keyring.json"));
    let message = "";
    try { start(); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/different installation/);
    for (const value of fixture.secrets.values()) expect(message.includes(value)).toBe(false);
  });
});
