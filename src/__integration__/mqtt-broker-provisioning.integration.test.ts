// src/__integration__/mqtt-broker-provisioning.integration.test.ts
//
// Proves MQTT provisioning against a REAL Eclipse Mosquitto 2.x broker.
//
// This is the acceptance test for the "Prove MQTT provisioning against the real
// broker" backlog item. It exercises the exact code paths the backend uses to
// hash credentials and write the Mosquitto password file (native `$7$`
// sha512-pbkdf2 — no mosquitto_passwd, no Docker socket), then connects real
// MQTT clients to a broker that authenticates against that file and asserts:
//
//   1. anonymous access is rejected,
//   2. the backend credential authenticates,
//   3. a device credential authenticates and survives a backend restart
//      (password file regenerated from the persisted `$7$` hashes), and
//   4. a revoked credential stops working.
//
// The broker runs in a throwaway `eclipse-mosquitto:2` container. Config and
// password files are pushed in with `docker cp` (avoiding host bind-mount
// permission quirks) and reloads are triggered with SIGHUP. The whole suite is
// skipped automatically when Docker is unavailable.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import mqtt from "mqtt";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

// ─── Database mock: an in-memory SQLite the credential service writes to ─────

let testDb: DatabaseType;
vi.mock("../db/database.js", () => ({
  getDatabase: () => testDb,
}));

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Imported after mocks so the credential service binds to the mocked database.
const {
  ensureBackendCredential,
  createCredential,
  deleteCredential,
  regeneratePasswordFile,
  getPasswordFilePath,
} = await import("../auth/mqtt-credential-service.js");

// ─── Docker / broker helpers ─────────────────────────────────────────────────

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const DOCKER = dockerAvailable();
const describeBroker = DOCKER ? describe : describe.skip;

const CONTAINER = `aeolus-itest-mosq-${Date.now()}`;
const BROKER_CONFIG_PATH = "/mosquitto/config/mosquitto.conf";
const BROKER_PWFILE_PATH = "/mosquitto/config/password_file";

function docker(args: string[], timeout = 30_000): string {
  return execFileSync("docker", args, { encoding: "utf-8", stdio: "pipe", timeout });
}

function dockerQuiet(args: string[]): void {
  try {
    docker(args);
  } catch {
    /* ignore */
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Attempt a single connection; resolves true on CONNACK success, false otherwise. */
function tryConnect(
  port: number,
  credentials: { username?: string; password?: string },
  timeoutMs = 6000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      ...credentials,
      reconnectPeriod: 0,
      connectTimeout: timeoutMs,
    });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      client.end(true, () => resolve(result));
    };
    client.on("connect", () => finish(true));
    client.on("error", () => finish(false));
    client.on("close", () => finish(false));
    setTimeout(() => finish(false), timeoutMs + 500);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Copy the host password file into the running broker and SIGHUP it to reload. */
