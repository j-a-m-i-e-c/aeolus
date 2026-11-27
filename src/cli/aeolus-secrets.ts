// src/cli/aeolus-secrets.ts — keyring administration (H2a).
//
//   aeolus-secrets init                      create the keyring if none exists
//   aeolus-secrets verify --db <path>        check a database (read-only) against the keyring
//   aeolus-secrets backup --out <file>       write a passphrase-protected keyring backup
//   aeolus-secrets restore --in <file>       recreate a missing keyring from a backup
//
// Common options: --keyring <path> (default from AEOLUS_KEYRING_FILE / AEOLUS_SECRETS_DIR /
// DB_PATH), --passphrase-file <path> (otherwise a hidden prompt on a terminal).
// A passphrase is never accepted as an argument, because arguments are visible in the
// process list and shell history. Output is counts, key ids and paths: never a key,
// a passphrase or a decrypted value.
//
// In a container: docker compose run --rm --no-deps backend node dist/cli/aeolus-secrets.js <command>

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decideBootstrap, readBinding, scanEnvelopes } from "../secrets/binding.js";
import { resolveSecretsPaths } from "../secrets/bootstrap.js";
import { connectorContext, isEnvelope, openSecret, settingContext } from "../secrets/envelope.js";
import { createKeyringBackup, openKeyringBackup, parseKeyringBackup } from "../secrets/keyring-backup.js";
import { createKeyringExclusive, generateKeyring, keyById, KeyringError, loadKeyring, type Keyring } from "../secrets/keyring.js";

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  /** Read a passphrase without echo. Undefined when there is no terminal. */
  prompt?(question: string): Promise<string>;
  env: NodeJS.ProcessEnv;
}

class UsageError extends Error {}

const USAGE = `usage: aeolus-secrets <init|verify|backup|restore> [options]
  init                         create the keyring if none exists
  verify --db <path>           check a database read-only against the keyring
  backup --out <file>          write a passphrase-protected keyring backup
  restore --in <file>          recreate a missing keyring from a backup
options: --keyring <path>  --passphrase-file <path>`;

