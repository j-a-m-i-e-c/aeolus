// src/mqtt/mosquitto-password-hash.ts — Native Mosquitto-compatible password hashing.
//
// Mosquitto 2.x authenticates password-file entries of the form
//   username:$7$<iterations>$<base64 salt>$<base64 hash>
// where `$7$` selects the sha512-pbkdf2 scheme. On authentication the broker
// reads the iteration count and salt back out of the stored line and recomputes
// PBKDF2-HMAC-SHA512, so any line we produce with this structure verifies
// regardless of the iteration count or salt we picked.
//
// Generating these hashes natively (Node's crypto) removes the previous
// dependencies that made dashboard provisioning fail against a real broker:
//   * bcrypt hashes ($2b$…) — Mosquitto cannot read them at all; and
//   * shelling out to `mosquitto_passwd` inside the broker container, which
//     required mounting the Docker socket into the backend.

import crypto from "node:crypto";

/** Scheme identifier for Mosquitto's sha512-pbkdf2 password hashes. */
const SHA512_PBKDF2_ID = "7";

/** SHA-512 digest length in bytes — the PBKDF2 derived-key length Mosquitto uses. */
const HASH_BYTES = 64;

/** Salt length in bytes. Matches mosquitto_passwd (96-bit salt). */
const SALT_BYTES = 12;

/**
 * Default PBKDF2 iteration count. The value is embedded in every hash line and
 * read back by the broker at verification time, so it can be tuned freely.
 * Overridable via MQTT_PBKDF2_ITERATIONS for deployments that want a different
 * cost/latency trade-off (the broker recomputes the KDF on every connection).
 */
const DEFAULT_ITERATIONS = 100_000;

/** Resolve the configured iteration count, falling back to the default. */
function resolveIterations(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env.MQTT_PBKDF2_ITERATIONS;
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_ITERATIONS;
}

/**
 * Produce a Mosquitto-compatible sha512-pbkdf2 password hash.
 *
 * @param password  The plaintext password to hash.
 * @param iterations Optional iteration count (defaults to the configured value).
 * @returns A `$7$<iterations>$<base64 salt>$<base64 hash>` string.
 */
export function hashMosquittoPassword(password: string, iterations?: number): string {
  const rounds = resolveIterations(iterations);
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.pbkdf2Sync(password, salt, rounds, HASH_BYTES, "sha512");

  return [
    "",
    SHA512_PBKDF2_ID,
    String(rounds),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Build a full password-file line: `username:$7$…`.
 *
 * @param username The Mosquitto username.
 * @param password The plaintext password to hash into the line.
 * @param iterations Optional iteration count.
 */
export function buildPasswordLine(
  username: string,
  password: string,
  iterations?: number,
): string {
  return `${username}:${hashMosquittoPassword(password, iterations)}`;
}

/**
 * Verify a plaintext password against a Mosquitto `$7$` hash line.
 * Exposed primarily for tests; the broker performs the authoritative check.
 *
 * @param password The candidate plaintext.
 * @param hash A `$7$<iterations>$<salt>$<hash>` string.
 * @returns true when the password matches the stored hash.
 */
export function verifyMosquittoPassword(password: string, hash: string): boolean {
  const parts = hash.split("$");
  // Leading empty segment + [id, iterations, salt, hash] = 5 elements.
  if (parts.length !== 5 || parts[1] !== SHA512_PBKDF2_ID) return false;

  const iterations = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const salt = Buffer.from(parts[3], "base64");
  const expected = Buffer.from(parts[4], "base64");
  const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, "sha512");

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
