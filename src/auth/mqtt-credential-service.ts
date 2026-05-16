// MQTT Credential Service — Manages MQTT device credentials and password file generation
// Implements: createCredential, listCredentials, deleteCredential,
//             ensureBackendCredential, regeneratePasswordFile

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import { getDatabase } from "../db/database.js";
import { NotFoundError, ConflictError } from "../api/middleware/error-handler.js";
import logger from "../logger.js";

const BCRYPT_COST = 12;
const PASSWORD_BYTES = 24;
const BACKEND_DEVICE_NAME = "aeolus-backend";
const BACKEND_USERNAME = "aeolus-backend";

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
function sanitizeUsername(deviceName: string): string {
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
 * defaults to `mosquitto/password_file` relative to project root.
 */
function getPasswordFilePath(): string {
  if (process.env.MQTT_PASSWORD_FILE) {
    return process.env.MQTT_PASSWORD_FILE;
  }
  // In Docker, the project is mounted at AEOLUS_PROJECT_DIR
  const projectDir = process.env.AEOLUS_PROJECT_DIR || process.cwd();
  return path.resolve(projectDir, "mosquitto", "password_file");
}

/**
 * Create a new MQTT credential for a device.
 * Generates a username from the device name, a random password,
 * stores the bcrypt hash in the database, and regenerates the password file.
 */
export async function createCredential(deviceName: string): Promise<MqttCredential> {
  const db = getDatabase();
  const username = sanitizeUsername(deviceName);

  // Check for duplicate username
  const existing = db.prepare("SELECT id FROM mqtt_credentials WHERE username = ?").get(username);
  if (existing) {
    throw new ConflictError(`MQTT credential with username "${username}" already exists`);
  }

  const id = crypto.randomUUID();
  const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const createdAt = Date.now();

  db.prepare(
    "INSERT INTO mqtt_credentials (id, device_name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
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
  const rows = db.prepare(
    "SELECT id, device_name, username, created_at FROM mqtt_credentials ORDER BY created_at DESC"
  ).all() as Array<{ id: string; device_name: string; username: string; created_at: number }>;

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
 * If it already exists, returns the existing credential (without the original password).
 * If not, creates a new one and returns it with the password.
 */
export async function ensureBackendCredential(): Promise<MqttCredential> {
  const db = getDatabase();

  const existing = db.prepare(
    "SELECT id, device_name, username FROM mqtt_credentials WHERE username = ?"
  ).get(BACKEND_USERNAME) as { id: string; device_name: string; username: string } | undefined;

  if (existing) {
    // Backend credential already exists — regenerate password so caller gets a usable one
    const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    db.prepare("UPDATE mqtt_credentials SET password_hash = ? WHERE id = ?").run(
      passwordHash,
      existing.id
    );

    regeneratePasswordFile();

    logger.info({ id: existing.id }, "Backend MQTT credential password regenerated");

    return {
      id: existing.id,
      deviceName: existing.device_name,
      username: existing.username,
      password,
    };
  }

  // Create new backend credential
  const id = crypto.randomUUID();
  const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const createdAt = Date.now();

  db.prepare(
    "INSERT INTO mqtt_credentials (id, device_name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, BACKEND_DEVICE_NAME, BACKEND_USERNAME, passwordHash, createdAt);

  regeneratePasswordFile();

  logger.info({ id }, "Backend MQTT credential created");

  return { id, deviceName: BACKEND_DEVICE_NAME, username: BACKEND_USERNAME, password };
}

/**
 * Regenerate the Mosquitto password file from all stored credentials.
 * Writes one `username:password_hash` entry per line in Mosquitto-compatible format.
 */
export function regeneratePasswordFile(): void {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT username, password_hash FROM mqtt_credentials ORDER BY username"
  ).all() as Array<{ username: string; password_hash: string }>;

  const content = rows.map((row) => `${row.username}:${row.password_hash}`).join("\n");

  const filePath = getPasswordFilePath();
  const dir = path.dirname(filePath);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content + (content.length > 0 ? "\n" : ""), "utf-8");

  logger.info({ filePath, credentialCount: rows.length }, "Mosquitto password file regenerated");

  // Signal Mosquitto to reload the password file
  reloadMosquitto();
}

/**
 * Send SIGHUP to the Mosquitto container to reload its password file.
 * Uses the Docker socket (mounted at /var/run/docker.sock) via docker exec.
 * Fails silently if the container isn't running or Docker isn't available.
 */
function reloadMosquitto(): void {
  try {
    execSync("docker kill --signal=SIGHUP aeolus-mosquitto", {
      timeout: 5000,
      stdio: "pipe",
    });
    logger.info("Sent SIGHUP to aeolus-mosquitto (password file reload)");
  } catch {
    // Not critical — Mosquitto may not be running yet (first startup)
    // or we may not be in Docker. The file will be picked up on next restart.
    logger.debug("Could not signal Mosquitto to reload password file (container may not be running)");
  }
}
