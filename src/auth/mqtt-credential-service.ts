// MQTT Credential Service — manages MQTT device credentials and the Mosquitto
// password file.
//
// Credentials are hashed natively into Mosquitto's sha512-pbkdf2 (`$7$`) format
// (see ../mqtt/mosquitto-password-hash.ts). The `$7$` hash line is what gets
// stored in the database and written verbatim to the password file, so the
// broker can authenticate the credential without Aeolus ever needing the
// `mosquitto_passwd` binary or the Docker socket.
//
// Password-file composition is intentionally simple and mode-agnostic here:
// `regeneratePasswordFile()` writes the backend credential plus every stored
// device credential. Shared-mode composition (which must NOT include device
// entries) is handled by the provisioning service via `writePasswordFile()`.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "../db/database.js";
import { NotFoundError, ConflictError } from "../api/middleware/error-handler.js";
import { buildPasswordLine, hashMosquittoPassword } from "../mqtt/mosquitto-password-hash.js";
import { MosquittoReloader } from "../mqtt/mosquitto-reloader.js";
import logger from "../logger.js";

const PASSWORD_BYTES = 24;

export const BACKEND_DEVICE_NAME = "aeolus-backend";
export const BACKEND_USERNAME = "aeolus-backend";

/** system_settings key holding the backend broker password (plaintext). */
export const SETTING_BACKEND_PASSWORD = "mqtt_backend_password";

export interface MqttCredential {
  id: string;
  deviceName: string;
  username: string;
  password: string; // Only returned on creation
}

export interface MqttCredentialListItem {
  id: string;
  deviceName: string;
  username: string;
  createdAt: number;
}

/**
 * Sanitize a device name into a valid MQTT username.
 * Lowercase, replace spaces/special chars with hyphens, prefix with "mqtt-".
 */
export function sanitizeUsername(deviceName: string): string {
  const sanitized = deviceName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `mqtt-${sanitized}`;
}

/**
 * Get the password file path. Configurable via MQTT_PASSWORD_FILE env var,
 * defaults to `mosquitto/password_file` relative to the project root.
 *
 * In a shared-volume deployment this must resolve to the same file the broker
 * reads (see docs/security/mqtt.md).
 */
export function getPasswordFilePath(): string {
  if (process.env.MQTT_PASSWORD_FILE) {
    return process.env.MQTT_PASSWORD_FILE;
  }
  const projectDir = process.env.AEOLUS_PROJECT_DIR || process.cwd();
  return path.resolve(projectDir, "mosquitto", "password_file");
}

// ─── Settings helpers ──────────────────────────────────────────────────────

function readSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(
    "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

// ─── Password file writing ─────────────────────────────────────────────────

/**
 * Write the given password-file lines to disk atomically (temp file + rename)
 * so the broker never observes a partially written file, then trigger a
 * best-effort broker reload.
 *
 * Each line must already be a full Mosquitto entry (`username:$7$…`).
 */
export function writePasswordFile(lines: string[]): void {
  const filePath = getPasswordFilePath();
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.password_file.tmp.${crypto.randomBytes(4).toString("hex")}`);

  fs.mkdirSync(dir, { recursive: true });

  const content = lines.join("\n") + (lines.length > 0 ? "\n" : "");
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, filePath);

  logger.info({ filePath, entryCount: lines.length }, "Mosquitto password file written");

  triggerReload();
}

/**
 * Return the stored password-file lines for every device credential, excluding
 * the backend credential. Lines come straight from the stored `$7$` hashes, so
 * they survive process restarts without needing the original plaintext.
 */
export function getDeviceCredentialLines(): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT username, password_hash FROM mqtt_credentials WHERE username != ? ORDER BY username",
    )
    .all(BACKEND_USERNAME) as Array<{ username: string; password_hash: string }>;
  return rows.map((row) => `${row.username}:${row.password_hash}`);
}

/**
 * Regenerate the password file from the backend credential plus all stored
 * device credentials. Used after per-device credential create/revoke. The
 * backend line is derived from the persisted backend password so the file and
 * the backend's own broker connection always agree.
 */
export function regeneratePasswordFile(): void {
  const lines: string[] = [];

  const backendPassword = readSetting(SETTING_BACKEND_PASSWORD);
  if (backendPassword) {
    lines.push(buildPasswordLine(BACKEND_USERNAME, backendPassword));
  }
  lines.push(...getDeviceCredentialLines());

  writePasswordFile(lines);
}

/**
 * Trigger a best-effort broker reload using the deployment-configured strategy.
 * Never throws: the file is already on disk, so a failed live reload only delays
 * pickup until the broker's next start.
 */
function triggerReload(): void {
  new MosquittoReloader().reload().catch(() => {
    /* reload failures are logged inside the reloader; never fatal */
  });
}

// ─── Credential CRUD ─────────────────────────────────────────────────────────

/**
 * Create a new MQTT credential for a device.
 * Generates a username from the device name and a random password, stores the
 * Mosquitto `$7$` hash in the database, and regenerates the password file.
 */
export async function createCredential(deviceName: string): Promise<MqttCredential> {
  const db = getDatabase();
  const username = sanitizeUsername(deviceName);

  const existing = db.prepare("SELECT id FROM mqtt_credentials WHERE username = ?").get(username);
  if (existing) {
    throw new ConflictError(`MQTT credential with username "${username}" already exists`);
  }

  const id = crypto.randomUUID();
  const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
  const passwordHash = hashMosquittoPassword(password);
  const createdAt = Date.now();

  db.prepare(
    "INSERT INTO mqtt_credentials (id, device_name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, deviceName, username, passwordHash, createdAt);

  regeneratePasswordFile();

  logger.info({ id, deviceName, username }, "MQTT credential created");

  return { id, deviceName, username, password };
}

/**
 * List all MQTT credentials without exposing passwords.
 */
export function listCredentials(): MqttCredentialListItem[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT id, device_name, username, created_at FROM mqtt_credentials ORDER BY created_at DESC",
    )
    .all() as Array<{ id: string; device_name: string; username: string; created_at: number }>;

  return rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    username: row.username,
    createdAt: row.created_at,
  }));
}

/**
 * Delete an MQTT credential by ID and regenerate the password file.
 */
export function deleteCredential(id: string): void {
  const db = getDatabase();

  const existing = db.prepare("SELECT id FROM mqtt_credentials WHERE id = ?").get(id);
  if (!existing) {
    throw new NotFoundError(`MQTT credential not found`);
  }

  db.prepare("DELETE FROM mqtt_credentials WHERE id = ?").run(id);

  regeneratePasswordFile();

  logger.info({ id }, "MQTT credential deleted");
}

/**
 * Ensure the backend's own MQTT credential exists.
 *
 * Generates a fresh password, stores its `$7$` hash on the backend row and the
 * plaintext in system_settings (the single source used both to write the
 * password file and to connect the backend to the broker), and returns the
 * plaintext so the caller can connect.
 */
export async function ensureBackendCredential(): Promise<MqttCredential> {
  const db = getDatabase();

  const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
  const passwordHash = hashMosquittoPassword(password);
  writeSetting(SETTING_BACKEND_PASSWORD, password);

  const existing = db
    .prepare("SELECT id, device_name, username FROM mqtt_credentials WHERE username = ?")
    .get(BACKEND_USERNAME) as
    | { id: string; device_name: string; username: string }
    | undefined;

  if (existing) {
    db.prepare("UPDATE mqtt_credentials SET password_hash = ? WHERE id = ?").run(
      passwordHash,
      existing.id,
    );
    logger.info({ id: existing.id }, "Backend MQTT credential password regenerated");
    return {
      id: existing.id,
      deviceName: existing.device_name,
      username: existing.username,
      password,
    };
  }

  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO mqtt_credentials (id, device_name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, BACKEND_DEVICE_NAME, BACKEND_USERNAME, passwordHash, Date.now());

  logger.info({ id }, "Backend MQTT credential created");

  return { id, deviceName: BACKEND_DEVICE_NAME, username: BACKEND_USERNAME, password };
}
