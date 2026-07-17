# Implementation Plan: Versioned DB Migrations

## Overview

Convert the feature design into a series of incremental coding steps for the Aeolus SQLite migration system. The system replaces the ad-hoc schema evolution inside `initSchema()` (in `src/db/database.ts`) with a versioned, ordered, transactional migration runner.

Each step builds on the previous one and ends with wiring the runner into `getDatabase()` startup, so there is no orphaned or unintegrated code:

1. Establish the `Migration` interface and registry (`src/db/migrations/index.ts`).
2. Build the version-tracking helpers on top of a `schema_migrations` table (`src/db/migration-runner.ts`).
3. Add legacy detection and adoption.
4. Author the three concrete migrations (baseline, automation_rules columns, devices CHECK removal), registering each into the array.
5. Add the safety checkpoint.
6. Assemble the `runMigrations` apply loop plus error types.
7. Wire the runner into `getDatabase()`, add observability logging, then migrate the existing tests and run the full suite.

Implementation language: **TypeScript** (matches the existing codebase and the code in the design).

Testing is first-class. The design defines **13 correctness properties** and a testing strategy using **vitest** + **`@fast-check/vitest`**, mirroring `src/db/database.test.ts` (example/unit) and `src/db/database.property.test.ts` (property). Property tests run a minimum of **100 iterations** (`{ numRuns: 100 }`) and are tagged in the format `Feature: versioned-db-migrations, Property N: <text>`.

**Test file layout**
- `src/db/migration-runner.property.test.ts` — all property-based tests (Properties 1–13)
- `src/db/migration-runner.test.ts` — example/unit tests
- `src/db/migration-runner.integration.test.ts` — file-backed WAL integration tests
- `src/db/database.test.ts` / `src/db/database.property.test.ts` — migrated to exercise the runner (final task)

## Tasks

- [ ] 1. Define the Migration interface and registry
  - [ ] 1.1 Create `src/db/migrations/index.ts` with the `Migration` interface and duplicate-id guard
    - Define `interface Migration { id: number; name: string; up(db: DatabaseType): void; down?(db: DatabaseType): void }` (`down` reserved for a future version, never invoked in v1)
    - Export an ordered `migrations: Migration[]` array, initially empty; concrete migrations (001/002/003) are appended by tasks 4–6
    - Implement and export `assertUniqueIds(migrations: Migration[]): void` that throws an `Error` naming the duplicated `id` when two entries share a `Migration_Id`
    - _Requirements: 2.1, 2.5, 10.4_

  - [ ]* 1.2 Write property test for duplicate-id rejection
    - **Property 5: Duplicate ids are rejected**
    - In `src/db/migration-runner.property.test.ts`, generate migration sets containing two entries with the same id and assert `assertUniqueIds` throws an error whose message identifies the duplicated id and that nothing is applied
    - Tag: `Feature: versioned-db-migrations, Property 5: Duplicate ids are rejected`; `{ numRuns: 100 }`
    - _Requirements: 2.1, 2.5_

- [ ] 2. Implement schema version tracking and history helpers
  - [ ] 2.1 Create `src/db/migration-runner.ts` version-query helpers over `schema_migrations`
    - Implement `ensureMigrationHistory(db)` that creates `schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)` with `IF NOT EXISTS` (idempotent)
    - Implement `getSchemaVersion(db)` returning `MAX(id)` from `schema_migrations`, or `0` when empty
    - Implement `getExpectedVersion(migrations)` returning the max `id` across the registry
    - Implement `getPendingMigrations(db, migrations)` returning registry migrations whose `id` is absent from history, sorted ascending
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.2, 2.3, 2.6_

  - [ ]* 2.2 Write property tests for history and pending derivation
    - **Property 1: Migration history records each applied migration exactly once with a timestamp** — `Validates: Requirements 1.1, 1.6`
    - **Property 2: Schema_Version equals the maximum recorded Migration_Id** — `Validates: Requirements 1.2, 1.3`
    - **Property 3: Pending migrations are exactly the unrecorded migrations, ascending** — `Validates: Requirements 2.2`
    - In `src/db/migration-runner.property.test.ts`: generate arbitrary subsets of stamped ids (including empty) and assert `getSchemaVersion` and `getPendingMigrations` behave as specified; each property its own test tagged `Feature: versioned-db-migrations, Property N: <text>`; `{ numRuns: 100 }`
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 2.2_

  - [ ]* 2.3 Write unit test for `ensureMigrationHistory` idempotence
    - In `src/db/migration-runner.test.ts`, assert `schema_migrations` is created and that calling `ensureMigrationHistory` twice does not throw and leaves the table intact
    - _Requirements: 1.5_