async function syncPasswordFileAndReload(): Promise<void> {
  docker(["cp", getPasswordFilePath(), `${CONTAINER}:${BROKER_PWFILE_PATH}`]);
  docker(["kill", "--signal=HUP", CONTAINER]);
  await sleep(1200); // give Mosquitto time to re-read the file
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let brokerPort: number;
let tempDir: string;
let backendCred: { username: string; password: string };
let deviceCred: { id: string; username: string; password: string };

describeBroker("MQTT provisioning against a real Mosquitto broker", () => {
  // Connecting real clients + reloading the broker takes longer than the
  // default per-test timeout.
  vi.setConfig({ testTimeout: 30_000 });

  beforeAll(async () => {
    // Keep PBKDF2 cheap enough for fast generation while still exercising the
    // real KDF the broker verifies against.
    process.env.MQTT_PBKDF2_ITERATIONS = "1000";
    process.env.MQTT_RELOAD_STRATEGY = "none"; // the test drives reloads itself

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-broker-itest-"));
    process.env.MQTT_PASSWORD_FILE = path.join(tempDir, "password_file");

    // In-memory DB with just the tables the credential service touches.
    testDb = new Database(":memory:");
    testDb.exec(`
      CREATE TABLE mqtt_credentials (
        id TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);

    // Seed credentials the way the app does, then materialise the password file.
    const backend = await ensureBackendCredential();
    backendCred = { username: backend.username, password: backend.password };
    const device = await createCredential("Test Sensor");
    deviceCred = { id: device.id, username: device.username, password: device.password };
    regeneratePasswordFile(); // writes backend + device as `$7$` lines

    // Authenticated broker config (directive uses the broker-internal path).
    const confPath = path.join(tempDir, "mosquitto.conf");
    fs.writeFileSync(
      confPath,
      [
        "listener 1883",
        "allow_anonymous false",
        `password_file ${BROKER_PWFILE_PATH}`,
        "persistence false",
        "log_dest stdout",
        "",
      ].join("\n"),
      "utf-8",
    );

    brokerPort = await getFreePort();

    // Pull first so a slow image fetch doesn't blow the create/start timeout.
    docker(["pull", "eclipse-mosquitto:2"], 180_000);
    dockerQuiet(["rm", "-f", CONTAINER]);
    docker([
      "create",
      "--name",
      CONTAINER,
      "-p",
      `${brokerPort}:1883`,
      "eclipse-mosquitto:2",
    ]);
    docker(["cp", confPath, `${CONTAINER}:${BROKER_CONFIG_PATH}`]);
    docker(["cp", getPasswordFilePath(), `${CONTAINER}:${BROKER_PWFILE_PATH}`]);
    docker(["start", CONTAINER]);

    // Wait until the broker accepts the backend credential.
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await tryConnect(brokerPort, backendCred, 2000);
      if (!ready) await sleep(500);
    }
    if (!ready) {
      const logs = (() => {
        try {
          return docker(["logs", CONTAINER]);
        } catch {
          return "(no logs)";
        }
      })();
      throw new Error(`Broker did not become ready. Logs:\n${logs}`);
    }
  }, 240_000);

  afterAll(() => {
    dockerQuiet(["rm", "-f", CONTAINER]);
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    testDb?.close();
    delete process.env.MQTT_PASSWORD_FILE;
    delete process.env.MQTT_PBKDF2_ITERATIONS;
    delete process.env.MQTT_RELOAD_STRATEGY;
  });

  it("rejects anonymous connections", async () => {
    expect(await tryConnect(brokerPort, {})).toBe(false);
  });

  it("rejects a wrong password for a known user", async () => {
    expect(
      await tryConnect(brokerPort, { username: backendCred.username, password: "wrong" }),
    ).toBe(false);
  });

  it("accepts the backend credential", async () => {
    expect(await tryConnect(brokerPort, backendCred)).toBe(true);
  });

  it("accepts a provisioned device credential", async () => {
    expect(await tryConnect(brokerPort, deviceCred)).toBe(true);
  });

  it("device credentials survive a backend restart (file regenerated from stored hashes)", async () => {
    // Simulate a backend restart: wipe the on-disk file, then rebuild it purely
    // from the persisted `$7$` hashes in the database (no plaintext available).
    fs.rmSync(getPasswordFilePath(), { force: true });
    regeneratePasswordFile();
    await syncPasswordFileAndReload();

    expect(await tryConnect(brokerPort, deviceCred)).toBe(true);
    expect(await tryConnect(brokerPort, backendCred)).toBe(true);
  });

  it("stops accepting a revoked device credential", async () => {
    deleteCredential(deviceCred.id); // regenerates the file without the device
    await syncPasswordFileAndReload();

    expect(await tryConnect(brokerPort, deviceCred)).toBe(false);
    // The backend credential must still work after a revoke.
    expect(await tryConnect(brokerPort, backendCred)).toBe(true);
  });
});
