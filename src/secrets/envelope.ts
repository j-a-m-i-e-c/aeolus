// src/secrets/envelope.ts — authenticated encryption of one stored secret (H2).
//
// Format, stored in place of the plaintext:
//
//   aeolus-enc:v1:<keyId>:<nonce>:<ciphertext+tag>      (nonce and body base64url)
//
// - AES-256-GCM from node:crypto, a fresh random 96-bit nonce per value, 128-bit tag.
// - The data key is never the root key: HKDF-SHA256(root, salt = keyId, info = purpose)
//   gives a separate key per purpose (connector secrets, settings, ...).
// - The additional authenticated data binds the ciphertext to where it is stored
//   (`connector:<instanceId>:<fieldId>`, `setting:<key>`) and to the format header,
//   so a ciphertext moved to another record, field or key id fails to decrypt.
//
// Errors never contain plaintext, key material or the context's values.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const ENVELOPE_PREFIX = "aeolus-enc:";
const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

/** What a data key is for. A new purpose gets a new HKDF info string. */
export type SecretPurpose = "connector-secret" | "setting-secret";

export class EnvelopeError extends Error {
  constructor(readonly reason: "malformed" | "unsupported-version" | "unknown-key" | "authentication-failed", message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

export interface RootKey {
  id: string;
  /** 32 bytes. */
  key: Buffer;
}

function dataKey(root: RootKey, purpose: SecretPurpose): Buffer {
  return Buffer.from(hkdfSync("sha256", root.key, Buffer.from(root.id, "utf8"), Buffer.from(`aeolus/${purpose}/v1`, "utf8"), 32));
}

function aad(keyId: string, purpose: SecretPurpose, context: string): Buffer {
  return Buffer.from(`${ENVELOPE_PREFIX}${VERSION}:${keyId}|${purpose}|${context}`, "utf8");
}

export function isEnvelope(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt `plaintext` for storage at `context`, under the given root key. */
export function sealSecret(plaintext: string, root: RootKey, purpose: SecretPurpose, context: string): string {
  if (!KEY_ID.test(root.id)) throw new EnvelopeError("malformed", "Invalid key id");
  if (root.key.length !== 32) throw new EnvelopeError("malformed", "Root keys are 32 bytes");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey(root, purpose), nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(root.id, purpose, context));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${ENVELOPE_PREFIX}${VERSION}:${root.id}:${nonce.toString("base64url")}:${body.toString("base64url")}`;
}

export interface ParsedEnvelope {
  version: string;
  keyId: string;
  nonce: Buffer;
  body: Buffer;
}

/** Parse without decrypting. Strict: anything unexpected is malformed. */
export function parseEnvelope(value: string): ParsedEnvelope {
  if (!value.startsWith(ENVELOPE_PREFIX)) throw new EnvelopeError("malformed", "Not an Aeolus secret envelope");
  const parts = value.slice(ENVELOPE_PREFIX.length).split(":");
  if (parts.length !== 4) throw new EnvelopeError("malformed", "Malformed secret envelope");
  const [version, keyId, nonceText, bodyText] = parts as [string, string, string, string];
  if (version !== VERSION) throw new EnvelopeError("unsupported-version", `Unsupported secret envelope version ${version.slice(0, 8)}`);
  if (!KEY_ID.test(keyId) || !B64URL.test(nonceText) || !B64URL.test(bodyText)) throw new EnvelopeError("malformed", "Malformed secret envelope");
  const nonce = Buffer.from(nonceText, "base64url");
  const body = Buffer.from(bodyText, "base64url");
  if (nonce.length !== NONCE_BYTES || body.length < TAG_BYTES) throw new EnvelopeError("malformed", "Malformed secret envelope");
  return { version, keyId, nonce, body };
}

/** Decrypt an envelope stored at `context`. `keyFor` returns the root key for an id, or undefined. */
export function openSecret(value: string, keyFor: (id: string) => RootKey | undefined, purpose: SecretPurpose, context: string): string {
  const parsed = parseEnvelope(value);
  const root = keyFor(parsed.keyId);
  if (!root) throw new EnvelopeError("unknown-key", `Secret encrypted under key ${parsed.keyId}, which the keyring does not hold`);
  const decipher = createDecipheriv("aes-256-gcm", dataKey(root, purpose), parsed.nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(parsed.keyId, purpose, context));
  decipher.setAuthTag(parsed.body.subarray(parsed.body.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(parsed.body.subarray(0, parsed.body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new EnvelopeError("authentication-failed", "Secret failed authentication: wrong key, wrong location, or modified");
  }
}

/** Where a connector password field is stored. */
export const connectorContext = (instanceId: string, fieldId: string): string => `connector:${instanceId}:${fieldId}`;
/** Where a system setting is stored. */
export const settingContext = (key: string): string => `setting:${key}`;
