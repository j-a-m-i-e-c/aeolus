// src/secrets/keyring-backup.ts — a passphrase-protected copy of the keyring, for
// storage away from the host (a password manager, a USB key, another machine).
//
//   { "format": "aeolus-keyring-backup", "version": 1, "createdAt", "installationId",
//     "keyIds": [...], "kdf": { "name": "scrypt", "N", "r", "p", "salt" },
//     "nonce", "ciphertext" }
//
// The passphrase is stretched with scrypt (N = 2^17, r = 8, p = 1: about 128 MiB and
// a fraction of a second per attempt) using a random 16-byte salt, and the keyring is
// sealed with AES-256-GCM. Every header field is authenticated data, so editing the
// installation id, the key list or the KDF parameters makes the backup unreadable.
// The passphrase never leaves memory and never appears in an error.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { parseKeyring, type Keyring } from "./keyring.js";

export const BACKUP_FORMAT = "aeolus-keyring-backup";
export const MIN_PASSPHRASE_LENGTH = 12;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** The parameters every new backup uses. */
export const BACKUP_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };
/** Accepted when reading: the documented parameters or stronger, within a memory bound. */
const MIN_N = 2 ** 15;
const MAX_MEMORY = 1024 * 1024 * 1024;

export interface KeyringBackup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: number;
  installationId: string;
  keyIds: string[];
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  nonce: string;
  ciphertext: string;
}

export class KeyringBackupError extends Error {
  constructor(readonly reason: "weak-passphrase" | "malformed" | "authentication-failed" | "mismatch", message: string) {
    super(message);
    this.name = "KeyringBackupError";
  }
}

function normalise(passphrase: string): string {
  return passphrase.normalize("NFC");
}

function memoryFor(params: ScryptParams): number {
  return 128 * params.N * params.r * params.p + 64 * 1024 * 1024;
}

function derive(passphrase: string, salt: Buffer, params: ScryptParams): Buffer {
  return scryptSync(normalise(passphrase), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: memoryFor(params) });
}

function header(backup: Omit<KeyringBackup, "nonce" | "ciphertext">): Buffer {
  const { format, version, createdAt, installationId, keyIds, kdf } = backup;
  return Buffer.from(JSON.stringify({ format, version, createdAt, installationId, keyIds, kdf }), "utf8");
}

/** Seal a keyring under a passphrase. */
export function createKeyringBackup(ring: Keyring, passphrase: string, now = Date.now(), params: ScryptParams = BACKUP_SCRYPT): KeyringBackup {
  if (normalise(passphrase).length < MIN_PASSPHRASE_LENGTH) {
    throw new KeyringBackupError("weak-passphrase", `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const salt = randomBytes(16);
  const partial = {
    format: BACKUP_FORMAT as typeof BACKUP_FORMAT,
    version: 1 as const,
    createdAt: now,
    installationId: ring.installationId,
    keyIds: ring.keys.map((key) => key.id),
    kdf: { name: "scrypt" as const, ...params, salt: salt.toString("base64") },
  };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(passphrase, salt, params), nonce);
  cipher.setAAD(header(partial));
  const body = Buffer.concat([cipher.update(JSON.stringify(ring), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ...partial, nonce: nonce.toString("base64"), ciphertext: body.toString("base64") };
}

function shape(value: unknown): KeyringBackup {
  const bad = (what: string): never => { throw new KeyringBackupError("malformed", `Keyring backup is malformed: ${what}`); };
  if (typeof value !== "object" || value === null) bad("not an object");
  const b = value as Record<string, unknown>;
  if (b.format !== BACKUP_FORMAT) bad("wrong format");
  if (b.version !== 1) bad("unsupported version");
  if (typeof b.createdAt !== "number" || typeof b.installationId !== "string") bad("header");
  if (!Array.isArray(b.keyIds) || b.keyIds.some((id) => typeof id !== "string")) bad("keyIds");
  const kdf = b.kdf as Record<string, unknown> | undefined;
  if (!kdf || kdf.name !== "scrypt" || typeof kdf.salt !== "string") bad("kdf");
  const params = { N: kdf!.N, r: kdf!.r, p: kdf!.p };
  if (![params.N, params.r, params.p].every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)) bad("kdf parameters");
  const { N, r, p } = params as ScryptParams;
  if (N < MIN_N || (N & (N - 1)) !== 0 || r < 8 || memoryFor({ N, r, p }) > MAX_MEMORY) bad("kdf parameters outside the accepted range");
  if (typeof b.nonce !== "string" || Buffer.from(b.nonce, "base64").length !== 12) bad("nonce");
  if (typeof b.ciphertext !== "string" || Buffer.from(b.ciphertext, "base64").length < 17) bad("ciphertext");
  return value as KeyringBackup;
}

/** Parse a backup file's text, checking its shape before any expensive work. */
export function parseKeyringBackup(text: string): KeyringBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new KeyringBackupError("malformed", "Keyring backup is malformed: not JSON");
  }
  return shape(value);
}

/** Open a backup with its passphrase. A wrong passphrase and a modified file fail the same way. */
export function openKeyringBackup(backup: KeyringBackup, passphrase: string): Keyring {
  const checked = shape(backup);
  const { N, r, p, salt } = checked.kdf;
  const decipher = createDecipheriv("aes-256-gcm", derive(passphrase, Buffer.from(salt, "base64"), { N, r, p }), Buffer.from(checked.nonce, "base64"));
  const body = Buffer.from(checked.ciphertext, "base64");
  decipher.setAAD(header(checked));
  decipher.setAuthTag(body.subarray(body.length - 16));
  let text: string;
  try {
    text = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    throw new KeyringBackupError("authentication-failed", "The keyring backup could not be opened: wrong passphrase, or the file was modified");
  }
  const ring = parseKeyring(text);
  const ids = ring.keys.map((key) => key.id);
  if (ring.installationId !== checked.installationId || ids.length !== checked.keyIds.length || ids.some((id, i) => id !== checked.keyIds[i])) {
    throw new KeyringBackupError("mismatch", "The keyring inside the backup does not match its header");
  }
  return ring;
}
