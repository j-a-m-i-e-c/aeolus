# Requirements Document

## Introduction

Aeolus persists all of its state in a single disk-backed SQLite database opened through `better-sqlite3` in `src/db/database.ts`. Today the schema is created and evolved entirely inside `initSchema()`, which runs a series of `CREATE TABLE IF NOT EXISTS` statements on every startup and applies later schema changes ad hoc:

- An `addColumn(col, def)` helper wraps `ALTER TABLE automation_rules ADD COLUMN ...` in a `try { ... } catch { /* already exists */ }` for the columns `rule_type`, `script_source`, `compiled_js`, `structured_metadata`, `ui_source`, `compiled_ui`, `trigger_type`, and `cron_expression`, followed by a data backfill `UPDATE automation_rules SET rule_type = 'form' WHERE rule_type IS NULL`.
- A bespoke reconstruction function `migrateRemoveTypeCheck()` detects the old `CHECK(type IN (...))` constraint on the `devices` table by inspecting `sqlite_master`, then renames the table, recreates it without the constraint, copies rows, and drops the old table inside a manual `BEGIN`/`COMMIT`/`ROLLBACK` with `PRAGMA foreign_keys = OFF`/`ON`.

There is **no schema version tracking**: no `schema_migrations` table and no use of `PRAGMA user_version`. Correctness depends entirely on `IF NOT EXISTS` and swallowed `ALTER TABLE` errors making every statement safe to re-run on every boot. There is no defined ordering, no upgrade testing, and no way to know what schema version a given deployed database is at.

A technical review flagged this as prototype-grade and unsafe for long-lived customer deployments. The concern is not first install; it is upgrading a device installed at a customer site many months later, where the database has accumulated real data and the schema history matters. Commercial edge software runs for years, so each deployment needs a known schema version, transactional migrations, tested upgrade paths, and safe adoption of databases that predate version tracking.

This feature introduces a versioned, ordered, transactional migration system for the Aeolus SQLite database, converts the existing ad-hoc schema changes into versioned migrations, adopts existing unversioned databases to a known baseline without data loss, integrates migration execution into `getDatabase()` startup, and makes upgrades testable.

### Scope

**In scope:** a schema version tracking mechanism; ordered, uniquely-identified migrations applied exactly once; transactional application with rollback on failure and halt-on-first-failure; a baseline migration representing the current production schema and safe adoption of pre-existing unversioned databases; conversion of the existing `addColumn` ALTER statements, the `rule_type` backfill, and the `migrateRemoveTypeCheck` reconstruction into ordered migrations; automatic execution of pending migrations at startup with a version-gate before the app serves; defined fail-safe behavior when the database version is newer than the running binary expects; a safety checkpoint/backup before migrating an existing database; correct interaction with WAL mode and `foreign_keys`; observability of which migrations ran and the version transition; and upgrade/round-trip testing that an older database migrates to the expected schema with existing data intact.

**Out of scope:** migrating to a different database engine; the verified-command-execution spec; the custom-ui-sandboxing spec; multi-node / fleet schema coordination. Down / rollback (reverse) migrations are out of scope for the first version; the design MUST NOT preclude adding them later, and this document notes the decision in Requirement 10.

## Glossary

