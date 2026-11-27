// src/secrets/migration.ts — staged, resumable encryption of existing secrets (H2b).
//
// Runs at startup after the keyring is bound, before any service reads a secret, and
// offline through `aeolus-secrets migrate`. The stage marker
// (system_settings.secrets_migration) makes every stage resumable:
//
//   0. checkpoint  VACUUM INTO <secrets dir>/pre-secrets-<time>.db (plaintext; private;
//                  outside the database directory so database backups never copy it)
//   1. shadow      one transaction: an envelope for every plaintext secret into the
//                  side table secret_migration; marker "shadow". Plaintext untouched.
//   2. verify      every side-table envelope decrypts to its plaintext (constant time),
//                  and the side table covers exactly the plaintext locations
//   3. switch      one transaction (secure_delete on): plaintext re-read and compared,
//                  every value replaced by its envelope, the side table dropped, marker
//                  "encrypted". Atomic: all plaintext before, all envelopes after.
//   4. clean       compare every decrypted value with the checkpoint, delete the
//                  checkpoint, VACUUM, wal_checkpoint(TRUNCATE), mark cleaned
//
// After the marker says "encrypted" there is no plaintext fallback: a plaintext value
// in a secret location stops startup, unless the operator runs
// `aeolus-secrets migrate --reencrypt-plaintext`. Every existing envelope must decrypt
// at its own location, or startup stops. Nothing here logs or returns a value.
//
// The same stored values are kept: the JWT secret (sessions survive), the MQTT
// passwords (the broker's password file hashes stay valid) and the connector keys.
// A connector password field holding the literal API placeholder "********" (an old
// bug) is not a credential: it is cleared, and the connector asks for the secret again.

import type { Database as DatabaseType } from "better-sqlite3";
import Database from "better-sqlite3";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isEnvelope } from "./envelope.js";
import { SecretsUnavailableError } from "./errors.js";
import { activeKey, ensureSecretsDirectory, type Keyring } from "./keyring.js";
import { collectSecretValues, describeLocation, locationId, type LocatedValue, type SecretInventory, type SecretLocation } from "./locations.js";
import { createSecretCodec, type SecretCodec, type SecretFieldLookup } from "./secret-store.js";

export const MIGRATION_SETTING = "secrets_migration";
const SIDE_TABLE = "secret_migration";
/** What the API shows instead of a password-field value (connectors/connector-config.ts). */
const PLACEHOLDER = "********";
const CHECKPOINT = /^pre-secrets-[0-9TZ-]+\.db$/;

export interface MigrationMarker {
  version: 1;
  state: "shadow" | "encrypted";
  keyId: string;
  updatedAt: number;
  cleanedAt?: number;
}

/** Crash points for tests: the hook may throw (or end the process) to stop the migration there. */
export type MigrationPoint =
  | "after-checkpoint"
  | "in-shadow"
  | "after-shadow"
  | "after-verify"
  | "in-switch"
  | "after-switch"
  | "after-post-verify"
  | "after-checkpoint-removed"
  | "after-vacuum"
  | "after-wal-truncate";

export interface MigrationOptions {
  lookup: SecretFieldLookup;
  /** Where the stage-0 checkpoint is written (the secrets directory); null for no checkpoint. */
  checkpointDir: string | null;
  /** The database file, to list older copies beside it that still hold plaintext. */
  dbPath?: string;
  /** Explicit operator decision: encrypt plaintext found after the migration completed. */
  reencryptPlaintext?: boolean;
  fault?: (point: MigrationPoint) => void;
  now?: () => number;
}

export interface MigrationReport {
  outcome: "no-secrets" | "migrated" | "already-encrypted";
  encrypted: { settings: number; connectorFields: number };
  /** Locations whose literal placeholder was cleared (the connector needs the secret again). */
  clearedPlaceholders: string[];
  /** Envelopes that decrypted at their own location. */
  verified: number;
  unknownConnectorTypes: number;
  malformedConnectors: number;
  /** Stage 4 completed (now or earlier). */
  cleaned: boolean;
  /** Files that predate encryption and may still hold plaintext secrets; never deleted here. */
  plaintextCopies: string[];
}

// ─── Marker ─────────────────────────────────────────────────────────────────

