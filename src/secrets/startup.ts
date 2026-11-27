// src/secrets/startup.ts — everything the backend does with secrets before serving (H2b):
// bind the keyring (bootstrap.ts), encrypt any plaintext secrets (migration.ts), then
// install the codec that every later read and write goes through (secret-store.ts).
// Any failure throws SecretsUnavailableError and the backend does not start.

import type { Database as DatabaseType } from "better-sqlite3";
import { bootstrapSecrets, type BootstrapResult } from "./bootstrap.js";
import { migrateSecrets, type MigrationReport } from "./migration.js";
import { createSecretCodec, installSecretCodec, type SecretFieldLookup } from "./secret-store.js";

export interface SecretsStartup extends BootstrapResult {
  migration: MigrationReport;
}

export function startSecrets(db: DatabaseType, dbPath: string, lookup: SecretFieldLookup, env: NodeJS.ProcessEnv = process.env): SecretsStartup {
  installSecretCodec(null);
  const bootstrap = bootstrapSecrets(db, dbPath, lookup, { env });
  const migration = migrateSecrets(db, bootstrap.keyring, {
    lookup,
    checkpointDir: bootstrap.paths.dir,
    dbPath,
  });
  installSecretCodec(createSecretCodec(bootstrap.keyring));
  return { ...bootstrap, migration };
}