function parseArgs(argv: string[]): { command: string; options: Map<string, string> } {
  const [command, ...rest] = argv;
  if (!command) throw new UsageError(USAGE);
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const name = rest[i]!;
    if (name === "--passphrase" || name.startsWith("--passphrase=")) {
      throw new UsageError("A passphrase is never accepted on the command line (it would be visible in the process list and shell history). Use the prompt or --passphrase-file.");
    }
    if (!["--db", "--keyring", "--out", "--in", "--passphrase-file"].includes(name)) throw new UsageError(`Unknown option ${name}\n${USAGE}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
    options.set(name, value);
    i += 1;
  }
  return { command, options };
}

function keyringPath(options: Map<string, string>, env: NodeJS.ProcessEnv): string {
  const explicit = options.get("--keyring");
  if (explicit) return path.resolve(explicit);
  return resolveSecretsPaths(env.DB_PATH || "./data/aeolus.db", env).keyringFile;
}

async function readPassphrase(options: Map<string, string>, io: CliIo, confirm: boolean): Promise<string> {
  const file = options.get("--passphrase-file");
  if (file) return fs.readFileSync(file, "utf8").replace(/\r?\n$/, "");
  if (!io.prompt) throw new UsageError("No terminal for a passphrase prompt; use --passphrase-file <path>");
  const first = await io.prompt("Keyring backup passphrase: ");
  if (confirm && (await io.prompt("Repeat the passphrase: ")) !== first) throw new UsageError("The passphrases do not match");
  return first;
}

function init(options: Map<string, string>, io: CliIo): number {
  const file = keyringPath(options, io.env);
  const ring = generateKeyring();
  createKeyringExclusive(file, ring);
  io.out(`Created keyring ${file} (installation ${ring.installationId}, key ${ring.keys[0]!.id}).`);
  io.out("Back it up now, away from this host: aeolus-secrets backup --out <file>");
  return 0;
}

/** Check every envelope in a database decrypts at its own location. Opens the database read-only. */
export function verifyDatabase(dbFile: string, ring: Keyring | null): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const binding = readBinding(db);
    const envelopes = scanEnvelopes(db);
    const decision = decideBootstrap(binding, envelopes, ring);
    lines.push(`binding: ${binding ? `installation ${binding.installationId}, keys ${binding.keys.map((k) => k.id).join(", ")}` : "none (pre-H2 or fresh database)"}`);
    lines.push(`encrypted values: ${envelopes.count}${envelopes.keyIds.length ? ` (keys ${envelopes.keyIds.join(", ")})` : ""}`);
    let failed = 0;
    let opened = 0;
    if (ring) {
      const keyFor = (id: string) => keyById(ring, id);
      for (const row of db.prepare("SELECT id, config FROM connectors").all() as Array<{ id: string; config: string }>) {
        let config: Record<string, unknown>;
        try { config = JSON.parse(row.config) as Record<string, unknown>; } catch { continue; }
        for (const [field, value] of Object.entries(config)) {
          if (!isEnvelope(value)) continue;
          try { openSecret(value, keyFor, "connector-secret", connectorContext(row.id, field)); opened += 1; } catch { failed += 1; lines.push(`cannot decrypt: connector ${row.id} field ${field}`); }
        }
      }
      for (const row of db.prepare("SELECT key, value FROM system_settings").all() as Array<{ key: string; value: string }>) {
        if (!isEnvelope(row.value)) continue;
        try { openSecret(row.value, keyFor, "setting-secret", settingContext(row.key)); opened += 1; } catch { failed += 1; lines.push(`cannot decrypt: setting ${row.key}`); }
      }
      lines.push(`decrypted: ${opened}, failed: ${failed}`);
    }
    const ok = decision.action !== "refuse" && failed === 0 && (!ring ? envelopes.count === 0 && !binding : true);
    lines.push(decision.action === "refuse" ? `result: FAIL — ${decision.reason}` : `result: ${ok ? "OK" : "FAIL"}`);
    return { ok, lines };
  } finally {
    db.close();
  }
}

function verify(options: Map<string, string>, io: CliIo): number {
  const dbFile = options.get("--db");
  if (!dbFile) throw new UsageError("verify needs --db <path>");
  const file = keyringPath(options, io.env);
  let ring: Keyring | null = null;
  try {
    ring = loadKeyring(file);
  } catch (error) {
    if (!(error instanceof KeyringError && error.reason === "missing")) throw error;
    io.out(`keyring: ${file} is missing`);
  }
  if (ring) io.out(`keyring: ${file} (installation ${ring.installationId}, keys ${ring.keys.map((k) => `${k.id}:${k.status}`).join(", ")})`);
  const result = verifyDatabase(path.resolve(dbFile), ring);
  for (const line of result.lines) io.out(line);
  return result.ok ? 0 : 1;
}

async function backup(options: Map<string, string>, io: CliIo): Promise<number> {
  const out = options.get("--out");
  if (!out) throw new UsageError("backup needs --out <file>");
  const ring = loadKeyring(keyringPath(options, io.env));
  const passphrase = await readPassphrase(options, io, true);
  const sealed = createKeyringBackup(ring, passphrase);
  // Exclusive and private: an existing backup is never overwritten.
  const fd = fs.openSync(path.resolve(out), "wx", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(sealed, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  io.out(`Wrote keyring backup ${path.resolve(out)} (installation ${sealed.installationId}, keys ${sealed.keyIds.join(", ")}).`);
  io.out("Store it away from this host, and keep the passphrase separately. Database backups need it to be restorable.");
  return 0;
}

async function restore(options: Map<string, string>, io: CliIo): Promise<number> {
  const input = options.get("--in");
  if (!input) throw new UsageError("restore needs --in <file>");
  const file = keyringPath(options, io.env);
  if (fs.existsSync(file)) throw new UsageError(`A keyring already exists at ${file}; restore never replaces one`);
  const sealed = parseKeyringBackup(fs.readFileSync(path.resolve(input), "utf8"));
  const ring = openKeyringBackup(sealed, await readPassphrase(options, io, false));
  createKeyringExclusive(file, ring);
  io.out(`Restored keyring ${file} (installation ${ring.installationId}, keys ${ring.keys.map((k) => k.id).join(", ")}).`);
  return 0;
}

/** Run one command. Returns the exit code; never throws. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    const { command, options } = parseArgs(argv);
    switch (command) {
      case "init": return init(options, io);
      case "verify": return verify(options, io);
      case "backup": return await backup(options, io);
      case "restore": return await restore(options, io);
      default: throw new UsageError(`Unknown command ${command}\n${USAGE}`);
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Failed");
    return error instanceof UsageError ? 2 : 1;
  }
}

/** A hidden-input prompt on a terminal. */
function terminalPrompt(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stderr.write("\n");
          resolve(value); return;
        }
        if (char === "\u0003") { stdin.setRawMode(false); reject(new UsageError("Cancelled")); return; }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1); else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const io: CliIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    prompt: process.stdin.isTTY ? terminalPrompt : undefined,
    env: process.env,
  };
  void runCli(process.argv.slice(2), io).then((code) => { process.exitCode = code; });
}
