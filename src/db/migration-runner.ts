// src/db/migration-runner.ts — Versioned, transactional migration runner for better-sqlite3

import type { Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { type Migration, assertUniqueIds } from "./migrations/index.js";
import {
  MigrationError,
  DatabaseNewerThanBinaryError,
  CheckpointError,
  IntegrityError,
} from "./migration-errors.js";
import logger from "../logger.js";

// ─── Public types ────────────────────────────────────────────────────────────

export interface RunMigrationsOptions {
  /** Path used to derive the checkpoint file name. Required for file-backed DBs. */
  dbPath?: string;
  /** Disable the safety checkpoint (used by in-memory tests). Default false. */
  skipCheckpoint?: boolean;
  /** Injectable clock for deterministic applied_at in tests. Default Date.now. */
  now?: () => number;
}

export interface RunMigrationsResult {
  /** Schema_Version before this run. */
  fromVersion: number;
  /** Schema_Version after this run (equals Expected_Version on success). */
  toVersion: number;
  /** Migration_Ids applied this run (empty if already up-to-date). */
  applied: number[];
  /** True if a legacy database was stamped at baseline this run. */
  adoptedLegacy: boolean;
  /** Path to the Safety_Checkpoint, if one was taken. */
  checkpointPath?: string;
}

// ─── Core helpers (exported for testing) ─────────────────────────────────────

/** Create the schema_migrations table if it does not exist (R1.5). Idempotent. */
export function ensureMigrationHistory(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

/** Schema_Version = MAX(id) in schema_migrations, or 0 when empty (R1.2, R1.3). */
export function getSchemaVersion(db: DatabaseType): number {
  const row = db.prepare("SELECT MAX(id) AS version FROM schema_migrations").get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

/** Expected_Version = the max id across the known migration set (R2.6). */
export function getExpectedVersion(migrations: Migration[]): number {
  if (migrations.length === 0) return 0;
  return Math.max(...migrations.map((m) => m.id));
}

/** Pending = migrations whose id is absent from history, ascending (R2.2, R2.3). */
export function getPendingMigrations(db: DatabaseType, migrations: Migration[]): Migration[] {
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map(
      (r) => r.id,
    ),
  );
  return migrations
    .filter((m) => !applied.has(m.id))
    .sort((a, b) => a.id - b.id);
}

/**
 * True when app tables exist but schema_migrations has no rows (R4.3).
 * Uses `automation_rules` as the sentinel table.
 */
export function isLegacyDatabase(db: DatabaseType): boolean {
  const hasApp = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_rules'",
  ).get();
  if (!hasApp) return false; // fresh, not legacy

  const hasHistory = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  ).get();
  if (!hasHistory) return true; // app tables, no history → legacy

  const row = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
  return row.n === 0; // history table exists but empty → still legacy
}

/** True when the DB has no application tables (Fresh_Database). */
export function isFreshDatabase(db: DatabaseType): boolean {
  const hasApp = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_rules'",
  ).get();
  return !hasApp;
}

/** Stamp baseline record without running baseline.up() (R4.4). */
export function adoptLegacyDatabase(
  db: DatabaseType,
  baselineMigration: Migration,
  now: () => number,
): void {
  ensureMigrationHistory(db);
  db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
    baselineMigration.id,
    baselineMigration.name,
    now(),
  );
}

/**
 * Detect a Migration_Record with id > expectedVersion (R7).
 * Returns the offending id, or null when the DB is compatible.
 */
export function findNewerThanBinary(db: DatabaseType, expectedVersion: number): number | null {
  const row = db.prepare(
    "SELECT MAX(id) AS maxId FROM schema_migrations WHERE id > ?",
  ).get(expectedVersion) as { maxId: number | null } | undefined;
  return row?.maxId ?? null;
}

/**
 * Create a synchronous, WAL-consistent safety checkpoint.
 *
 * Performs a WAL checkpoint (TRUNCATE mode) to fold all WAL data into the main
 * file, then copies the DB file. This ensures the copy is a complete snapshot.
 * Returns the checkpoint file path.
 */