export function readMarker(db: DatabaseType): MigrationMarker | null {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(MIGRATION_SETTING) as { value: string } | undefined;
  if (!row) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch {
    throw new SecretsUnavailableError("The secrets migration marker is not valid JSON; refusing to guess whether secrets are encrypted");
  }
  const marker = value as Partial<MigrationMarker>;
  if (marker?.version !== 1 || (marker.state !== "shadow" && marker.state !== "encrypted") || typeof marker.keyId !== "string" || typeof marker.updatedAt !== "number"
    || (marker.cleanedAt !== undefined && typeof marker.cleanedAt !== "number")) {
    throw new SecretsUnavailableError("The secrets migration marker is malformed; refusing to guess whether secrets are encrypted");
  }
  return marker as MigrationMarker;
}

function writeMarker(db: DatabaseType, marker: MigrationMarker): void {
  db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(MIGRATION_SETTING, JSON.stringify(marker));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function open(codec: SecretCodec, location: SecretLocation, stored: string): string {
  return location.kind === "setting"
    ? codec.openSetting(location.key, stored)
    : codec.openConnectorField(location.instanceId, location.field, stored);
}

function seal(codec: SecretCodec, location: SecretLocation, plaintext: string): string {
  return location.kind === "setting"
    ? codec.sealSetting(location.key, plaintext)
    : codec.sealConnectorField(location.instanceId, location.field, plaintext);
}

interface Classified {
  envelopes: LocatedValue[];
  plaintext: LocatedValue[];
  placeholders: LocatedValue[];
}

function classify(inventory: SecretInventory): Classified {
  const result: Classified = { envelopes: [], plaintext: [], placeholders: [] };
  for (const item of inventory.values) {
    if (isEnvelope(item.value)) result.envelopes.push(item);
    else if (item.location.kind === "connector" && item.value === PLACEHOLDER) result.placeholders.push(item);
    else result.plaintext.push(item);
  }
  return result;
}

/** Every envelope must decrypt at its own location. Returns how many did. */
function verifyEnvelopes(codec: SecretCodec, envelopes: LocatedValue[]): number {
  for (const item of envelopes) open(codec, item.location, item.value);
  return envelopes.length;
}

function sideTableExists(db: DatabaseType): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(SIDE_TABLE));
}

function listCheckpoints(dir: string | null): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => CHECKPOINT.test(name)).sort().map((name) => path.join(dir, name));
}

/** Older copies of this database beside it, made before encryption: they may hold plaintext. */
function plaintextCopiesBeside(dbPath: string | undefined): string[] {
  if (!dbPath) return [];
  const dir = path.dirname(path.resolve(dbPath));
  const base = path.basename(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => (name.startsWith(`${base}.pre-migration.`) && name.endsWith(".bak")) || name === "hue-credentials.json.migrated")
    .sort()
    .map((name) => path.join(dir, name));
}

// ─── Stages ─────────────────────────────────────────────────────────────────

function createCheckpoint(db: DatabaseType, dir: string, now: number): string {
  ensureSecretsDirectory(dir);
  for (const old of listCheckpoints(dir)) fs.rmSync(old, { force: true });
  const file = path.join(dir, `pre-secrets-${new Date(now).toISOString().replace(/[:.]/g, "-")}.db`);
  db.prepare("VACUUM INTO ?").run(file);
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  return file;
}