- [ ] 3. Implement legacy detection and adoption
  - [ ] 3.1 Add legacy/fresh classification and adoption to `src/db/migration-runner.ts`
    - Implement `isFreshDatabase(db)` (no application tables present) and `isLegacyDatabase(db)` (application `automation_rules` sentinel table exists but `schema_migrations` is absent or empty), per the design's `sqlite_master` inspection
    - Implement `adoptLegacyDatabase(db, baseline, now)` that calls `ensureMigrationHistory` and stamps only the baseline `Migration_Record` (`id`, `name`, `applied_at`) without executing `baseline.up()`
    - _Requirements: 4.3, 4.4, 4.5_

  - [ ]* 3.2 Write property test for legacy classification
    - **Property 10: Legacy database classification**
    - In `src/db/migration-runner.property.test.ts`, generate fresh / legacy / versioned database states and assert `isLegacyDatabase` is true exactly when app tables exist but `schema_migrations` has no rows, false otherwise
    - Tag: `Feature: versioned-db-migrations, Property 10: Legacy database classification`; `{ numRuns: 100 }`
    - _Requirements: 4.3_

  - [ ]* 3.3 Write unit test for adoption preserving existing rows
    - In `src/db/migration-runner.test.ts`, seed a legacy database with rows, run `adoptLegacyDatabase`, and assert the baseline record is stamped and all seeded rows remain unchanged (baseline create statements not re-run destructively)
    - _Requirements: 4.4, 4.5_

- [ ] 4. Author the baseline migration (001)
  - [ ] 4.1 Create `src/db/migrations/001-baseline.ts` with the full current production schema
    - Export `baseline: Migration` (id 1, name `"baseline"`) whose `up(db)` creates all 13 tables (`devices`, `automation_rules`, `tabs`, `panes`, `connectors`, `automation_state`, `device_history`, `groups`, `users`, `group_tab_assignments`, `refresh_tokens`, `mqtt_credentials`, `system_settings`) and the 3 indexes (`idx_device_history_device_ts`, `idx_refresh_tokens_user`, `idx_refresh_tokens_hash`), reusing the current `initSchema` body as the baseline (devices table WITHOUT the `CHECK` constraint; automation_rules WITHOUT the later-added columns, which belong to migration 002)
    - Register `baseline` as the first entry in the `migrations` array in `src/db/migrations/index.ts`
    - _Requirements: 4.1, 4.2_

  - [ ]* 4.2 Write unit test that the baseline produces the expected tables and indexes
    - In `src/db/migration-runner.test.ts`, apply `baseline.up` to a fresh in-memory DB and assert all 13 tables and 3 indexes exist (mirrors the existing `initSchema` table-list test)
    - _Requirements: 4.1_

- [ ] 5. Author the automation_rules columns migration (002)
  - [ ] 5.1 Create `src/db/migrations/002-automation-rules-columns.ts`, guarded
    - Export `automationRulesColumns: Migration` (id 2) whose `up(db)` reads `PRAGMA table_info(automation_rules)` and adds only missing columns among `rule_type`, `script_source`, `compiled_js`, `structured_metadata`, `ui_source`, `compiled_ui`, `trigger_type`, `cron_expression`, then runs the idempotent backfill `UPDATE automation_rules SET rule_type = 'form' WHERE rule_type IS NULL`
    - Register `automationRulesColumns` as the second entry in the `migrations` array
    - _Requirements: 5.1, 5.2, 5.4_

  - [ ]* 5.2 Write unit test for column addition and backfill
    - In `src/db/migration-runner.test.ts`, start from a baseline `automation_rules` table, seed a row with null `rule_type`, apply migration 002, and assert all 8 columns now exist and the row's `rule_type` is backfilled to `'form'`
    - _Requirements: 5.1, 5.2_

