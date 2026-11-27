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
  });
});