function shadow(db: DatabaseType, codec: SecretCodec, plaintext: LocatedValue[], keyId: string, now: number, fault?: MigrationOptions["fault"]): void {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS ${SIDE_TABLE} (location TEXT PRIMARY KEY, envelope TEXT NOT NULL)`);
    db.exec(`DELETE FROM ${SIDE_TABLE}`);
    const insert = db.prepare(`INSERT INTO ${SIDE_TABLE} (location, envelope) VALUES (?, ?)`);
    for (const item of plaintext) insert.run(locationId(item.location), seal(codec, item.location, item.value));
    writeMarker(db, { version: 1, state: "shadow", keyId, updatedAt: now });
    fault?.("in-shadow");
  })();
}

function readShadow(db: DatabaseType): Map<string, string> {
  const rows = db.prepare(`SELECT location, envelope FROM ${SIDE_TABLE}`).all() as Array<{ location: string; envelope: string }>;
  return new Map(rows.map((row) => [row.location, row.envelope]));
}

/** Stage 2: the side table holds exactly one correct envelope per plaintext location. */
function verifyShadow(db: DatabaseType, codec: SecretCodec, plaintext: LocatedValue[]): Map<string, string> {
  const side = readShadow(db);
  if (side.size !== plaintext.length) {
    throw new SecretsUnavailableError(`Secrets migration verification failed: ${side.size} staged envelopes for ${plaintext.length} secrets; plaintext was kept`);
  }
  for (const item of plaintext) {
    const envelope = side.get(locationId(item.location));
    let ok = false;
    try {
      ok = envelope !== undefined && sameSecret(open(codec, item.location, envelope), item.value);
    } catch {
      ok = false;
    }
    if (!ok) throw new SecretsUnavailableError(`Secrets migration verification failed for ${describeLocation(item.location)}; plaintext was kept`);
  }
  return side;
}

function switchToEnvelopes(
  db: DatabaseType,
  lookup: SecretFieldLookup,
  verified: LocatedValue[],
  placeholders: LocatedValue[],
  side: Map<string, string>,
  keyId: string,
  now: number,
  fault?: MigrationOptions["fault"],
): void {
  const previous = db.pragma("secure_delete", { simple: true }) as number;
  db.pragma("secure_delete = ON");
  try {
    db.transaction(() => {
      // Nothing may have changed since verification.
      const current = classify(collectSecretValues(db, lookup));
      const expected = new Map(verified.map((item) => [locationId(item.location), item.value]));
      const unchanged = current.plaintext.length === expected.size
        && current.plaintext.every((item) => {
          const value = expected.get(locationId(item.location));
          return value !== undefined && sameSecret(value, item.value);
        });
      if (!unchanged) throw new SecretsUnavailableError("Secrets changed during the migration; nothing was switched. Restart to retry.");

      const updateSetting = db.prepare("UPDATE system_settings SET value = ? WHERE key = ?");
      const configs = new Map<string, Record<string, unknown>>();
      const configOf = (instanceId: string): Record<string, unknown> => {
        let config = configs.get(instanceId);
        if (!config) {
          const row = db.prepare("SELECT config FROM connectors WHERE id = ?").get(instanceId) as { config: string };
          config = JSON.parse(row.config) as Record<string, unknown>;
          configs.set(instanceId, config);
        }
        return config;
      };
      for (const item of current.plaintext) {
        const envelope = side.get(locationId(item.location))!;
        if (item.location.kind === "setting") updateSetting.run(envelope, item.location.key);
        else configOf(item.location.instanceId)[item.location.field] = envelope;
      }
      for (const item of placeholders) {
        if (item.location.kind === "connector") configOf(item.location.instanceId)[item.location.field] = "";
      }
      const updateConnector = db.prepare("UPDATE connectors SET config = ? WHERE id = ?");
      for (const [instanceId, config] of configs) updateConnector.run(JSON.stringify(config), instanceId);
      db.exec(`DROP TABLE IF EXISTS ${SIDE_TABLE}`);
      writeMarker(db, { version: 1, state: "encrypted", keyId, updatedAt: now });
      fault?.("in-switch");
    })();
  } finally {
    db.pragma(`secure_delete = ${previous ? "ON" : "OFF"}`);
  }
}

/**
 * Stage 4 check: no plaintext remains, every envelope decrypts, and every secret the
 * checkpoint held as plaintext (or as an envelope) decrypts to the same value now.
 * `originals` is used when there is no checkpoint (an in-memory database).
 */
function postVerify(db: DatabaseType, codec: SecretCodec, lookup: SecretFieldLookup, checkpoint: string | null, originals: LocatedValue[] | null): number {
  const live = classify(collectSecretValues(db, lookup));
  if (live.plaintext.length > 0 || live.placeholders.length > 0) {
    throw new SecretsUnavailableError(`After the switch, ${live.plaintext.length + live.placeholders.length} secret location(s) still hold plaintext; refusing to start`);
  }
  const decrypted = new Map(live.envelopes.map((item) => [locationId(item.location), open(codec, item.location, item.value)]));
  let reference = originals;
  if (checkpoint) {
    const copy = new Database(checkpoint, { readonly: true, fileMustExist: true });
    try {
      const before = classify(collectSecretValues(copy, lookup));
      reference = [
        ...before.plaintext,
        ...before.envelopes.map((item) => ({ location: item.location, value: open(codec, item.location, item.value) })),
      ];
    } finally {
      copy.close();
    }
  }
  for (const item of reference ?? []) {
    const current = decrypted.get(locationId(item.location));
    if (current === undefined || !sameSecret(current, item.value)) {
      throw new SecretsUnavailableError(`After the switch, ${describeLocation(item.location)} does not decrypt to its previous value; the checkpoint was kept${checkpoint ? ` at ${checkpoint}` : ""}`);
    }
  }
  return live.envelopes.length;
}

/** Stage 4. Returns whether it completed (a busy WAL leaves it for the next start). */
function clean(db: DatabaseType, marker: MigrationMarker, checkpointDir: string | null, now: number, fault?: MigrationOptions["fault"]): boolean {
  for (const file of listCheckpoints(checkpointDir)) fs.rmSync(file, { force: true });
  fault?.("after-checkpoint-removed");
  db.exec("VACUUM");
  fault?.("after-vacuum");
  writeMarker(db, { ...marker, cleanedAt: now });
  const [result] = db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
  fault?.("after-wal-truncate");
  if (result && result.busy !== 0) {
    writeMarker(db, { ...marker });
    return false;
  }
  return true;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Bring the database to "encrypted" (or confirm it is). Throws SecretsUnavailableError to stop startup. */
export function migrateSecrets(db: DatabaseType, keyring: Keyring, options: MigrationOptions): MigrationReport {
  const now = (options.now ?? Date.now)();
  const codec = createSecretCodec(keyring);
  const keyId = activeKey(keyring).id;
  const marker = readMarker(db);
  const inventory = collectSecretValues(db, options.lookup);
  const found = classify(inventory);
  const report: MigrationReport = {
    outcome: "already-encrypted",
    encrypted: { settings: 0, connectorFields: 0 },
    clearedPlaceholders: [],
    verified: verifyEnvelopes(codec, found.envelopes),
    unknownConnectorTypes: inventory.unknownTypes.length,
    malformedConnectors: inventory.malformedConnectors.length,
    cleaned: false,
    plaintextCopies: [],
  };
  const pending = found.plaintext.length + found.placeholders.length;

  if (marker?.state === "encrypted") {
    if (pending > 0 && !options.reencryptPlaintext) {
      const where = [...found.plaintext, ...found.placeholders].map((item) => describeLocation(item.location));
      throw new SecretsUnavailableError(`Stored secrets were encrypted, but ${pending} location(s) now hold plaintext (${where.join(", ")}). Plaintext is never accepted after encryption. If this database was deliberately restored or edited, stop the backend and run: aeolus-secrets migrate --db <path> --reencrypt-plaintext`);
    }
    if (pending === 0) {
      if (marker.cleanedAt === undefined) {
        const checkpoint = listCheckpoints(options.checkpointDir).at(-1) ?? null;
        report.verified = postVerify(db, codec, options.lookup, checkpoint, null);
        options.fault?.("after-post-verify");
        report.cleaned = clean(db, marker, options.checkpointDir, now, options.fault);
      } else {
        report.cleaned = true;
      }
      return report;
    }
  }

  if (pending === 0) {
    // Nothing in plaintext (a fresh database, or one already all envelopes): mark it
    // encrypted so plaintext is refused from now on.
    const encrypted: MigrationMarker = { version: 1, state: "encrypted", keyId, updatedAt: now };
    const checkpoint = listCheckpoints(options.checkpointDir).at(-1) ?? null;
    const leftovers = checkpoint !== null || sideTableExists(db) || marker?.state === "shadow";
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS ${SIDE_TABLE}`);
      writeMarker(db, encrypted);
    })();
    report.verified = postVerify(db, codec, options.lookup, checkpoint, null);
    if (leftovers) {
      report.cleaned = clean(db, encrypted, options.checkpointDir, now, options.fault);
    } else {
      writeMarker(db, { ...encrypted, cleanedAt: now });
      report.cleaned = true;
    }
    report.outcome = found.envelopes.length > 0 || marker ? "already-encrypted" : "no-secrets";
    return report;
  }

  // Stages 0 to 4.
  const checkpoint = options.checkpointDir ? createCheckpoint(db, options.checkpointDir, now) : null;
  options.fault?.("after-checkpoint");
  shadow(db, codec, found.plaintext, keyId, now, options.fault);
  options.fault?.("after-shadow");
  const side = verifyShadow(db, codec, found.plaintext);
  options.fault?.("after-verify");
  switchToEnvelopes(db, options.lookup, found.plaintext, found.placeholders, side, keyId, now, options.fault);
  options.fault?.("after-switch");
  report.verified = postVerify(db, codec, options.lookup, checkpoint, found.plaintext);
  options.fault?.("after-post-verify");
  report.cleaned = clean(db, { version: 1, state: "encrypted", keyId, updatedAt: now }, options.checkpointDir, now, options.fault);

  report.outcome = "migrated";
  report.encrypted = {
    settings: found.plaintext.filter((item) => item.location.kind === "setting").length,
    connectorFields: found.plaintext.filter((item) => item.location.kind === "connector").length,
  };
  report.clearedPlaceholders = found.placeholders.map((item) => describeLocation(item.location));
  report.plaintextCopies = plaintextCopiesBeside(options.dbPath);
  return report;
}
