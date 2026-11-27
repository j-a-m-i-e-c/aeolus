// src/secrets/keyring-backup.test.ts — passphrase-protected keyring backups.
import { describe, expect, it } from "vitest";
import { generateKeyring } from "./keyring.js";
import { BACKUP_SCRYPT, createKeyringBackup, KeyringBackupError, openKeyringBackup, parseKeyringBackup, type KeyringBackup } from "./keyring-backup.js";

const PASS = "correct horse battery staple";
// The weakest parameters the reader accepts, so most tests stay fast; one test uses the real ones.
const FAST = { N: 2 ** 15, r: 8, p: 1 };

function reason(work: () => unknown): string {
  try { work(); } catch (error) { if (error instanceof KeyringBackupError) return error.reason; throw error; }
  throw new Error("expected a KeyringBackupError");
}

describe("keyring backups", () => {
  it("round-trips with the documented scrypt parameters and a random salt", () => {
    const ring = generateKeyring();
    const backup = createKeyringBackup(ring, PASS);
    expect(backup.kdf).toMatchObject({ name: "scrypt", ...BACKUP_SCRYPT });
    expect(Buffer.from(backup.kdf.salt, "base64")).toHaveLength(16);
    expect(openKeyringBackup(parseKeyringBackup(JSON.stringify(backup)), PASS)).toEqual(ring);
    expect(JSON.stringify(backup).includes(ring.keys[0]!.key)).toBe(false);
    expect(JSON.stringify(backup).includes(PASS)).toBe(false);
  });

  it("uses a new salt and nonce for every backup", () => {
    const ring = generateKeyring();
    const a = createKeyringBackup(ring, PASS, 1, FAST);
    const b = createKeyringBackup(ring, PASS, 1, FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("refuses a short passphrase", () => {
    expect(reason(() => createKeyringBackup(generateKeyring(), "short", 1, FAST))).toBe("weak-passphrase");
  });

  it("fails the same way for a wrong passphrase and for any modification", () => {
    const ring = generateKeyring();
    const backup = createKeyringBackup(ring, PASS, 1, FAST);
    expect(reason(() => openKeyringBackup(backup, "wrong passphrase!!"))).toBe("authentication-failed");
    const tamper = (change: Partial<KeyringBackup>) => openKeyringBackup({ ...backup, ...change }, PASS);
    expect(reason(() => tamper({ installationId: generateKeyring().installationId }))).toBe("authentication-failed");
    expect(reason(() => tamper({ keyIds: ["other"] }))).toBe("authentication-failed");
    expect(reason(() => tamper({ createdAt: 2 }))).toBe("authentication-failed");
    const body = Buffer.from(backup.ciphertext, "base64");
    body[0]! ^= 1;
    expect(reason(() => tamper({ ciphertext: body.toString("base64") }))).toBe("authentication-failed");
  });

  it("refuses weakened or absurd KDF parameters before deriving anything", () => {
    const backup = createKeyringBackup(generateKeyring(), PASS, 1, FAST);
    for (const kdf of [{ ...backup.kdf, N: 2 ** 10 }, { ...backup.kdf, N: 3 * 2 ** 15 }, { ...backup.kdf, r: 1 }, { ...backup.kdf, N: 2 ** 30 }, { ...backup.kdf, name: "pbkdf2" }]) {
      expect(reason(() => openKeyringBackup({ ...backup, kdf: kdf as KeyringBackup["kdf"] }, PASS)), JSON.stringify(kdf)).toBe("malformed");
    }
  });

  it("refuses files that are not backups", () => {
    for (const text of ["", "{", "[]", '{"format":"aeolus-keyring"}', JSON.stringify({ format: "aeolus-keyring-backup", version: 2 })]) {
      expect(reason(() => parseKeyringBackup(text)), text).toBe("malformed");
    }
  });
});
