// src/secrets/keyring.ts — the root keys that protect stored secrets (H2).
//
// The keyring is a JSON file outside the database and outside its volume
// (`AEOLUS_SECRETS_DIR`, a separate `aeolus_secrets` volume in Compose), so a copy
// of the database or a database backup does not contain it.
//
//   { "format": "aeolus-keyring", "version": 1, "installationId": "<uuid>",
//     "keys": [{ "id", "key" (base64, 32 bytes), "status": "active" | "pending" | "retired",
//                "createdAt", "activatedAt", "retiredAt" }] }
//
// Exactly one key is active. A pending key may decrypt (an interrupted rotation) but
// never encrypts. Retired keys stay so older backups remain decryptable.
//
// Writes: create is exclusive (it fails if the file exists) and replace is atomic
// (temporary file, fsync, rename, directory fsync, keeping keyring.prev.json). On
// POSIX the file must be private to the backend user, or the keyring is refused.

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RootKey } from "./envelope.js";

export const KEYRING_FORMAT = "aeolus-keyring";
export const KEYRING_FILE_NAME = "keyring.json";

export type KeyStatus = "active" | "pending" | "retired";

export interface KeyringKey {
  id: string;
  key: string;
  status: KeyStatus;
  createdAt: number;
  activatedAt: number | null;
  retiredAt: number | null;
}

export interface Keyring {
  format: typeof KEYRING_FORMAT;
  version: 1;
  installationId: string;
  keys: KeyringKey[];
}

export class KeyringError extends Error {
  constructor(
    readonly reason: "missing" | "malformed" | "insecure-permissions" | "exists" | "io" | "mismatch",
    message: string,
  ) {
    super(message);
    this.name = "KeyringError";
  }
}

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A new key id: `k` + time + random, sortable and unique. */
export function newKeyId(now = Date.now()): string {
  return `k${now.toString(36)}${randomBytes(3).toString("hex")}`;
}

export function generateKeyring(now = Date.now()): Keyring {
  return {
    format: KEYRING_FORMAT,
    version: 1,
    installationId: randomUUID(),
    keys: [{ id: newKeyId(now), key: randomBytes(32).toString("base64"), status: "active", createdAt: now, activatedAt: now, retiredAt: null }],
  };
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Validate a parsed keyring. Throws KeyringError("malformed") naming the problem, never a key. */
export function validateKeyring(value: unknown): Keyring {
  const bad = (what: string): never => { throw new KeyringError("malformed", `Keyring is malformed: ${what}`); };
  if (typeof value !== "object" || value === null || Array.isArray(value)) bad("not an object");
  const ring = value as Record<string, unknown>;
  if (ring.format !== KEYRING_FORMAT) bad("wrong format");
  if (ring.version !== 1) bad("unsupported version");
  if (typeof ring.installationId !== "string" || !UUID.test(ring.installationId)) bad("installationId");
  if (!Array.isArray(ring.keys) || ring.keys.length === 0) bad("no keys");
  const ids = new Set<string>();
  let active = 0;
  for (const entry of ring.keys as unknown[]) {
    if (typeof entry !== "object" || entry === null) bad("key entry");
    const key = entry as Record<string, unknown>;
    if (typeof key.id !== "string" || !KEY_ID.test(key.id)) bad("key id");
    if (ids.has(key.id as string)) bad(`duplicate key id ${String(key.id)}`);
    ids.add(key.id as string);
    if (typeof key.key !== "string" || Buffer.from(key.key, "base64").length !== 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(key.key)) bad(`key ${String(key.id)} is not 32 bytes of base64`);
    if (key.status !== "active" && key.status !== "pending" && key.status !== "retired") bad(`key ${String(key.id)} status`);
    if (key.status === "active") active += 1;
    if (!isTime(key.createdAt)) bad(`key ${String(key.id)} createdAt`);
    if (key.activatedAt !== null && !isTime(key.activatedAt)) bad(`key ${String(key.id)} activatedAt`);
    if (key.retiredAt !== null && !isTime(key.retiredAt)) bad(`key ${String(key.id)} retiredAt`);
    if (key.status === "retired" && key.retiredAt === null) bad(`retired key ${String(key.id)} has no retiredAt`);
  }
  if (active !== 1) bad(`${active} active keys (exactly one is required)`);
  return value as Keyring;
}

export function parseKeyring(text: string): Keyring {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new KeyringError("malformed", "Keyring is malformed: not JSON");
  }
  return validateKeyring(value);
}

