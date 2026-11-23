// src/project-api/api-keys.ts — Project API keys (ADR-0027).
//
//   aeo_<keyId>_<secret>
//
// keyId is 16 hex characters and public: it names the key in lists and logs-safe
// audit records and is how a key is looked up. The secret is 256 random bits,
// base64url. Only SHA-256(secret) is stored. A 256-bit random secret needs no salt or
// slow hash: there is nothing to guess and no dictionary to precompute.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PATTERN = /^aeo_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedKey {
  /** The full key. Returned to the admin once and never stored. */
  key: string;
  keyId: string;
  secretHash: string;
  last4: string;
}

export const hashSecret = (secret: string): string => createHash("sha256").update(secret, "utf8").digest("hex");

export function generateKey(): GeneratedKey {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { key: `aeo_${keyId}_${secret}`, keyId, secretHash: hashSecret(secret), last4: secret.slice(-4) };
}

/** The key from an Authorization header, or null when there is not exactly one well-formed key. */
export function parseBearerKey(header: string | undefined): { keyId: string; secret: string } | null {
  if (typeof header !== "string" || header.length > 200) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header.trim());
  const key = match && KEY_PATTERN.exec(match[1]!);
  return key ? { keyId: key[1]!, secret: key[2]! } : null;
}

/** Constant-time comparison of a presented secret with a stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(/^[0-9a-f]{64}$/.test(storedHash) ? storedHash : "0".repeat(64), "hex");
  return timingSafeEqual(presented, stored) && storedHash.length === 64;
}

/** A hash no real secret produces, compared against when the key id is unknown, so timing does not reveal which ids exist. */
export const UNKNOWN_KEY_HASH = "0".repeat(64);
