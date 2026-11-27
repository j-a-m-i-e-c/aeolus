// src/__test-helpers__/secrets-fixtures.ts — synthetic pre-H2 databases for the secrets
// migration tests (H2b). Every credential is random and generated per test; none is real.
//
// A fixture is built at a chosen schema version (older revisions included), with the
// secrets an installation of that era stores in plaintext:
//   - jwt_secret (when the installation did not supply JWT_SECRET)
//   - mqtt_backend_password, and in shared_password mode mqtt_shared_password
//   - a Hue connector (apiKey), a Kasa connector (no secrets), two Aeolus Remote
//     connectors (apiKey), optionally one Hue connector holding the literal placeholder
// plus per-device MQTT credentials as `$7$` hashes (verification only, never migrated).

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { hashMosquittoPassword } from "../mqtt/mosquitto-password-hash.js";

export type MqttMode = "open" | "shared_password" | "per_device";

export interface FixtureOptions {
  schemaVersion?: number;
  mqttMode?: MqttMode;
  /** Store a database JWT secret (an installation without JWT_SECRET). Default true. */
  jwtInDatabase?: boolean;
  /** Add a Hue connector whose apiKey is the literal "********" (the old bug). */
  placeholderConnector?: boolean;
}

export interface Fixture {
  /** Expected plaintext per location id (`setting:<key>` or `connector:<id>:<field>`). */
  secrets: Map<string, string>;
  hueId: string;
  kasaId: string;
  remoteIds: [string, string];
  placeholderId: string | null;
  kasaConfig: string;
  deviceHashes: string[];
}

const hueKey = () => randomBytes(30).toString("base64url").replace(/[-_]/g, "x").slice(0, 40);
const apiKey = () => `aeo_${randomBytes(8).toString("hex")}_${randomBytes(32).toString("base64url")}`;
const password = () => randomBytes(24).toString("base64url");

/** Build a pre-H2 database at `file` (or in memory) and return what it holds. */
export function buildSyntheticDatabase(file: string, options: FixtureOptions = {}): { db: DatabaseType; fixture: Fixture } {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  const version = options.schemaVersion ?? Math.max(...migrations.map((m) => m.id));
  runMigrations(db, migrations.filter((m) => m.id <= version), { skipCheckpoint: true });

  const secrets = new Map<string, string>();
  const setting = db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)");
  const mode = options.mqttMode ?? "shared_password";
  if (options.jwtInDatabase !== false) {
    const jwt = randomBytes(32).toString("base64url");
    setting.run("jwt_secret", jwt);
    secrets.set("setting:jwt_secret", jwt);
  }
  setting.run("mqtt_security_level", mode);
  const backend = password();
  setting.run("mqtt_backend_password", backend);
  secrets.set("setting:mqtt_backend_password", backend);
  const credential = db.prepare("INSERT INTO mqtt_credentials (id, device_name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)");
  credential.run(randomUUID(), "aeolus-backend", "aeolus-backend", hashMosquittoPassword(backend), 1);
  if (mode === "shared_password") {
    const shared = password();
    setting.run("mqtt_shared_username", "aeolus-shared");
    setting.run("mqtt_shared_password", shared);
    secrets.set("setting:mqtt_shared_password", shared);
  }
  const deviceHashes: string[] = [];
  if (mode === "per_device") {
    for (const name of ["boiler", "gate"]) {
      const hash = hashMosquittoPassword(password());
      credential.run(randomUUID(), name, `mqtt-${name}`, hash, 1);
      deviceHashes.push(hash);
    }
  }

  const connector = db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES (?, ?, 1, ?, 1, 1)");
  const hueId = randomUUID();
  const hue = hueKey();
  connector.run(hueId, "hue", JSON.stringify({ bridgeIp: "192.168.50.20", apiKey: hue }));
  secrets.set(`connector:${hueId}:apiKey`, hue);
  const kasaId = randomUUID();
  const kasaConfig = JSON.stringify({ pollInterval: 30 });
  connector.run(kasaId, "kasa", kasaConfig);
  const remoteIds: [string, string] = [randomUUID(), randomUUID()];
  for (const [index, id] of remoteIds.entries()) {
    // One key with characters beyond ASCII, to prove the byte-exact round trip.
    const key = index === 0 ? apiKey() : `${apiKey()}-é✓`;
    connector.run(id, "aeolus-remote", JSON.stringify({ baseUrl: `https://peer-${index}.example.test`, endpointPath: "/api/x/state", apiKey: key, pollIntervalSeconds: 30 }));
    secrets.set(`connector:${id}:apiKey`, key);
  }
  let placeholderId: string | null = null;
  if (options.placeholderConnector) {
    placeholderId = randomUUID();
    connector.run(placeholderId, "hue", JSON.stringify({ bridgeIp: "192.168.50.21", apiKey: "********" }));
  }
  return { db, fixture: { secrets, hueId, kasaId, remoteIds, placeholderId, kasaConfig, deviceHashes } };
}

/** Bring a fixture's schema to the current version, as getDatabase() does at startup. */
export function upgradeSchema(db: DatabaseType): void {
  runMigrations(db, migrations, { skipCheckpoint: true });
}