export function activeKey(ring: Keyring): RootKey {
  const entry = ring.keys.find((key) => key.status === "active")!;
  return { id: entry.id, key: Buffer.from(entry.key, "base64") };
}

/** A key for decryption by id: active, pending or retired. */
export function keyById(ring: Keyring, id: string): RootKey | undefined {
  const entry = ring.keys.find((key) => key.id === id);
  return entry ? { id: entry.id, key: Buffer.from(entry.key, "base64") } : undefined;
}

/**
 * A key's fingerprint, safe to store in the database: HMAC of a fixed label under the
 * key, truncated. It identifies the key without revealing it.
 */
export function keyFingerprint(key: RootKey): string {
  return createHmac("sha256", key.key).update(`aeolus/keyring-fingerprint/v1|${key.id}`).digest("hex").slice(0, 32);
}

/** Refuse a keyring other users can read, or a directory others can write (POSIX). */
export function checkPermissions(file: string): { checked: boolean } {
  if (process.platform === "win32") return { checked: false };
  const stat = fs.statSync(file);
  const dir = fs.statSync(path.dirname(file));
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if ((stat.mode & 0o077) !== 0) {
    throw new KeyringError("insecure-permissions", `Keyring ${file} is readable or writable by other users (mode ${(stat.mode & 0o777).toString(8)}); run: chmod 600 ${file}`);
  }
  if (uid >= 0 && stat.uid !== uid) {
    throw new KeyringError("insecure-permissions", `Keyring ${file} is owned by uid ${stat.uid}, not the backend user (uid ${uid})`);
  }
  if ((dir.mode & 0o022) !== 0) {
    throw new KeyringError("insecure-permissions", `Keyring directory ${path.dirname(file)} is writable by other users; run: chmod 700 ${path.dirname(file)}`);
  }
  return { checked: true };
}

/** Read and validate the keyring. `missing` when absent; never creates one. */
export function loadKeyring(file: string): Keyring {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new KeyringError("missing", `Keyring ${file} does not exist`);
    throw new KeyringError("io", `Keyring ${file} could not be read (${(error as NodeJS.ErrnoException).code ?? "error"})`);
  }
  checkPermissions(file);
  return parseKeyring(text);
}

function fsyncDirectory(dir: string): void {
  // Directory fsync makes a rename or new name durable on Linux. Windows cannot open
  // a directory for fsync; that is a development platform, not a durability target.
  if (process.platform === "win32") return;
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeTemp(dir: string, text: string): string {
  const temp = path.join(dir, `.keyring.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return temp;
}

function serialise(ring: Keyring): string {
  return `${JSON.stringify(validateKeyring(ring), null, 2)}\n`;
}

/** Ensure the secrets directory exists and is private (0700 where supported). */
export function ensureSecretsDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
}

/**
 * Create the keyring only if no file exists. The content is written to a temporary
 * file and linked into place, so the keyring is either absent or complete, and an
 * existing keyring is never replaced.
 */
export function createKeyringExclusive(file: string, ring: Keyring): void {
  const dir = path.dirname(file);
  ensureSecretsDirectory(dir);
  const temp = writeTemp(dir, serialise(ring));
  try {
    fs.linkSync(temp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new KeyringError("exists", `Keyring ${file} already exists; it was not replaced`);
    throw new KeyringError("io", `Keyring ${file} could not be created (${(error as NodeJS.ErrnoException).code ?? "error"})`);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  fsyncDirectory(dir);
}

/**
 * Replace an existing keyring atomically, keeping the previous one as keyring.prev.json.
 * A reader sees the old file or the new one, never a mixture.
 */
export function replaceKeyringAtomic(file: string, ring: Keyring): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(file)) throw new KeyringError("missing", `Keyring ${file} does not exist; it cannot be replaced`);
  const temp = writeTemp(dir, serialise(ring));
  const previous = path.join(dir, "keyring.prev.json");
  fs.copyFileSync(file, previous);
  if (process.platform !== "win32") fs.chmodSync(previous, 0o600);
  fs.renameSync(temp, file);
  fsyncDirectory(dir);
}

/** Remove temporary files a crash left behind. They never become the keyring. */
export function cleanTemporaryFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (/^\.keyring\..+\.tmp$/.test(name)) {
      fs.rmSync(path.join(dir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}