export function createSafetyCheckpoint(db: DatabaseType, dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${dbPath}.pre-migration.${stamp}.bak`;
  try {
    // Fold WAL into main file for a consistent copy
    db.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(dbPath, dest);
    logger.info({ dest }, "Safety checkpoint created");
    return dest;
  } catch (err) {
    throw new CheckpointError(dest, err);
  }
}

/**
 * Clean up old checkpoint files, keeping the N most recent.
 * Called after a successful migration run.
 */
function cleanupOldCheckpoints(dbPath: string, keep: number = 5): void {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith(base) && f.includes(".pre-migration.") && f.endsWith(".bak"))
      .map((f) => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const file of files.slice(keep)) {
      fs.unlinkSync(file.path);
    }
  } catch {
    // Non-critical — best-effort cleanup
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Apply all pending migrations, or throw. Called by getDatabase() at startup.
 *
 * Guarantees: either the database reaches Expected_Version and this function
 * returns, or it throws and no half-migrated instance is exposed to the app.
 */
export function runMigrations(
  db: DatabaseType,
  migrations: Migration[],
  options: RunMigrationsOptions = {},
): RunMigrationsResult {
  const now = options.now ?? (() => Date.now());

  // R2.5: reject duplicate ids before any mutation
  assertUniqueIds(migrations);

  // R1.5: ensure the history table exists
  ensureMigrationHistory(db);

  const expectedVersion = getExpectedVersion(migrations);

  // R7: newer-than-binary fail-safe (no mutation)
  const newer = findNewerThanBinary(db, expectedVersion);
  if (newer !== null) {
    const dbVersion = getSchemaVersion(db);
    logger.error(
      { databaseVersion: dbVersion, expectedVersion },
      "Database is newer than the running binary",
    );
    throw new DatabaseNewerThanBinaryError(dbVersion, expectedVersion);
  }

  // R4: adopt legacy database at baseline (stamp only, no re-run)
  let adoptedLegacy = false;
  if (isLegacyDatabase(db)) {
    const baselineMigration = migrations.find((m) => m.id === 1);
    if (!baselineMigration) {
      throw new Error("Cannot adopt legacy database: no baseline migration (id=1) in registry");
    }
    adoptLegacyDatabase(db, baselineMigration, now);
    adoptedLegacy = true;
    logger.info({ version: 1 }, "Adopted legacy database at baseline");
  }

  const fromVersion = getSchemaVersion(db);
  const pending = getPendingMigrations(db, migrations);

  if (pending.length === 0) {
    logger.info({ version: fromVersion }, "Database already at expected version");
    return { fromVersion, toVersion: fromVersion, applied: [], adoptedLegacy };
  }

  logger.info({ fromVersion, expectedVersion }, "Applying pending migrations");

  // R8: safety checkpoint for non-empty databases
  let checkpointPath: string | undefined;
  if (!options.skipCheckpoint && !isFreshDatabase(db) && options.dbPath) {
    checkpointPath = createSafetyCheckpoint(db, options.dbPath);
  }

  // Apply loop: each migration in its own transaction with FK pragma handling
  const applied: number[] = [];
  for (const m of pending) {
    // PRAGMA foreign_keys must be toggled OUTSIDE the transaction (SQLite ignores it inside)
    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        m.up(db);
        // R9.5: verify referential integrity INSIDE the transaction so FK violations
        // prevent the migration record from being committed.
        const violations = db.pragma("foreign_key_check") as unknown[];
        if (Array.isArray(violations) && violations.length > 0) {
          throw new IntegrityError(m.id, violations);
        }
        db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
          m.id,
          m.name,
          now(),
        );
      });
      tx(); // commit on success, automatic rollback on throw
    } catch (err) {
      db.pragma("foreign_keys = ON"); // R9.3: restore on rollback
      logger.error({ id: m.id, error: (err as Error).message }, "Migration failed; halting");
      if (err instanceof IntegrityError) throw err;
      throw new MigrationError(m.id, err);
    }
    db.pragma("foreign_keys = ON"); // R9.2: restore after commit

    applied.push(m.id);
    logger.info({ id: m.id, name: m.name }, "Migration applied");
  }

  const toVersion = getSchemaVersion(db);
  if (toVersion !== expectedVersion) {
    throw new Error(
      `Migrations completed but schema version ${toVersion} !== expected ${expectedVersion}`,
    );
  }

  logger.info({ toVersion }, "All migrations applied successfully");

  // Clean up old checkpoints (best-effort)
  if (checkpointPath && options.dbPath) {
    cleanupOldCheckpoints(options.dbPath);
  }

  return { fromVersion, toVersion, applied, adoptedLegacy, checkpointPath };
}
