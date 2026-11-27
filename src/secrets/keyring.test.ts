// src/secrets/keyring.test.ts — keyring format, exclusive creation, atomic replacement
// and permission checks, against real files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeKey, checkPermissions, cleanTemporaryFiles, createKeyringExclusive, generateKeyring, keyById, keyFingerprint,
  KeyringError, loadKeyring, newKeyId, parseKeyring, replaceKeyringAtomic, validateKeyring, type Keyring,
} from "./keyring.js";

let dir = "";
let file = "";
const posix = process.platform !== "win32";

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-keyring-")), "secrets");
  file = path.join(dir, "keyring.json");
});
afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

function reason(work: () => unknown): string {
  try { work(); } catch (error) { if (error instanceof KeyringError) return error.reason; throw error; }
  throw new Error("expected a KeyringError");
}

describe("keyring format", () => {
  it("generates one active 32-byte key with a unique id and installation id", () => {
    const a = generateKeyring();
    const b = generateKeyring();
    expect(a.keys).toHaveLength(1);
    expect(a.keys[0]).toMatchObject({ status: "active", retiredAt: null });
    expect(activeKey(a).key).toHaveLength(32);
    expect(a.installationId).not.toBe(b.installationId);
    expect(newKeyId()).not.toBe(newKeyId());
    expect(validateKeyring(a)).toBe(a);
  });

  it("refuses malformed keyrings, naming the problem but never a key", () => {
    const base = generateKeyring();
    const variants: Array<[string, (ring: Keyring) => unknown]> = [
      ["wrong format", (r) => ({ ...r, format: "x" })],
      ["unsupported version", (r) => ({ ...r, version: 2 })],
      ["installationId", (r) => ({ ...r, installationId: "nope" })],
      ["no keys", (r) => ({ ...r, keys: [] })],
      ["not 32 bytes", (r) => ({ ...r, keys: [{ ...r.keys[0]!, key: Buffer.alloc(16).toString("base64") }] })],
      ["0 active keys", (r) => ({ ...r, keys: [{ ...r.keys[0]!, status: "pending" }] })],
      ["2 active keys", (r) => ({ ...r, keys: [r.keys[0]!, { ...r.keys[0]!, id: "k2" }] })],
      ["duplicate key id", (r) => ({ ...r, keys: [r.keys[0]!, { ...r.keys[0]!, status: "retired", retiredAt: 1 }] })],
      ["has no retiredAt", (r) => ({ ...r, keys: [r.keys[0]!, { ...r.keys[0]!, id: "k2", status: "retired" }] })],
      ["status", (r) => ({ ...r, keys: [{ ...r.keys[0]!, status: "lost" }] })],
    ];
    for (const [message, mutate] of variants) {
      let error: unknown;
      try { validateKeyring(mutate(structuredClone(base))); } catch (caught) { error = caught; }
      expect(error, message).toBeInstanceOf(KeyringError);
      expect((error as Error).message, message).toContain(message);
      expect((error as Error).message.includes(base.keys[0]!.key)).toBe(false);
    }
    expect(reason(() => parseKeyring("{"))).toBe("malformed");
  });

  it("finds keys by id and fingerprints them without revealing them", () => {
    const ring = generateKeyring();
    const key = keyById(ring, ring.keys[0]!.id)!;
    const print = keyFingerprint(key);
    expect(print).toMatch(/^[0-9a-f]{32}$/);
    expect(print.includes(key.key.toString("hex").slice(0, 32))).toBe(false);
    expect(keyFingerprint({ id: key.id, key: Buffer.alloc(32) })).not.toBe(print);
    expect(keyById(ring, "missing")).toBeUndefined();
  });
});

describe("exclusive creation and atomic replacement", () => {
  it("creates a private keyring and never replaces an existing one", () => {
    const ring = generateKeyring();
    createKeyringExclusive(file, ring);
    expect(loadKeyring(file).installationId).toBe(ring.installationId);
    if (posix) {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    }
    expect(reason(() => createKeyringExclusive(file, generateKeyring()))).toBe("exists");
    expect(loadKeyring(file).installationId).toBe(ring.installationId);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("replaces atomically and keeps the previous keyring", () => {
    const ring = generateKeyring();
    createKeyringExclusive(file, ring);
    const next: Keyring = { ...ring, keys: [{ ...ring.keys[0]!, status: "retired", retiredAt: 2 }, { ...generateKeyring().keys[0]!, id: "k-next" }] };
    replaceKeyringAtomic(file, next);
    expect(loadKeyring(file).keys.map((key) => key.id)).toEqual([ring.keys[0]!.id, "k-next"]);
    expect(parseKeyring(fs.readFileSync(path.join(dir, "keyring.prev.json"), "utf8")).keys).toHaveLength(1);
    expect(reason(() => replaceKeyringAtomic(path.join(dir, "absent.json"), next))).toBe("missing");
  });

  it("refuses to write an invalid keyring, leaving the current one", () => {
    const ring = generateKeyring();
    createKeyringExclusive(file, ring);
    expect(reason(() => replaceKeyringAtomic(file, { ...ring, keys: [] }))).toBe("malformed");
    expect(loadKeyring(file).installationId).toBe(ring.installationId);
  });

  it("ignores and cleans up a temporary file left by an interrupted write", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".keyring.123.abc.tmp"), '{"format":"aeolus-keyring","partial');
    expect(reason(() => loadKeyring(file))).toBe("missing");
    expect(cleanTemporaryFiles(dir)).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(cleanTemporaryFiles(path.join(dir, "absent"))).toBe(0);
  });

  it("reports a missing keyring as missing and an unreadable one as io", () => {
    expect(reason(() => loadKeyring(file))).toBe("missing");
    fs.mkdirSync(file, { recursive: true });
    expect(reason(() => loadKeyring(file))).toBe("io");
  });
});

describe.skipIf(!posix)("permissions (POSIX)", () => {
  it("refuses a keyring other users can read", () => {
    createKeyringExclusive(file, generateKeyring());
    fs.chmodSync(file, 0o644);
    expect(reason(() => loadKeyring(file))).toBe("insecure-permissions");
    fs.chmodSync(file, 0o600);
    expect(loadKeyring(file).keys).toHaveLength(1);
  });

  it("refuses a keyring directory other users can write", () => {
    createKeyringExclusive(file, generateKeyring());
    fs.chmodSync(dir, 0o777);
    expect(reason(() => checkPermissions(file))).toBe("insecure-permissions");
    fs.chmodSync(dir, 0o700);
    expect(checkPermissions(file)).toEqual({ checked: true });
  });
});

describe.skipIf(posix)("permissions (Windows development)", () => {
  it("does not claim to have checked permissions", () => {
    createKeyringExclusive(file, generateKeyring());
    expect(checkPermissions(file)).toEqual({ checked: false });
  });
});
