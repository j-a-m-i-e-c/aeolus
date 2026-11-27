// src/secrets/bootstrap.ts — at startup, find (or, only for a fresh database, create)
// the keyring and check it is the one this database is bound to (H2a, H2b).
//
// The order of writes makes every crash point resumable:
//
//   1. create the keyring (exclusive; boundAt absent)
//   2. commit the binding in the database
//   3. set boundAt in the keyring (atomic replace)
//
// After a crash between 1 and 2 the keyring is unbound and the database has no binding:
// the next start binds them. After a crash between 2 and 3 the binding matches and the
// next start sets boundAt. Once boundAt is set, a database without a binding is refused
// (see decideBootstrap), so a restored older database is never silently treated as new.

import type { Database as DatabaseType } from "better-sqlite3";
import path from "node:path";
import { bindingFor, decideBootstrap, readBinding, scanEnvelopes, writeBinding, type BootstrapDecision } from "./binding.js";
import { SecretsUnavailableError } from "./errors.js";
import { cleanTemporaryFiles, createKeyringExclusive, generateKeyring, KEYRING_FILE_NAME, KeyringError, loadKeyring, replaceKeyringAtomic, type Keyring } from "./keyring.js";
import type { SecretFieldLookup } from "./secret-store.js";

export { SecretsUnavailableError };

export interface SecretsPaths {
  dir: string;
  keyringFile: string;
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

/** Crash points for tests: the hook may throw to stop the bootstrap there. */
export type BootstrapPoint = "after-keyring-created" | "after-binding-committed";

export interface BootstrapOptions {
  env?: NodeJS.ProcessEnv;
  fault?: (point: BootstrapPoint) => void;
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

/** Record in the keyring that a database is bound to it (step 3). Idempotent. */
function markBound(file: string, keyring: Keyring): Keyring {
  if (keyring.boundAt !== undefined) return keyring;
  const marked: Keyring = { ...keyring, boundAt: Date.now() };
  try {
    replaceKeyringAtomic(file, marked);
  } catch (error) {
    throw new SecretsUnavailableError(`The keyring ${file} could not be updated to record its binding (${error instanceof Error ? error.message : "error"}). The keyring must be writable by the backend.`);
  }
  return marked;
}

/** Run the startup decision. Throws SecretsUnavailableError when the backend must not start. */
export function bootstrapSecrets(db: DatabaseType, dbPath: string, lookup: SecretFieldLookup, options: BootstrapOptions = {}): BootstrapResult {
  const paths = resolveSecretsPaths(dbPath, options.env ?? process.env);
  cleanTemporaryFiles(paths.dir);
  let binding;
  try {
    binding = readBinding(db);
  } catch (error) {
    throw new SecretsUnavailableError((error as Error).message);
  }
  let keyring = loadOrNull(paths.keyringFile);
  const decision = decideBootstrap(binding, scanEnvelopes(db, lookup), keyring);
  switch (decision.action) {
    case "refuse":
      throw new SecretsUnavailableError(`${decision.reason} (keyring: ${paths.keyringFile})`);
    case "create-keyring-and-bind":
      try {
        createKeyringExclusive(paths.keyringFile, generateKeyring());
      } catch (error) {
        throw new SecretsUnavailableError(error instanceof Error ? error.message : "The keyring could not be created");
      }
      options.fault?.("after-keyring-created");
      keyring = loadOrNull(paths.keyringFile);
      if (!keyring) throw new SecretsUnavailableError(`The keyring ${paths.keyringFile} was created but cannot be read back`);
      break;
    case "bind-existing-keyring":
      break;
    default:
      // Bound and matching. A crash after the binding committed may have left boundAt unset.
      return { keyring: markBound(paths.keyringFile, keyring!), paths, outcome: "ready" };
  }
  writeBinding(db, bindingFor(keyring!));
  options.fault?.("after-binding-committed");
  return { keyring: markBound(paths.keyringFile, keyring!), paths, outcome: decision.action };
}

/** Bind an unbound database to an existing keyring on an operator's explicit request (`aeolus-secrets adopt`). */
export function adoptDatabase(db: DatabaseType, keyringFile: string, lookup: SecretFieldLookup): Keyring {
  const keyring = loadOrNull(keyringFile);
  if (!keyring) throw new SecretsUnavailableError(`There is no keyring at ${keyringFile} to adopt this database into`);
  let binding;
  try {
    binding = readBinding(db);
  } catch (error) {
    throw new SecretsUnavailableError((error as Error).message);
  }
  if (binding) {
    throw new SecretsUnavailableError(binding.installationId === keyring.installationId
      ? "This database is already bound to this keyring; nothing to adopt"
      : "This database is bound to a different installation's keyring; adopt only binds a database that has no binding");
  }
  if (scanEnvelopes(db, lookup).count > 0) {
    throw new SecretsUnavailableError("This database holds encrypted secrets but no binding; it cannot be adopted safely");
  }
  writeBinding(db, bindingFor(keyring));
  return markBound(keyringFile, keyring);
}