- [ ] 6. Author the devices CHECK-removal migration (003)
  - [ ] 6.1 Create `src/db/migrations/003-devices-remove-check.ts`, guarded
    - Export `devicesRemoveCheck: Migration` (id 3) whose `up(db)` inspects `sqlite_master` for the `CHECK(` pattern on `devices`; if absent it returns (no-op); if present it renames `devices` to `devices_old`, recreates `devices` without the constraint, copies `id`, `name`, `type`, `capabilities`, `state`, `integration`, `last_seen`, and drops `devices_old`
    - Do NOT manage `BEGIN/COMMIT/ROLLBACK` or the `foreign_keys` pragma inside the migration — the runner owns the transaction and pragma (task 9)
    - Register `devicesRemoveCheck` as the third entry in the `migrations` array
    - _Requirements: 5.3, 5.5, 5.6_

  - [ ]* 6.2 Write property tests for data preservation and guarded no-ops
    - **Property 9: Data preservation across adoption and reconstruction** — `Validates: Requirements 4.5, 5.6, 13.3`
    - **Property 11: Guarded migrations are safe no-ops when their change already exists** — `Validates: Requirements 5.4, 5.5`
    - In `src/db/migration-runner.property.test.ts`, seed legacy databases with arbitrary rows (including `devices` rows with the old `CHECK` constraint and arbitrary subsets of the 002 columns already present); run the full runner and assert every seeded row and column value is preserved, and that guarded migrations neither throw nor alter already-present columns/structure/data; each property its own test, `{ numRuns: 100 }`
    - _Requirements: 4.5, 5.4, 5.5, 5.6, 13.3_

  - [ ]* 6.3 Write unit test porting the existing CHECK-removal scenario to the runner
    - In `src/db/migration-runner.test.ts`, seed a `devices` table with the `CHECK(type IN (...))` constraint and a row, run the runner, and assert the constraint is gone, the row survives with all columns intact, and a novel `type` value now inserts (direct port of the current `database.test.ts` scenario)
    - _Requirements: 5.3, 5.6, 13.4_

- [ ] 7. Checkpoint - migrations converge to the reference schema
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement the safety checkpoint mechanism
  - [ ] 8.1 Add `createSafetyCheckpoint` and retention to `src/db/migration-runner.ts`
    - Implement a synchronous, WAL-consistent checkpoint that writes a timestamped sibling file `${dbPath}.pre-migration.<stamp>.bak`. Resolve the sync-vs-async `db.backup()` question noted in the design by using a synchronous WAL-consistent mechanism: run `PRAGMA wal_checkpoint(TRUNCATE)` then copy the DB file via `fs`, or an equivalent synchronous snapshot; return the checkpoint path
    - On failure, throw a `CheckpointError` describing the failure so the caller halts before any migration mutates the DB
    - Implement retention that keeps the N most recent `*.pre-migration.*.bak` files (default N=5), cleaning up only after a successful migration set
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 8.2 Write unit tests for checkpoint behavior
    - In `src/db/migration-runner.test.ts` (using a real temp-file DB): non-empty DB with pending migrations creates and retains a checkpoint file; a fresh DB skips it; an injected failing checkpoint halts before applying and surfaces the error
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [ ]* 8.3 Write integration test for WAL-consistent checkpoint
    - In `src/db/migration-runner.integration.test.ts`, on a file-backed WAL database write and commit data, take a checkpoint, open the checkpoint file as a separate database, and assert it is a complete, consistent copy (1–2 representative cases)
    - _Requirements: 8.4_

