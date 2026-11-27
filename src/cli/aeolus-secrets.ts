// src/cli/aeolus-secrets.ts — keyring and stored-secret administration (H2a, H2b).
//
//   aeolus-secrets init                      create the keyring if none exists
//   aeolus-secrets verify --db <path>        check a database (read-only) against the keyring
//   aeolus-secrets backup --out <file>       write a passphrase-protected keyring backup
//   aeolus-secrets restore --in <file>       recreate a missing keyring from a backup
//   aeolus-secrets migrate --db <path>       encrypt a database's secrets offline (backend stopped);
//                                            --reencrypt-plaintext accepts plaintext found after
//                                            encryption (a deliberate restore or edit)
//   aeolus-secrets adopt --db <path>         bind a database that has no binding (a restored
//                                            older backup) to the existing, already-bound keyring
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
import { BUNDLED_CONNECTOR_MODULES, secretFieldLookup } from "../connectors/bundled.js";
import { decideBootstrap, readBinding, scanEnvelopes } from "../secrets/binding.js";
import { adoptDatabase, bootstrapSecrets, resolveSecretsPaths } from "../secrets/bootstrap.js";
import { isEnvelope, openSecret } from "../secrets/envelope.js";
import { collectSecretValues, describeLocation, locationId as locationIdFor, purposeOf } from "../secrets/locations.js";
import { migrateSecrets, readMarker } from "../secrets/migration.js";
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

const USAGE = `usage: aeolus-secrets <init|verify|backup|restore|migrate|adopt> [options]
  init                         create the keyring if none exists
  verify --db <path>           check a database read-only against the keyring
  backup --out <file>          write a passphrase-protected keyring backup
  restore --in <file>          recreate a missing keyring from a backup
  migrate --db <path>          encrypt the database's secrets (stop the backend first)
          [--reencrypt-plaintext]  also when plaintext appears after encryption
  adopt --db <path>            bind an unbound (restored) database to the existing keyring
options: --keyring <path>  --passphrase-file <path>`;

const lookup = secretFieldLookup(BUNDLED_CONNECTOR_MODULES);

const FLAGS = ["--reencrypt-plaintext"];

function parseArgs(argv: string[]): { command: string; options: Map<string, string> } {
  const [command, ...rest] = argv;
  if (!command) throw new UsageError(USAGE);
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const name = rest[i]!;
    if (name === "--passphrase" || name.startsWith("--passphrase=")) {
      throw new UsageError("A passphrase is never accepted on the command line (it would be visible in the process list and shell history). Use the prompt or --passphrase-file.");
    }
    if (FLAGS.includes(name)) {
      options.set(name, "true");
      continue;
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

/**
 * Check a database against a keyring. Opens the database read-only. Prints locations,
 * counts and key ids, never a value. OK means the backend would start with this pair
 * and that every envelope decrypts at its own location.
 */
export function verifyDatabase(dbFile: string, ring: Keyring | null): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const binding = readBinding(db);
    const marker = readMarker(db);
    const inventory = collectSecretValues(db, lookup);
    const envelopes = scanEnvelopes(db, lookup);
    const decision = decideBootstrap(binding, envelopes, ring);
    const plaintext = inventory.values.filter((item) => !isEnvelope(item.value));
    lines.push(`binding: ${binding ? `installation ${binding.installationId}, keys ${binding.keys.map((k) => k.id).join(", ")}` : "none (pre-H2 or fresh database)"}`);
    lines.push(`secrets: ${marker ? `${marker.state}${marker.state === "encrypted" ? (marker.cleanedAt ? ", cleaned" : ", clean pending") : ""}` : "not encrypted yet"}`);
    lines.push(`encrypted values: ${envelopes.count}${envelopes.keyIds.length ? ` (keys ${envelopes.keyIds.join(", ")})` : ""}`);
    lines.push(`plaintext secrets: ${plaintext.length}${plaintext.length ? ` (${plaintext.map((item) => describeLocation(item.location)).join(", ")})` : ""}`);
    if (inventory.unknownTypes.length) lines.push(`connectors of unregistered types, not examined: ${inventory.unknownTypes.length}`);
    let failed = 0;
    if (ring) {
      const keyFor = (id: string) => keyById(ring, id);
      let opened = 0;
      for (const item of inventory.values) {
        if (!isEnvelope(item.value)) continue;
        try {
          openSecret(item.value, keyFor, purposeOf(item.location), locationIdFor(item.location));
          opened += 1;
        } catch {
          failed += 1;
          lines.push(`cannot decrypt: ${describeLocation(item.location)}`);
        }
      }
      lines.push(`decrypted: ${opened}, failed: ${failed}`);
    }
    const plaintextAfterEncryption = marker?.state === "encrypted" && plaintext.length > 0;
    if (plaintextAfterEncryption) lines.push("plaintext after encryption: the backend would refuse to start (see migrate --reencrypt-plaintext)");
    const ok = decision.action !== "refuse" && failed === 0 && !plaintextAfterEncryption && (ring ? true : envelopes.count === 0 && !binding);
    lines.push(decision.action === "refuse" ? `result: FAIL — ${decision.reason}` : `result: ${ok ? "OK" : "FAIL"}`);
    return { ok, lines };
  } finally {
    db.close();
  }
}

