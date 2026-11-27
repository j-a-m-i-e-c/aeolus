// src/secrets/bootstrap.ts — at startup, find (or, only for a fresh database, create)
// the keyring and check it is the one this database is bound to (H2a).
//
// H2a stores nothing encrypted yet: this establishes the keyring and the binding so
// H2b can migrate secrets into envelopes. It already fails closed: a database bound
// to a keyring that is missing or different refuses to start.

import type { Database as DatabaseType } from "better-sqlite3";
import path from "node:path";
import { bindingFor, decideBootstrap, readBinding, scanEnvelopes, writeBinding, type BootstrapDecision } from "./binding.js";
import { cleanTemporaryFiles, createKeyringExclusive, generateKeyring, KEYRING_FILE_NAME, KeyringError, loadKeyring, type Keyring } from "./keyring.js";

export interface SecretsPaths {
  dir: string;
  keyringFile: string;
}

export class SecretsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsUnavailableError";
  }
}

/**
 * The secrets directory: AEOLUS_SECRETS_DIR, else a `secrets` directory beside the
 * database directory (`/app/data/aeolus.db` → `/app/secrets`; `./data/aeolus.db` →
 * `./secrets`). The keyring must never sit inside the database directory, which is
 * what database backups copy.
 */
export function resolveSecretsPaths(dbPath: string, env: NodeJS.ProcessEnv = process.env): SecretsPaths {
  const dbDir = path.resolve(path.dirname(dbPath));
  const dir = path.resolve(env.AEOLUS_SECRETS_DIR?.trim() || path.join(dbDir, "..", "secrets"));
  const keyringFile = path.resolve(env.AEOLUS_KEYRING_FILE?.trim() || path.join(dir, KEYRING_FILE_NAME));
  const inside = (child: string) => {
    const relative = path.relative(dbDir, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  if (inside(keyringFile) || inside(dir)) {
    throw new SecretsUnavailableError(`The keyring (${keyringFile}) must not be inside the database directory (${dbDir}), which database backups copy. Set AEOLUS_SECRETS_DIR to a separate location.`);
  }
  return { dir, keyringFile };
}

export interface BootstrapResult {
  keyring: Keyring;
  paths: SecretsPaths;
  outcome: Exclude<BootstrapDecision["action"], "refuse">;
}

function loadOrNull(file: string): Keyring | null {
  try {
    return loadKeyring(file);
  } catch (error) {
    if (error instanceof KeyringError && error.reason === "missing") return null;
    throw new SecretsUnavailableError(error instanceof Error ? error.message : "The keyring could not be read");
  }
}

/** Run the startup decision. Throws SecretsUnavailableError when the backend must not start. */
export function bootstrapSecrets(db: DatabaseType, dbPath: string, env: NodeJS.ProcessEnv = process.env): BootstrapResult {
  const paths = resolveSecretsPaths(dbPath, env);
  cleanTemporaryFiles(paths.dir);
  let binding;
  try {
    binding = readBinding(db);
  } catch (error) {
    throw new SecretsUnavailableError((error as Error).message);
  }
  let keyring = loadOrNull(paths.keyringFile);
  const decision = decideBootstrap(binding, scanEnvelopes(db), keyring);
  switch (decision.action) {
    case "refuse":
      throw new SecretsUnavailableError(`${decision.reason} (keyring: ${paths.keyringFile})`);
    case "create-keyring-and-bind":
      try {
        createKeyringExclusive(paths.keyringFile, generateKeyring());
      } catch (error) {
        throw new SecretsUnavailableError(error instanceof Error ? error.message : "The keyring could not be created");
      }
      keyring = loadOrNull(paths.keyringFile);
      if (!keyring) throw new SecretsUnavailableError(`The keyring ${paths.keyringFile} was created but cannot be read back`);
      writeBinding(db, bindingFor(keyring));
      return { keyring, paths, outcome: decision.action };
    case "bind-existing-keyring":
      writeBinding(db, bindingFor(keyring!));
      return { keyring: keyring!, paths, outcome: decision.action };
    default:
      return { keyring: keyring!, paths, outcome: "ready" };
  }
}