- [ ] 9. Implement the migration runner apply loop and error types
  - [ ] 9.1 Create `src/db/migration-errors.ts` with the runner error types
    - Implement `MigrationError(id, cause)`, `DatabaseNewerThanBinaryError(dbVersion, expected)`, `CheckpointError(dest, cause)`, and `IntegrityError(id, violations)`, each extending `Error` and carrying the structured fields used for logging and messages
    - _Requirements: 3.4, 7.3, 8.3, 9.5_

  - [ ] 9.2 Implement `runMigrations` and `findNewerThanBinary` in `src/db/migration-runner.ts`
    - Implement `findNewerThanBinary(db, expected)` returning a recorded `id` greater than `Expected_Version` or `null`
    - Implement `runMigrations(db, migrations, options)`: call `assertUniqueIds` and `ensureMigrationHistory`; throw `DatabaseNewerThanBinaryError` (no mutation) when a newer record exists; adopt a legacy DB at baseline; compute pending; return early (up-to-date) when none; create a safety checkpoint for non-empty DBs (unless `skipCheckpoint`); then for each pending migration in ascending order toggle `PRAGMA foreign_keys = OFF` OUTSIDE the `db.transaction`, apply `up` + insert the record inside the transaction, restore `foreign_keys = ON` after commit or rollback, run `PRAGMA foreign_key_check` and throw `IntegrityError` on violations; halt on the first failure with `MigrationError`; after the loop verify `Schema_Version === Expected_Version` and otherwise throw an unreachable-version error; return `RunMigrationsResult`
    - Wire the registry from `src/db/migrations/index.ts` as the default migration set
    - _Requirements: 2.4, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.6, 4.7, 6.2, 6.4, 7.1, 7.2, 7.4, 9.1, 9.2, 9.3, 9.5, 10.1, 10.2, 12.2_

  - [ ]* 9.3 Write property test for convergence
    - **Property 6: Convergence to Expected_Version with an equivalent final schema**
    - In `src/db/migration-runner.property.test.ts`, for fresh and seeded-legacy starting databases assert `runMigrations` reaches `Expected_Version` and the resulting schema matches an oracle built by the legacy `initSchema()` (normalized `sqlite_master` comparison), and that fresh-migrated and legacy-adopted-migrated schemas are equivalent; `{ numRuns: 100 }`
    - _Requirements: 2.6, 4.2, 4.7, 5.7, 6.2, 13.2, 13.6_

  - [ ]* 9.4 Write property test for idempotence and exactly-once
    - **Property 7: Idempotence and exactly-once application**
    - Assert running `runMigrations` repeatedly applies each `up` at most once, later runs change nothing, and `Schema_Version` never changes after the first full run; `{ numRuns: 100 }`
    - _Requirements: 1.6, 2.4, 13.5_

  - [ ]* 9.5 Write property test for halt-and-rollback
    - **Property 8: Halt-and-rollback leaves the prior consistent state**
    - Inject a throwing `up` at an arbitrary position k and assert the failing migration's schema change and record do not persist, no later migration runs, earlier records are retained, `Schema_Version` equals its pre-k value, and `foreign_keys` enforcement is left enabled; `{ numRuns: 100 }`
    - _Requirements: 1.4, 3.1, 3.2, 3.3, 3.5, 3.6, 9.3_

  - [ ]* 9.6 Write property test for ascending application order
    - **Property 4: Migrations are applied in ascending id order**
    - Assert the order in which `up` functions are invoked and the order of resulting `schema_migrations` records is strictly ascending by `Migration_Id`, regardless of source order; `{ numRuns: 100 }`
    - _Requirements: 2.3, 10.1_

  - [ ]* 9.7 Write property test for the newer-than-binary fail-safe
    - **Property 12: Newer-than-binary databases are rejected without mutation**
    - For databases with a record id exceeding `Expected_Version`, assert `runMigrations` throws reporting both the database `Schema_Version` and the binary `Expected_Version`, and the schema and data are unchanged; `{ numRuns: 100 }`
    - _Requirements: 7.1, 7.4_

  - [ ]* 9.8 Write property test for referential integrity after reconstruction
    - **Property 13: Referential integrity holds after table reconstruction**
    - Assert `PRAGMA foreign_key_check` reports no violations after the `devices` reconstruction re-enables `foreign_keys`, and that a reconstruction leaving a dangling FK reference surfaces an `IntegrityError`; `{ numRuns: 100 }`
    - _Requirements: 9.5_

  - [ ]* 9.9 Write unit tests for error content, forward-only, and WAL full run
    - In `src/db/migration-runner.test.ts` / `src/db/migration-runner.integration.test.ts`: `MigrationError` includes the failing id and the cause message (R3.4); `DatabaseNewerThanBinaryError` includes both versions (R7.3); a `down` spy is never invoked in v1 (R10.2); a full migration set against a file-backed WAL database succeeds and leaves `foreign_keys = 1` (R9.4)
    - _Requirements: 3.4, 7.3, 9.4, 10.2_

