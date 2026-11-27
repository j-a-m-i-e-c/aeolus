// src/__test-helpers__/secrets-migration-crash.ts — child process for the H2b crash
// test: runs the startup bootstrap and migration on a database and kills itself with
// SIGKILL at the named point, so nothing (no close, no rollback handler) runs after it.
//
//   node --import tsx secrets-migration-crash.ts <dbPath> <secretsDir> <point>

import Database from "better-sqlite3";
import { BUNDLED_CONNECTOR_MODULES, secretFieldLookup } from "../connectors/bundled.js";
import { bootstrapSecrets } from "../secrets/bootstrap.js";
import { migrateSecrets } from "../secrets/migration.js";

const [dbPath, secretsDir, point] = process.argv.slice(2) as [string, string, string];
const lookup = secretFieldLookup(BUNDLED_CONNECTOR_MODULES);
const die = (at: string) => {
  if (at === point) process.kill(process.pid, "SIGKILL");
};

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
const { keyring, paths } = bootstrapSecrets(db, dbPath, lookup, { env: { AEOLUS_SECRETS_DIR: secretsDir } as NodeJS.ProcessEnv, fault: die });
migrateSecrets(db, keyring, { lookup, checkpointDir: paths.dir, dbPath, fault: die });
db.close();
process.stdout.write("completed without reaching the crash point\n");