- **Database**: The single `better-sqlite3` SQLite database opened by `getDatabase()` in `src/db/database.ts` at `config.dbPath`, running in WAL journal mode with `foreign_keys` enabled.
- **Migration_Runner**: The component responsible for determining pending migrations, applying them in order transactionally, and recording their application. It replaces the ad-hoc schema evolution logic currently inside `initSchema()`.
- **Migration**: A single, uniquely-identified, ordered unit of schema or data change. Each Migration has a Migration_Id and a defined forward operation.
- **Migration_Id**: A zero-padded sequential identifier assigned to each Migration that defines its ordering (for example `001`, `002`, `003`).
- **Schema_Version**: The Migration_Id of the highest Migration that has been successfully applied to the Database. A Database with no migrations applied has Schema_Version zero.
- **Expected_Version**: The highest Migration_Id known to the running Aeolus binary — the Schema_Version the Database is expected to reach after all pending migrations are applied.
- **Migration_Record**: A persisted record that a specific Migration was applied to the Database, stored in the Migration_History.
- **Migration_History**: The persistent store of Migration_Records (for example a `schema_migrations` table) from which Schema_Version is derived.
- **Pending_Migration**: A Migration whose Migration_Id is greater than the current Schema_Version and which has no Migration_Record — that is, a Migration that has not yet been applied.
- **Baseline_Migration**: The Migration with the lowest Migration_Id that represents the complete current production schema (all tables and indexes created by today's `initSchema()`, including the columns previously added by `addColumn` and the `devices` table without the `CHECK` constraint).
- **Legacy_Database**: An existing Database created before this feature that contains application tables but has no Migration_History and no recorded Schema_Version.
- **Fresh_Database**: A Database file that does not yet exist or contains no application tables when `getDatabase()` is first called.
- **Adoption**: The process of stamping a Legacy_Database with the appropriate Migration_Records so that its Schema_Version reflects the schema it already has, without re-running create statements destructively and without data loss.
- **Safety_Checkpoint**: A recoverable copy or snapshot of the Database file taken before Pending_Migrations are applied to a non-empty Database, from which the prior state can be restored if migration fails.
- **Startup**: The first invocation of `getDatabase()` in a process, during which the Database is opened, migrations are applied, and the version gate is evaluated.
- **Upgrade_Test**: An automated test that starts from a Database at an older Schema_Version, runs the Migration_Runner, and verifies the resulting schema and that pre-existing data is intact.

## Requirements

### Requirement 1: Schema version tracking

**User Story:** As a platform maintainer, I want the database to record which schema version it is at and which migrations have run, so that I can reason about the exact state of any deployed device.

#### Acceptance Criteria

1. THE Migration_Runner SHALL maintain a Migration_History in the Database that records, for each applied Migration, its Migration_Id and the time it was applied.
2. THE Migration_Runner SHALL derive the current Schema_Version from the highest Migration_Id present in the Migration_History.
3. WHEN the Database contains no Migration_Record, THE Migration_Runner SHALL treat the Schema_Version as zero.
4. WHEN a Migration is applied successfully, THE Migration_Runner SHALL write a Migration_Record for that Migration_Id to the Migration_History within the same transaction that applies the Migration.
5. THE Migration_Runner SHALL create the Migration_History store if it does not already exist before reading or writing Migration_Records.
6. THE Migration_Runner SHALL record each Migration_Id in the Migration_History at most once.

### Requirement 2: Ordered, uniquely-identified migrations applied exactly once

**User Story:** As a platform maintainer, I want migrations to be numbered and applied in order exactly once, so that every deployment converges on the same schema regardless of its starting version.

#### Acceptance Criteria

1. THE Migration_Runner SHALL assign each Migration a unique Migration_Id.
2. THE Migration_Runner SHALL determine the set of Pending_Migrations as those Migrations whose Migration_Id is absent from the Migration_History.
3. WHEN Pending_Migrations exist, THE Migration_Runner SHALL apply them in ascending Migration_Id order.
4. WHEN a Migration already has a Migration_Record, THE Migration_Runner SHALL skip that Migration without re-applying its operation.
5. WHERE two Migrations share the same Migration_Id, THE Migration_Runner SHALL reject the migration set with an error identifying the duplicated Migration_Id.
6. WHEN all Pending_Migrations have been applied, THE Migration_Runner SHALL leave the Database at a Schema_Version equal to the Expected_Version.

### Requirement 3: Transactional application with rollback and halt on failure

**User Story:** As a device owner, I want a failed migration to leave my database exactly as it was, so that a bad upgrade never corrupts my data or leaves the schema half-changed.

#### Acceptance Criteria

1. THE Migration_Runner SHALL apply each Migration and write its Migration_Record inside a single transaction.
2. IF applying a Migration raises an error, THEN THE Migration_Runner SHALL roll back that Migration's transaction so that neither its schema changes nor its Migration_Record are retained.
3. IF applying a Migration raises an error, THEN THE Migration_Runner SHALL halt without attempting any later Pending_Migration.
4. WHEN a Migration fails, THE Migration_Runner SHALL surface an error that identifies the failing Migration_Id and includes the underlying error message.
5. WHEN a Migration fails and is rolled back, THE Migration_Runner SHALL leave the Database at the Schema_Version it held before that Migration was attempted.
6. WHEN one Migration in a sequence has been committed and a later Migration fails, THE Migration_Runner SHALL retain the Migration_Records of the earlier successfully committed Migrations.

### Requirement 4: Baseline migration and adoption of legacy databases

**User Story:** As an owner of a device that has been running Aeolus since before version tracking existed, I want my existing database recognized and stamped at a known baseline, so that upgrading does not re-run create statements destructively or lose my data.

#### Acceptance Criteria

1. THE Migration_Runner SHALL define a Baseline_Migration whose applied result is the complete current production schema, comprising the tables `devices`, `automation_rules`, `tabs`, `panes`, `connectors`, `automation_state`, `device_history`, `groups`, `users`, `group_tab_assignments`, `refresh_tokens`, `mqtt_credentials`, and `system_settings`, together with the indexes `idx_device_history_device_ts`, `idx_refresh_tokens_user`, and `idx_refresh_tokens_hash`.
2. WHEN `getDatabase()` runs against a Fresh_Database, THE Migration_Runner SHALL apply the Baseline_Migration and all later Pending_Migrations in order.
3. WHEN `getDatabase()` runs against a Legacy_Database, THE Migration_Runner SHALL detect that application tables exist without a Migration_History.
4. WHEN a Legacy_Database is detected, THE Migration_Runner SHALL adopt it by recording the Baseline_Migration's Migration_Record without re-executing the Baseline_Migration's create statements against the existing tables.
5. WHEN a Legacy_Database is adopted, THE Migration_Runner SHALL preserve all existing rows in every existing table.
6. IF a Legacy_Database's existing schema cannot be reconciled to the Baseline_Migration schema, THEN THE Migration_Runner SHALL halt with an error describing the mismatch rather than modifying data.
7. WHEN a Legacy_Database has been adopted at the baseline, THE Migration_Runner SHALL apply any Pending_Migrations with a Migration_Id greater than the Baseline_Migration in ascending order.

### Requirement 5: Conversion of existing ad-hoc schema changes into versioned migrations

**User Story:** As a platform maintainer, I want the current `addColumn` ALTERs, the `rule_type` backfill, and the `migrateRemoveTypeCheck` reconstruction expressed as ordered migrations, so that the schema history is explicit and every deployment applies the same changes in the same order.

#### Acceptance Criteria

1. THE Migration_Runner SHALL represent the addition of the `automation_rules` columns `rule_type`, `script_source`, `compiled_js`, `structured_metadata`, `ui_source`, `compiled_ui`, `trigger_type`, and `cron_expression` as one or more ordered Migrations.
2. THE Migration_Runner SHALL represent the backfill that sets `automation_rules.rule_type` to `'form'` for rows where `rule_type` is null as an ordered Migration or as part of the Migration that introduces the `rule_type` column.
3. THE Migration_Runner SHALL represent the removal of the `CHECK(type IN (...))` constraint on the `devices` table — via table rename, recreation without the constraint, row copy, and drop of the old table — as an ordered Migration.
4. WHERE a Database already contains a column that a Migration would add, THE Migration_Runner SHALL leave that column and its data unchanged rather than failing on a duplicate-column error.
5. WHERE a Database's `devices` table already lacks the `CHECK` constraint, THE Migration_Runner SHALL leave the `devices` table and its rows unchanged.
6. WHEN the `devices` table reconstruction Migration runs, THE Migration_Runner SHALL preserve every existing `devices` row's `id`, `name`, `type`, `capabilities`, `state`, `integration`, and `last_seen` values.
7. THE Migration_Runner SHALL order the converted Migrations such that applying them from Schema_Version zero produces the same final schema as today's `initSchema()`.

### Requirement 6: Startup integration and version gating

**User Story:** As a device owner, I want the application to run pending migrations automatically at startup and only serve when the database is at the version the software expects, so that the running code and the schema always agree.

#### Acceptance Criteria

1. WHEN `getDatabase()` is invoked and the Database is opened, THE Migration_Runner SHALL apply all Pending_Migrations before `getDatabase()` returns the Database instance.
2. WHEN all Pending_Migrations have been applied successfully, THE Migration_Runner SHALL confirm the Schema_Version equals the Expected_Version before the Database is used by the application.
3. IF applying Pending_Migrations fails at Startup, THEN `getDatabase()` SHALL raise an error and SHALL NOT return a Database instance for application use.
4. WHILE the Schema_Version is less than the Expected_Version and no Pending_Migration can advance it, THE Migration_Runner SHALL treat the condition as a startup failure and raise an error.
5. THE Migration_Runner SHALL apply Pending_Migrations before enabling `foreign_keys` enforcement for normal application use where a Migration requires foreign-key enforcement to be suspended, and SHALL restore `foreign_keys` enforcement afterward.

### Requirement 7: Fail-safe on a database newer than the binary

**User Story:** As an operator who may accidentally run an older build against a newer database (for example after a downgrade), I want Aeolus to refuse to start rather than operate on a schema it does not understand, so that a downgrade cannot silently corrupt data.

#### Acceptance Criteria

1. WHEN `getDatabase()` detects a Migration_Record whose Migration_Id is greater than the Expected_Version, THE Migration_Runner SHALL treat the Database as newer than the running binary.
2. IF the Database is newer than the running binary, THEN THE Migration_Runner SHALL raise an error and SHALL NOT return a Database instance for application use.
3. WHEN the Database is newer than the running binary, THE Migration_Runner SHALL report the Database's Schema_Version and the binary's Expected_Version in the error.
4. WHEN the Database is newer than the running binary, THE Migration_Runner SHALL NOT modify the Database schema or data.

### Requirement 8: Safety checkpoint before migrating an existing database

**User Story:** As a device owner, I want a recoverable copy of my database made before migrations change it, so that I can be restored to my prior state if an upgrade goes wrong.

#### Acceptance Criteria

1. WHEN Pending_Migrations exist and the Database already contains application data, THE Migration_Runner SHALL create a Safety_Checkpoint of the Database before applying any Pending_Migration.
2. WHERE the Database is a Fresh_Database with no application data, THE Migration_Runner SHALL apply Pending_Migrations without requiring a Safety_Checkpoint.
3. IF creating the Safety_Checkpoint fails, THEN THE Migration_Runner SHALL halt before applying any Pending_Migration and SHALL surface an error describing the checkpoint failure.
4. THE Migration_Runner SHALL create the Safety_Checkpoint in a manner consistent with WAL journal mode so that the checkpoint reflects a complete and consistent Database state.
5. WHEN all Pending_Migrations complete successfully, THE Migration_Runner SHALL retain the Safety_Checkpoint until the successful completion is confirmed.

### Requirement 9: WAL and foreign-key handling during migrations

**User Story:** As a platform maintainer, I want migrations to interact correctly with WAL mode and foreign-key enforcement, so that reconstruction migrations like the devices-table rebuild remain safe.

#### Acceptance Criteria

1. WHERE a Migration recreates a table referenced by foreign keys, THE Migration_Runner SHALL suspend `foreign_keys` enforcement for the duration of that Migration and SHALL restore it after the Migration completes.
2. WHEN a Migration that suspended `foreign_keys` enforcement completes, THE Migration_Runner SHALL leave `foreign_keys` enforcement enabled for subsequent application use.
3. WHEN a Migration that suspended `foreign_keys` enforcement is rolled back, THE Migration_Runner SHALL restore `foreign_keys` enforcement to enabled.
4. THE Migration_Runner SHALL operate correctly while the Database is in WAL journal mode.
5. WHERE a reconstruction Migration removes a `CHECK` or other table constraint, THE Migration_Runner SHALL verify referential integrity after restoring `foreign_keys` enforcement and SHALL surface an error if a foreign-key violation is detected.

### Requirement 10: Forward-only migration direction

**User Story:** As a platform maintainer planning the first version, I want migrations to be forward-only for now while keeping the door open for reverse migrations later, so that the initial system stays simple and safe without blocking future rollback support.

#### Acceptance Criteria

1. THE Migration_Runner SHALL apply Migrations only in the forward (ascending Migration_Id) direction.
2. WHERE no reverse operation is defined for a Migration, THE Migration_Runner SHALL NOT attempt to reverse an applied Migration.
3. THE Migration_Runner SHALL rely on the Safety_Checkpoint and transactional rollback, rather than reverse Migrations, as the recovery mechanism for a failed upgrade.
4. THE Migration structure SHALL allow a future reverse operation to be associated with a Migration without changing the Migration_Id or ordering of existing Migrations.

### Requirement 11: Observability of migration execution

**User Story:** As an operator diagnosing an upgrade, I want logs that show which migrations ran and how the version changed, so that I can confirm what happened during startup.

#### Acceptance Criteria

1. WHEN the Migration_Runner begins applying Pending_Migrations, THE Migration_Runner SHALL log the current Schema_Version and the Expected_Version.
2. WHEN a Migration is applied successfully, THE Migration_Runner SHALL log the applied Migration_Id.
3. WHEN all Pending_Migrations have been applied, THE Migration_Runner SHALL log the resulting Schema_Version.
4. WHEN a Migration fails, THE Migration_Runner SHALL log the failing Migration_Id and the underlying error.
5. WHEN a Legacy_Database is adopted at the baseline, THE Migration_Runner SHALL log that adoption and the Schema_Version at which it was stamped.
6. WHEN the Database is newer than the running binary, THE Migration_Runner SHALL log the Database Schema_Version and the binary Expected_Version.
7. WHEN no Pending_Migrations exist at Startup, THE Migration_Runner SHALL log that the Database is already at the Expected_Version.

### Requirement 12: Single-writer concurrency assumptions

**User Story:** As a platform maintainer, I want the migration system to state and rely on the single-process, synchronous nature of `better-sqlite3`, so that migrations do not need distributed coordination they cannot provide.

#### Acceptance Criteria

1. THE Migration_Runner SHALL assume a single Aeolus process opens the Database and applies migrations, consistent with the synchronous single-connection `better-sqlite3` usage in `src/db/database.ts`.
2. THE Migration_Runner SHALL complete all Pending_Migrations during a single synchronous Startup sequence before the Database is used for application requests.
3. THE Migration_Runner SHALL NOT require coordination across multiple processes or nodes to determine or apply the Schema_Version.

### Requirement 13: Testable upgrade and data-integrity verification

**User Story:** As a platform maintainer, I want automated tests that upgrade an older database and confirm the schema and data are correct, so that I can trust every release's upgrade path before it ships to customers.

#### Acceptance Criteria

1. THE Migration_Runner SHALL support running migrations against a Database provided by a test, including an in-memory Database, so that upgrades can be exercised without a real device, consistent with the existing `initSchema`-based tests in `src/db/database.test.ts`.
2. WHEN an Upgrade_Test starts from a Database at a Schema_Version lower than the Expected_Version and runs the Migration_Runner, THE Migration_Runner SHALL bring the Database to the Expected_Version.
3. WHEN an Upgrade_Test seeds rows into a Legacy_Database and then runs the Migration_Runner, THE Migration_Runner SHALL preserve those rows so that a read after migration returns the same data that was written before migration.
4. WHEN an Upgrade_Test seeds a `devices` row with the old `CHECK(type IN (...))` constraint present and runs the Migration_Runner, THE Migration_Runner SHALL preserve that row and remove the `CHECK` constraint, consistent with the existing `migrateRemoveTypeCheck` test scenario.
5. WHEN an Upgrade_Test runs the Migration_Runner twice against the same Database, THE Migration_Runner SHALL make no further schema or data changes on the second run and SHALL leave the Schema_Version unchanged (idempotence).
6. WHEN an Upgrade_Test compares a Fresh_Database migrated to the Expected_Version against a Legacy_Database adopted and migrated to the Expected_Version, THE resulting schema SHALL be equivalent (convergence).