/** Keyring and secrets directory for a command that names a database. */
function pathsFor(options: Map<string, string>, dbFile: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const explicit = options.get("--keyring");
  if (!explicit) return env;
  const keyringFile = path.resolve(explicit);
  return { ...env, AEOLUS_KEYRING_FILE: keyringFile, AEOLUS_SECRETS_DIR: path.dirname(keyringFile) };
}

function migrate(options: Map<string, string>, io: CliIo): number {
  const dbOption = options.get("--db");
  if (!dbOption) throw new UsageError("migrate needs --db <path>");
  const dbFile = path.resolve(dbOption);
  const env = pathsFor(options, dbFile, io.env);
  const db = new Database(dbFile, { fileMustExist: true });
  try {
    const boot = bootstrapSecrets(db, dbFile, lookup, { env });
    io.out(`keyring: ${boot.paths.keyringFile} (installation ${boot.keyring.installationId}; ${boot.outcome})`);
    const report = migrateSecrets(db, boot.keyring, {
      lookup,
      checkpointDir: boot.paths.dir,
      dbPath: dbFile,
      reencryptPlaintext: options.has("--reencrypt-plaintext"),
    });
    io.out(`outcome: ${report.outcome}`);
    io.out(`encrypted now: ${report.encrypted.settings} setting(s), ${report.encrypted.connectorFields} connector field(s); envelopes verified: ${report.verified}`);
    for (const where of report.clearedPlaceholders) io.out(`placeholder cleared (enter the secret again): ${where}`);
    if (report.unknownConnectorTypes) io.out(`connectors of unregistered types, not examined: ${report.unknownConnectorTypes}`);
    if (report.malformedConnectors) io.out(`connectors with unreadable config, not examined: ${report.malformedConnectors}`);
    io.out(`cleanup (VACUUM, WAL truncation): ${report.cleaned ? "done" : "pending; rerun"}`);
    for (const file of report.plaintextCopies) io.out(`older copy that may hold plaintext (not deleted): ${file}`);
    if (report.outcome === "migrated") io.out("Database backups, snapshots and copies made before now still hold these secrets in plaintext.");
    if (boot.outcome === "create-keyring-and-bind") io.out("Back the new keyring up now, away from this host: aeolus-secrets backup --out <file>");
    return 0;
  } finally {
    db.close();
  }
}

function adopt(options: Map<string, string>, io: CliIo): number {
  const dbOption = options.get("--db");
  if (!dbOption) throw new UsageError("adopt needs --db <path>");
  const dbFile = path.resolve(dbOption);
  const env = pathsFor(options, dbFile, io.env);
  const keyringFile = resolveSecretsPaths(dbFile, env).keyringFile;
  const db = new Database(dbFile, { fileMustExist: true });
  try {
    const ring = adoptDatabase(db, keyringFile, lookup);
    io.out(`Bound ${dbFile} to keyring ${keyringFile} (installation ${ring.installationId}). Its secrets are encrypted at the next start, or now with: aeolus-secrets migrate --db ${dbFile}`);
    return 0;
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
      case "migrate": return migrate(options, io);
      case "adopt": return adopt(options, io);
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