- [ ] 10. Checkpoint - runner complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Integrate the runner into startup
  - [ ] 11.1 Replace ad-hoc schema calls in `src/db/database.ts` `getDatabase()` with `runMigrations`
    - Open the connection, set `journal_mode = WAL` and `foreign_keys = ON`, then call `runMigrations(db, migrations, { dbPath: config.dbPath })` so a failure propagates and no instance is returned; retain `initSchema` as the baseline body during transition and keep `closeDatabase` and existing consumers working
    - Confirm `Schema_Version === Expected_Version` before the DB is used (handled inside `runMigrations`)
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 12.1, 12.2_

  - [ ]* 11.2 Write unit tests for startup gating
    - Assert an injected `runMigrations` failure propagates so `getDatabase()` throws and returns no instance (R6.3), and that after a successful run including reconstruction `foreign_keys` is `1` (R6.5)
    - _Requirements: 6.3, 6.5_

- [ ] 12. Add observability logging across the runner
  - [ ] 12.1 Add structured log lines to `src/db/migration-runner.ts`
    - Log: start of applying pending (current + expected version), each applied `Migration_Id`, resulting `Schema_Version` on completion, failing `Migration_Id` + underlying error, legacy adoption + stamped version, database-newer-than-binary (both versions), and the already-at-expected-version case
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 12.2 Write unit test asserting all log lines with a logger spy
    - In `src/db/migration-runner.test.ts`, use a logger spy to assert the start, per-migration applied id, final version, failure (id + err), adoption (version 1), newer-than-binary (both versions), and already-at-expected log lines are emitted
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [ ] 13. Migrate existing tests and validate the full build
  - [ ] 13.1 Migrate `src/db/database.test.ts` and `src/db/database.property.test.ts` to exercise the runner
    - Update the existing scenarios (especially the `CHECK`-constraint removal case and the `initSchema` table-list case) to run through `runMigrations`/`getDatabase` instead of the removed ad-hoc logic, keeping the tests green with no orphaned references to the old `addColumn`/`migrateRemoveTypeCheck` code
    - _Requirements: 13.1, 13.4_

  - [ ] 13.2 Run the full build/typecheck and the complete vitest suite (single run) and fix failures
    - Run the project's typecheck/build and `vitest --run`; resolve any compile or test failures introduced by the migration work
    - _Requirements: 6.1, 6.2, 13.1, 13.2_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation and the final validation tasks are never optional.
- Each task references specific files/components from the design and the requirement IDs (and Property numbers where applicable) it covers.
- Property tests use `{ numRuns: 100 }` minimum and are tagged `Feature: versioned-db-migrations, Property N: <text>`, running against in-memory `better-sqlite3` databases with `skipCheckpoint: true` and an injected `now` for determinism (except checkpoint/WAL tests, which use file-backed databases).
- The runner toggles `PRAGMA foreign_keys` OUTSIDE the per-migration `db.transaction` because SQLite ignores the pragma while a transaction is open.
- Out of scope (no tasks): down/rollback migration execution (structure only via optional `down`), other database engines, the other two specs, and multi-node coordination.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "9.1"] },
    { "id": 1, "tasks": ["2.1", "4.1", "1.2"] },
    { "id": 2, "tasks": ["3.1", "5.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["8.1", "6.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["9.2", "4.2", "8.3"] },
    { "id": 5, "tasks": ["12.1", "5.2", "9.3"] },
    { "id": 6, "tasks": ["11.1", "6.3", "9.4"] },
    { "id": 7, "tasks": ["8.2", "6.2"] },
    { "id": 8, "tasks": ["11.2", "9.5"] },
    { "id": 9, "tasks": ["12.2", "9.6"] },
    { "id": 10, "tasks": ["9.9", "9.7"] },
    { "id": 11, "tasks": ["9.8"] },
    { "id": 12, "tasks": ["13.1"] },
    { "id": 13, "tasks": ["13.2"] }
  ]
}
```
