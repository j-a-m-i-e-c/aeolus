// src/db/migration-errors.ts — Structured error types for the migration runner

/**
 * Raised when a migration's `up()` throws or its record insert fails.
 * The transaction is rolled back before this error propagates.
 */
export class MigrationError extends Error {
  readonly migrationId: number;
  readonly cause: unknown;

  constructor(migrationId: number, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Migration ${migrationId} failed: ${message}`);
    this.name = "MigrationError";
    this.migrationId = migrationId;
    this.cause = cause;
  }
}

/**
 * Raised when the database contains a schema_migrations record whose id
 * exceeds the Expected_Version known to the running binary.
 * No mutation is performed — the database is left untouched.
 */
export class DatabaseNewerThanBinaryError extends Error {
  readonly databaseVersion: number;
  readonly expectedVersion: number;

  constructor(databaseVersion: number, expectedVersion: number) {
    super(
      `Database schema version ${databaseVersion} is newer than the binary expects (${expectedVersion}). ` +
      `Refusing to start — upgrade the binary or restore a compatible database.`,
    );
    this.name = "DatabaseNewerThanBinaryError";
    this.databaseVersion = databaseVersion;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Raised when the pre-migration safety checkpoint cannot be created.
 * No migrations are applied — the database is left untouched.
 */
export class CheckpointError extends Error {
  readonly destinationPath: string;
  readonly cause: unknown;

  constructor(destinationPath: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Safety checkpoint to '${destinationPath}' failed: ${message}`);
    this.name = "CheckpointError";
    this.destinationPath = destinationPath;
    this.cause = cause;
  }
}

/**
 * Raised when PRAGMA foreign_key_check reports violations after a
 * table-reconstruction migration commits.
 */
export class IntegrityError extends Error {
  readonly migrationId: number;
  readonly violations: unknown[];

  constructor(migrationId: number, violations: unknown[]) {
    super(
      `Migration ${migrationId} committed but left ${violations.length} foreign-key violation(s). ` +
      `The database may need manual repair.`,
    );
    this.name = "IntegrityError";
    this.migrationId = migrationId;
    this.violations = violations;
  }
}
