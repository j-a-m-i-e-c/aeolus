// src/cli/aeolus-secrets.test.ts — the keyring CLI: init, verify (read-only), backup,
// restore and failed recovery. Output must never carry a key or a passphrase.
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSchema } from "../db/database.js";
import { bindingFor, writeBinding } from "../secrets/binding.js";
import { connectorContext, sealSecret, settingContext } from "../secrets/envelope.js";
import { activeKey, createKeyringExclusive, generateKeyring, loadKeyring } from "../secrets/keyring.js";
import { buildSyntheticDatabase } from "../__test-helpers__/secrets-fixtures.js";
import { runCli, type CliIo } from "./aeolus-secrets.js";

const PASS = "a long enough backup passphrase";
let root = "";
let lines: string[] = [];
let errors: string[] = [];

const io = (prompts: string[] = []): CliIo => ({
  out: (line) => lines.push(line),
  err: (line) => errors.push(line),
  prompt: prompts.length ? async () => prompts.shift()! : undefined,
  env: { DB_PATH: path.join(root, "data", "aeolus.db") },
});
const keyring = () => path.join(root, "secrets", "keyring.json");
const passFile = () => {
  const file = path.join(root, "pass.txt");
  fs.writeFileSync(file, `${PASS}\n`);
  return file;
};
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-cli-"));
  lines = [];
  errors = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function everything(): string {
  return [...lines, ...errors].join("\n");
}

describe("aeolus-secrets", () => {
  it("init creates a keyring once and never replaces it", async () => {
    expect(await runCli(["init"], io())).toBe(0);
    const ring = loadKeyring(keyring());
    expect(everything()).toContain(ring.installationId);
    expect(everything().includes(ring.keys[0]!.key)).toBe(false);
    expect(await runCli(["init"], io())).toBe(1);
    expect(errors.join()).toMatch(/already exists/);
    expect(loadKeyring(keyring()).keys[0]!.key).toBe(ring.keys[0]!.key);
  });

  it("refuses a passphrase on the command line, and unknown options", async () => {
    expect(await runCli(["backup", "--out", "x", "--passphrase", PASS], io())).toBe(2);
    expect(await runCli(["backup", "--out", "x", `--passphrase=${PASS}`], io())).toBe(2);
    expect(errors.join()).toMatch(/never accepted on the command line/);
    expect(await runCli(["verify", "--bogus", "1"], io())).toBe(2);
    expect(await runCli([], io())).toBe(2);
    expect(await runCli(["explode"], io())).toBe(2);
    expect(await runCli(["verify", "--db"], io())).toBe(2);
  });

  it("backs up and restores a keyring, with no key or passphrase in the output", async () => {
    await runCli(["init"], io());
    const ring = loadKeyring(keyring());
    const out = path.join(root, "keyring-backup.json");
    expect(await runCli(["backup", "--out", out, "--passphrase-file", passFile()], io())).toBe(0);
    if (process.platform !== "win32") expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    // Never overwrites an existing backup.
    expect(await runCli(["backup", "--out", out, "--passphrase-file", passFile()], io())).toBe(1);
    fs.rmSync(keyring());
    expect(await runCli(["restore", "--in", out, "--passphrase-file", passFile()], io())).toBe(0);
    expect(loadKeyring(keyring())).toEqual(ring);
    expect(await runCli(["restore", "--in", out, "--passphrase-file", passFile()], io())).toBe(2);
    expect(errors.join()).toMatch(/restore never replaces one/);
    expect(everything().includes(ring.keys[0]!.key) || everything().includes(PASS)).toBe(false);
  });

  it("prompts twice for a backup passphrase on a terminal and refuses a mismatch", async () => {
    await runCli(["init"], io());
    expect(await runCli(["backup", "--out", path.join(root, "b1.json")], io([PASS, "something else entirely"]))).toBe(2);
    expect(errors.join()).toMatch(/do not match/);
    expect(await runCli(["backup", "--out", path.join(root, "b2.json")], io([PASS, PASS]))).toBe(0);
    expect(await runCli(["backup", "--out", path.join(root, "b3.json")], io())).toBe(2);
    expect(errors.join()).toMatch(/--passphrase-file/);
  });

  it("failed recovery leaves no keyring behind", async () => {
    await runCli(["init"], io());
    const out = path.join(root, "kb.json");
    await runCli(["backup", "--out", out, "--passphrase-file", passFile()], io());
    fs.rmSync(keyring());
    fs.writeFileSync(path.join(root, "wrong.txt"), "not the passphrase at all");
    expect(await runCli(["restore", "--in", out, "--passphrase-file", path.join(root, "wrong.txt")], io())).toBe(1);
    expect(fs.existsSync(keyring())).toBe(false);
    const corrupt = path.join(root, "corrupt.json");
    fs.writeFileSync(corrupt, fs.readFileSync(out, "utf8").slice(0, 100));
    expect(await runCli(["restore", "--in", corrupt, "--passphrase-file", passFile()], io())).toBe(1);
    expect(fs.existsSync(keyring())).toBe(false);
    expect(fs.readdirSync(path.join(root, "secrets")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  describe("verify", () => {
    function database(withEnvelopes: boolean): string {
      const file = path.join(root, "verify.db");
      const db = new Database(file);
      initSchema(db);
      db.pragma("journal_mode = WAL");
      if (withEnvelopes) {
        const ring = loadKeyring(keyring());
        const key = activeKey(ring);
        db.prepare("INSERT INTO connectors (id, connector_type, enabled, config, created_at, updated_at) VALUES ('c1', 'aeolus-remote', 1, ?, 1, 1)")
          .run(JSON.stringify({ apiKey: sealSecret("remote-key", key, "connector-secret", connectorContext("c1", "apiKey")) }));
        db.prepare("INSERT INTO system_settings (key, value) VALUES ('jwt_secret', ?)").run(sealSecret("jwt", key, "setting-secret", settingContext("jwt_secret")));
        writeBinding(db, bindingFor(ring));
      }
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      return file;
    }

    it("confirms every envelope decrypts at its own location, without changing the database", async () => {
      await runCli(["init"], io());
      const file = database(true);
      const before = sha(file);
      expect(await runCli(["verify", "--db", file], io())).toBe(0);
      expect(lines).toContain("decrypted: 2, failed: 0");
      expect(lines.at(-1)).toBe("result: OK");
      expect(sha(file)).toBe(before);
      expect(everything().includes("remote-key")).toBe(false);
    });

    it("fails for a database and keyring that do not belong together", async () => {
      await runCli(["init"], io());
      const file = database(true);
      fs.rmSync(keyring());
      createKeyringExclusive(keyring(), generateKeyring());
      expect(await runCli(["verify", "--db", file], io())).toBe(1);
      expect(lines.at(-1)).toMatch(/^result: FAIL/);
      expect(lines.filter((line) => line.startsWith("cannot decrypt"))).toHaveLength(2);
    });

    it("reports a missing keyring, and a pre-H2 database as fine", async () => {
      const file = database(false);
      expect(await runCli(["verify", "--db", file], io())).toBe(0);
      expect(lines[0]).toMatch(/is missing/);
      expect(lines).toContain("binding: none (pre-H2 or fresh database)");
    });

    it("refuses a database file that does not exist", async () => {
      expect(await runCli(["verify", "--db", path.join(root, "absent.db")], io())).toBe(1);
    });

    it("fails a database that holds plaintext after encryption, naming the location only", async () => {
      await runCli(["init"], io());
      const file = database(true);
      const db = new Database(file);
      db.prepare("INSERT INTO system_settings (key, value) VALUES ('secrets_migration', ?)").run(JSON.stringify({ version: 1, state: "encrypted", keyId: "k", updatedAt: 1, cleanedAt: 1 }));
      db.prepare("INSERT INTO system_settings (key, value) VALUES ('mqtt_shared_password', 'plain-shared')").run();
      db.close();
      expect(await runCli(["verify", "--db", file], io())).toBe(1);
      expect(lines).toContain("plaintext secrets: 1 (setting mqtt_shared_password)");
      expect(everything().includes("plain-shared")).toBe(false);
    });
  });

  describe("migrate and adopt", () => {
    const dbFile = () => path.join(root, "data", "aeolus.db");
    function legacyDatabase(): Map<string, string> {
      fs.mkdirSync(path.dirname(dbFile()), { recursive: true });
      const { db, fixture } = buildSyntheticDatabase(dbFile());
      db.close();
      return fixture.secrets;
    }

    it("migrates a pre-H2 database offline: creates and binds the keyring, encrypts, and prints no value", async () => {
      const secrets = legacyDatabase();
      expect(await runCli(["migrate", "--db", dbFile()], io())).toBe(0);
      expect(lines).toContain("outcome: migrated");
      expect(lines).toContain(`encrypted now: 3 setting(s), 3 connector field(s); envelopes verified: ${secrets.size}`);
      expect(lines.some((line) => /Back the new keyring up now/.test(line))).toBe(true);
      for (const value of secrets.values()) expect(everything().includes(value)).toBe(false);
      lines = [];
      expect(await runCli(["verify", "--db", dbFile()], io())).toBe(0);
      expect(lines).toContain(`decrypted: ${secrets.size}, failed: 0`);
      expect(lines).toContain("plaintext secrets: 0");
      lines = [];
      expect(await runCli(["migrate", "--db", dbFile()], io())).toBe(0);
      expect(lines).toContain("outcome: already-encrypted");
    });

    it("uses an explicit --keyring, with the checkpoint beside it", async () => {
      legacyDatabase();
      const ring = path.join(root, "elsewhere", "ring.json");
      expect(await runCli(["migrate", "--db", dbFile(), "--keyring", ring], io())).toBe(0);
      expect(loadKeyring(ring).boundAt).toEqual(expect.any(Number));
      expect(fs.existsSync(keyring())).toBe(false);
      expect(fs.readdirSync(path.dirname(ring)).filter((name) => name.startsWith("pre-secrets-"))).toEqual([]);
    });

    it("refuses plaintext found after encryption unless --reencrypt-plaintext is given", async () => {
      legacyDatabase();
      await runCli(["migrate", "--db", dbFile()], io());
      const db = new Database(dbFile());
      db.prepare("UPDATE system_settings SET value = 'restored-plain' WHERE key = 'mqtt_backend_password'").run();
      db.close();
      expect(await runCli(["migrate", "--db", dbFile()], io())).toBe(1);
      expect(errors.join()).toMatch(/--reencrypt-plaintext/);
      expect(everything().includes("restored-plain")).toBe(false);
      expect(await runCli(["migrate", "--db", dbFile(), "--reencrypt-plaintext"], io())).toBe(0);
      expect(lines).toContain("encrypted now: 1 setting(s), 0 connector field(s); envelopes verified: 6");
    });

    it("adopt binds a restored database without a binding, which startup and migrate otherwise refuse", async () => {
      legacyDatabase();
      await runCli(["migrate", "--db", dbFile()], io());
      // A restored backup from before H2: plaintext, no binding.
      fs.rmSync(dbFile());
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${dbFile()}${suffix}`, { force: true });
      legacyDatabase();
      expect(await runCli(["migrate", "--db", dbFile()], io())).toBe(1);
      expect(errors.join()).toMatch(/records no binding.*aeolus-secrets adopt/s);
      expect(await runCli(["adopt", "--db", dbFile()], io())).toBe(0);
      expect(await runCli(["migrate", "--db", dbFile()], io())).toBe(0);
      expect(lines).toContain("outcome: migrated");
      expect(await runCli(["adopt", "--db", dbFile()], io())).toBe(1);
      expect(await runCli(["adopt"], io())).toBe(2);
      expect(await runCli(["migrate"], io())).toBe(2);
    });
  });
});
