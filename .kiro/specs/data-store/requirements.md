# Requirements Document

## Introduction

Aeolus currently stores device state transiently (overwritten on each update) and keeps limited state history (last N snapshots per device, auto-pruned). The automation state store provides per-rule key-value persistence, but there is no general-purpose data storage accessible across automations, connectors, and services. This spec introduces a **Data Store** — a persistent time-series and key-value storage system built on SQLite that enables automations to accumulate structured data over time (energy totals, irrigation logs, chemistry readings), share computed values across rules, and query historical records with aggregation. The Data Store is exposed as a `db` sandbox global for automation scripts, a backend service with a REST API, and a dedicated "Data Store" pinned tab in the sidebar with a Data Explorer UI for browsing collections, viewing time-series charts, and managing retention policies.

## Glossary

- **Data_Store**: The core backend module that manages persistent time-series collections and key-value buckets in SQLite, providing write, query, and lifecycle operations.
- **Collection**: A named container for time-series records. Each collection stores timestamped JSON records that accumulate over time. Examples: "energy-daily", "irrigation-cycles", "pool-chemistry".
- **Bucket**: A named key-value namespace for persistent storage of computed values, configuration, and cross-automation shared state. Each bucket contains string keys mapped to JSON values.
- **Record**: A single timestamped entry in a time-series collection, containing a JSON payload and optional tags for filtering.
- **Tag**: A string key-value pair attached to a record, enabling filtered queries within a collection (e.g. `zone: "front-garden"`, `source: "solar"`).
- **Retention_Policy**: A per-collection configuration that determines how long records are kept. Options: a specific duration (e.g. 30 days, 1 year) or forever (no pruning).
- **Aggregation**: A query operation that computes a summary value (sum, avg, min, max, count) over a set of records within a time range.
- **Sandbox_DB_API**: The `db` global object exposed in the automation sandbox, providing `write()`, `query()`, `get()`, `set()`, and `delete()` methods for accessing the Data Store from automation scripts.
- **Data_Explorer**: The frontend dashboard UI for the Data Store, providing collection browsing, time-series chart visualization, record inspection, and CSV export.
- **Collection_Metadata**: The stored configuration for a collection including its name, creation timestamp, retention policy, and description.
- **Query_Options**: An object specifying time range (`from`, `to`), aggregation function, tag filters, limit, and offset for querying time-series records.

## Requirements

### Requirement 1: Data Store Core Schema

**User Story:** As a platform maintainer, I want the Data Store to persist collections, records, and buckets in SQLite tables with proper indexing, so that data survives restarts and queries perform well on a Raspberry Pi.

#### Acceptance Criteria

1. THE Data_Store SHALL create a `ds_collections` table with columns: name (TEXT PRIMARY KEY), description (TEXT), retention_days (INTEGER, NULL means keep forever), created_at (INTEGER), updated_at (INTEGER).
2. THE Data_Store SHALL create a `ds_records` table with columns: id (INTEGER PRIMARY KEY AUTOINCREMENT), collection (TEXT NOT NULL REFERENCES ds_collections(name) ON DELETE CASCADE), payload (TEXT NOT NULL as JSON), tags (TEXT DEFAULT '{}' as JSON), timestamp (INTEGER NOT NULL).
3. THE Data_Store SHALL create a `ds_buckets` table with columns: bucket (TEXT NOT NULL), key (TEXT NOT NULL), value (TEXT NOT NULL as JSON), updated_at (INTEGER NOT NULL), PRIMARY KEY (bucket, key).
4. THE Data_Store SHALL create an index on `ds_records(collection, timestamp DESC)` for efficient time-range queries.
5. THE Data_Store SHALL create an index on `ds_records(collection, tags)` for efficient tag-filtered queries.
6. WHEN the Aeolus backend starts, THE Data_Store SHALL initialize the schema tables and indexes if they do not already exist.

### Requirement 2: Time-Series Write Operations

**User Story:** As an automation script author, I want to write timestamped records to named collections, so that I can accumulate structured data over time without it being pruned by the state history system.

#### Acceptance Criteria

1. WHEN a write operation is performed with a collection name and payload, THE Data_Store SHALL insert a new record with the current timestamp into the specified collection.
2. WHEN a write operation specifies a collection that does not exist, THE Data_Store SHALL auto-create the collection with default retention (keep forever) before inserting the record.
3. WHEN a write operation includes optional tags, THE Data_Store SHALL store the tags as a JSON object alongside the record payload.
4. WHEN a write operation includes an optional explicit timestamp, THE Data_Store SHALL use the provided timestamp instead of the current time.
5. THE Data_Store SHALL persist the database to disk after each write operation to ensure durability.
6. IF a write operation provides an invalid payload (not JSON-serializable), THEN THE Data_Store SHALL throw a descriptive error without corrupting existing data.

### Requirement 3: Time-Series Query Operations

**User Story:** As an automation script author, I want to query records from collections by time range with optional aggregation and tag filtering, so that I can compute summaries and retrieve historical data for decision-making.

#### Acceptance Criteria

1. WHEN a query specifies a `from` parameter as a relative duration string (e.g. "7d", "24h", "30m"), THE Data_Store SHALL interpret the duration and return records from that many units ago until now.
2. WHEN a query specifies `from` and `to` as absolute timestamps, THE Data_Store SHALL return records within that inclusive range.
3. WHEN a query specifies an aggregation function (sum, avg, min, max, count), THE Data_Store SHALL compute the aggregation over a specified numeric field in the payload across all matching records.
4. WHEN a query specifies tag filters, THE Data_Store SHALL return only records whose tags contain all specified key-value pairs.
5. WHEN a query specifies a `limit` parameter, THE Data_Store SHALL return at most that many records, ordered by timestamp descending.
6. WHEN a query specifies an `offset` parameter, THE Data_Store SHALL skip that many records before returning results, enabling pagination.
7. IF a query references a collection that does not exist, THEN THE Data_Store SHALL return an empty result set rather than throwing an error.
8. THE Data_Store SHALL return query results ordered by timestamp descending (newest first) by default.

### Requirement 4: Key-Value Bucket Operations

**User Story:** As an automation script author, I want persistent key-value storage that is shared across automations, so that I can store computed values, configuration, and cross-automation state that survives restarts.

#### Acceptance Criteria

1. WHEN a set operation is performed with a bucket name, key, and value, THE Data_Store SHALL upsert the entry in the `ds_buckets` table with the current timestamp.
2. WHEN a get operation is performed with a bucket name and key, THE Data_Store SHALL return the stored JSON value, or undefined if the key does not exist.
3. WHEN a delete operation is performed with a bucket name and key, THE Data_Store SHALL remove the entry from the `ds_buckets` table.
4. WHEN a list operation is performed with a bucket name, THE Data_Store SHALL return all key-value pairs in the specified bucket.
5. WHEN a set operation specifies a bucket that does not exist, THE Data_Store SHALL create the bucket implicitly by inserting the first entry.
6. THE Data_Store SHALL persist the database to disk after each set or delete operation.

### Requirement 5: Retention Policy Enforcement

**User Story:** As a user, I want to configure per-collection retention policies so that old data is automatically pruned, keeping storage manageable on the Raspberry Pi's SD card.

#### Acceptance Criteria

1. WHEN a collection has a retention policy configured (retention_days is not NULL), THE Data_Store SHALL delete records older than the specified number of days.
2. THE Data_Store SHALL run retention enforcement on a periodic schedule (once per hour) to prune expired records from all collections with retention policies.
3. WHEN a collection's retention policy is updated, THE Data_Store SHALL apply the new policy on the next enforcement cycle.
4. WHEN a collection's retention policy is set to NULL, THE Data_Store SHALL keep all records in that collection indefinitely.
5. THE Data_Store SHALL log the number of records pruned per collection during each enforcement cycle.
6. WHEN a retention enforcement cycle runs, THE Data_Store SHALL persist the database to disk after pruning.

### Requirement 6: Sandbox DB API

**User Story:** As an automation script author, I want a `db` global in the sandbox so that I can write time-series data, query historical records, and access key-value storage directly from automation scripts.

#### Acceptance Criteria

1. THE Sandbox SHALL expose a `db` global object alongside the existing `devices`, `mqtt`, `log`, `context`, `state`, `services`, `http`, and `automation` globals.
2. THE `db.write(collection, payload, options?)` method SHALL insert a timestamped record into the specified collection, where options may include `tags` and `timestamp`.
3. THE `db.query(collection, options?)` method SHALL return an array of records matching the query criteria, where options may include `from`, `to`, `limit`, `offset`, `tags`, `aggregate`, and `field`.
4. WHEN `db.query()` is called with an `aggregate` option, THE method SHALL return a single numeric result instead of an array of records.
5. THE `db.get(bucket, key)` method SHALL return the stored value from the specified key-value bucket, or undefined if not found.
6. THE `db.set(bucket, key, value)` method SHALL persist the value in the specified key-value bucket.
7. THE `db.delete(bucket, key)` method SHALL remove the key from the specified key-value bucket.
8. THE `db.collections()` method SHALL return an array of collection metadata objects listing all existing collections.
9. THE sandbox type definitions file (`sandbox-types.d.ts`) SHALL be updated with type declarations for the `db` global, including all methods and their parameter types.
10. IF a `db.write()` or `db.set()` call fails due to invalid data, THEN THE Sandbox SHALL log the error via the sandbox log system and continue execution without crashing the script.

### Requirement 7: Data Store REST API

**User Story:** As a frontend developer, I want REST endpoints for managing collections, querying records, and accessing key-value buckets, so that I can build the Data Explorer UI.

#### Acceptance Criteria

1. THE REST API SHALL expose `GET /api/data-store/collections` returning all collections with their metadata (name, description, retention_days, record count, created_at).
2. THE REST API SHALL expose `POST /api/data-store/collections` accepting a name, optional description, and optional retention_days to create a new collection.
3. THE REST API SHALL expose `PATCH /api/data-store/collections/:name` accepting optional description and retention_days to update collection metadata.
4. THE REST API SHALL expose `DELETE /api/data-store/collections/:name` to delete a collection and all its records.
5. THE REST API SHALL expose `POST /api/data-store/collections/:name/records` accepting a payload and optional tags to write a record.
6. THE REST API SHALL expose `GET /api/data-store/collections/:name/records` accepting query parameters (from, to, limit, offset, tags, aggregate, field) to query records.
7. THE REST API SHALL expose `GET /api/data-store/buckets` returning all bucket names with their key count.
8. THE REST API SHALL expose `GET /api/data-store/buckets/:bucket` returning all key-value pairs in a bucket.
9. THE REST API SHALL expose `PUT /api/data-store/buckets/:bucket/:key` accepting a JSON value to set a key.
10. THE REST API SHALL expose `DELETE /api/data-store/buckets/:bucket/:key` to delete a key from a bucket.
11. THE REST API SHALL expose `GET /api/data-store/collections/:name/export` returning all records in the collection as a CSV file with appropriate Content-Type and Content-Disposition headers.
12. IF a request references a collection that does not exist for write or update operations, THEN THE REST API SHALL return a 404 response with a descriptive error message.
13. IF a request provides invalid query parameters (non-numeric limit, invalid duration format), THEN THE REST API SHALL return a 400 response with validation error details.

### Requirement 8: Data Explorer Dashboard UI

**User Story:** As a user, I want a dedicated Data Store tab in the sidebar with a beautiful Data Explorer interface, so that I can browse collections, view time-series charts, inspect records, and manage my stored data visually.

#### Acceptance Criteria

1. THE Dashboard SHALL include a "Data Store" pinned tab in the sidebar navigation, positioned after the Connectors tab, with a database icon.
2. WHEN the Data Store tab is opened, THE Data_Explorer SHALL display a list of all collections with their name, description, record count, retention policy, and last write timestamp.
3. WHEN a user selects a collection, THE Data_Explorer SHALL display a time-series line chart of the most recent records, with automatic field detection for numeric values.
4. THE time-series chart SHALL support a time range picker with presets (1h, 6h, 24h, 7d, 30d, custom range) for adjusting the displayed data window.
5. THE time-series chart SHALL support multi-series display when records contain multiple numeric fields, with a legend and toggleable series visibility.
6. WHEN a user selects a collection, THE Data_Explorer SHALL display a paginated table of raw records below the chart, showing timestamp, payload fields, and tags.
7. THE Data_Explorer SHALL provide a "New Collection" button that opens a form for creating a collection with name, description, and retention policy.
8. THE Data_Explorer SHALL provide collection management controls: edit retention policy, edit description, delete collection (with confirmation dialog).
9. THE Data_Explorer SHALL provide an "Export CSV" button per collection that downloads all records as a CSV file.
10. THE Data_Explorer SHALL include a "Buckets" section accessible via a tab or toggle, displaying all key-value buckets with their keys and values in an expandable list.
11. THE Data_Explorer SHALL follow the Aeolus design system defined in BRANDING.md, using Tailwind theme tokens (background, surface, primary, accent), Lucide icons, the standard card layout with 12-16px border radius, and the signature gradient sparingly for chart accents.
12. THE time-series chart SHALL use smooth line interpolation (Catmull-Rom spline or similar) consistent with the existing State History chart implementation.

### Requirement 9: Real-Time Updates

**User Story:** As a user viewing the Data Explorer, I want the UI to update in real-time when new records are written, so that I can monitor live data without manually refreshing.

#### Acceptance Criteria

1. WHEN a new record is written to a collection, THE Data_Store SHALL emit a `DATA_STORE_WRITE` event on the internal event bus with the collection name, record payload, and timestamp.
2. THE WebSocket server SHALL broadcast `DATA_STORE_WRITE` events to connected frontend clients as a `data-store-write` message type.
3. WHEN the Data_Explorer is viewing a collection and a `data-store-write` WebSocket message arrives for that collection, THE chart and record table SHALL update to include the new data point without a full page refresh.
4. WHEN a collection is deleted via the API, THE Data_Store SHALL emit a `DATA_STORE_COLLECTION_DELETED` event so the frontend can update the collection list.

### Requirement 10: Application Wiring and Startup Integration

**User Story:** As a platform maintainer, I want the Data Store to be wired into the Aeolus startup sequence and sandbox, so that it is available immediately on boot and accessible from automations.

#### Acceptance Criteria

1. WHEN the Aeolus backend starts, THE entry point (`index.ts`) SHALL instantiate the Data_Store after the database is initialized and before the automation engine loads rules.
2. THE Sandbox constructor SHALL accept the Data_Store as an optional dependency and wire the `db` global when available.
3. THE Data Store REST routes SHALL be mounted at `/api/data-store` on the Express app alongside existing route mounts.
4. THE Data_Store retention enforcement timer SHALL start after the Data_Store is initialized and stop during graceful shutdown.
5. THE graceful shutdown handler SHALL stop the retention enforcement timer and persist the database before exiting.
6. THE WebSocket event mapping SHALL include the `DATA_STORE_WRITE` and `DATA_STORE_COLLECTION_DELETED` events for real-time frontend updates.

### Requirement 11: Collection Statistics and Monitoring

**User Story:** As a user, I want to see storage statistics for my collections, so that I can understand how much data is stored and manage disk usage on the Raspberry Pi.

#### Acceptance Criteria

1. THE REST API SHALL expose `GET /api/data-store/stats` returning aggregate statistics: total record count across all collections, total bucket entry count, and estimated storage size.
2. WHEN the Data_Explorer loads, THE UI SHALL display a summary bar showing total collections, total records, total buckets, and estimated storage usage.
3. THE per-collection metadata returned by `GET /api/data-store/collections` SHALL include a `record_count` field with the current number of records in that collection.
4. THE per-collection metadata SHALL include a `oldest_record` timestamp and `newest_record` timestamp for quick reference.

### Requirement 12: Sandbox DB API — Pretty Printer and Round-Trip

**User Story:** As a developer, I want the query options to be serializable and parseable consistently, so that the sandbox API handles duration strings and query parameters reliably.

#### Acceptance Criteria

1. WHEN a relative duration string is provided (e.g. "7d", "24h", "30m", "1y"), THE Data_Store duration parser SHALL convert it to a millisecond offset from the current time.
2. THE duration parser SHALL support the following unit suffixes: "m" (minutes), "h" (hours), "d" (days), "w" (weeks), "y" (years).
3. THE duration parser SHALL format a millisecond duration back into the shortest valid duration string representation (round-trip property: parse then format then parse produces an equivalent millisecond value).
4. IF a duration string contains an invalid format (no numeric prefix, unknown unit suffix), THEN THE duration parser SHALL throw a descriptive error identifying the invalid input.
5. THE duration parser SHALL handle integer values only — decimal durations (e.g. "1.5h") SHALL be rejected with a descriptive error.

### Requirement 13: Data Store Configuration and Safeguards

**User Story:** As a user running Aeolus on a Raspberry Pi with limited storage, I want configurable limits and automatic safeguards on the Data Store, so that it cannot fill up my SD card and crash the system.

#### Acceptance Criteria

1. THE Data_Store SHALL have a configurable `maxStorageMb` setting that defines the maximum total storage (in megabytes) the Data Store is allowed to consume. Default: 500 MB.
2. THE Data_Store SHALL have a configurable `maxRecordsPerCollection` setting that defines the maximum number of records any single collection can hold. Default: 100,000.
3. THE Data_Store SHALL have a configurable `maxCollections` setting that defines the maximum number of collections that can be created. Default: 50.
4. WHEN a write operation would cause the total Data Store storage to exceed `maxStorageMb`, THE Data_Store SHALL reject the write with a descriptive error and log a warning.
5. WHEN a write operation would cause a collection to exceed `maxRecordsPerCollection`, THE Data_Store SHALL delete the oldest records in that collection to make room (FIFO eviction) and log the eviction count.
6. WHEN a collection creation would exceed `maxCollections`, THE Data_Store SHALL reject the creation with a descriptive error.
7. THE Data_Store SHALL expose a `GET /api/data-store/config` endpoint returning the current configuration (maxStorageMb, maxRecordsPerCollection, maxCollections, enabled status).
8. THE Data_Store SHALL expose a `PUT /api/data-store/config` endpoint accepting updated configuration values, persisting them to the database.
9. THE Data_Store SHALL check storage usage against limits on every write operation and during the hourly retention enforcement cycle.
10. THE Data_Store configuration SHALL be stored in a `ds_config` table in SQLite with key-value pairs, loaded into memory on startup.

### Requirement 14: Data Store Enable/Disable and Setup Wizard

**User Story:** As a new user, I want the Data Store to be disabled by default and guide me through a setup wizard when I first enable it, so that I understand the storage implications and can set sensible limits for my hardware.

#### Acceptance Criteria

1. THE Data_Store SHALL be disabled by default on a fresh Aeolus installation (no `ds_config` table entry for `enabled` or `enabled = false`).
2. WHEN the Data Store is disabled, THE `db` sandbox global SHALL NOT be available in automation scripts (undefined), and write operations via the REST API SHALL return a 503 response with a message indicating the Data Store is not enabled.
3. WHEN the user navigates to the Data Store tab while it is disabled, THE UI SHALL display a setup wizard instead of the Data Explorer.
4. THE setup wizard SHALL display the system's available disk space, total RAM, and current Aeolus database size as context for the user.
5. THE setup wizard SHALL recommend sensible default limits based on the detected system specs:
   - If available disk < 8 GB: recommend maxStorageMb = 200, maxRecordsPerCollection = 50,000
   - If available disk 8-32 GB: recommend maxStorageMb = 500, maxRecordsPerCollection = 100,000
   - If available disk > 32 GB: recommend maxStorageMb = 2000, maxRecordsPerCollection = 500,000
6. THE setup wizard SHALL present the recommended defaults to the user in an editable form, allowing them to adjust maxStorageMb, maxRecordsPerCollection, and maxCollections before confirming.
7. WHEN the user confirms the setup wizard, THE Data_Store SHALL be enabled by persisting `enabled = true` and the configured limits to the `ds_config` table.
8. AFTER the Data Store is enabled, THE `db` sandbox global SHALL become available in automation scripts immediately without requiring a restart.
9. THE Data Store tab in the sidebar SHALL show a subtle indicator (e.g. a small dot or badge) when the Data Store is disabled, hinting that setup is needed.
10. THE setup wizard SHALL include a brief explanation of what the Data Store does, what kinds of data it stores, and how retention policies help manage storage.
11. THE Data_Store SHALL expose a `POST /api/data-store/enable` endpoint that the setup wizard calls to enable the store with the user's chosen configuration.
12. THE Data_Store SHALL expose a `POST /api/data-store/disable` endpoint that disables the store (stops accepting writes, hides the `db` global from the sandbox, but preserves existing data).

### Requirement 15: Storage Visibility and Health Monitoring

**User Story:** As a user, I want clear visibility into how much storage the Data Store is consuming relative to its limits, so that I can proactively manage data before hitting capacity.

#### Acceptance Criteria

1. THE Data_Explorer summary bar SHALL display current storage usage as a percentage of the configured `maxStorageMb` limit, with a visual progress bar.
2. WHEN storage usage exceeds 80% of `maxStorageMb`, THE summary bar SHALL display an amber warning indicator.
3. WHEN storage usage exceeds 95% of `maxStorageMb`, THE summary bar SHALL display a red critical indicator.
4. THE per-collection list SHALL display each collection's estimated storage size alongside its record count.
5. THE Data_Explorer SHALL include a "Settings" section (accessible via a gear icon) where the user can view and adjust the Data Store configuration (maxStorageMb, maxRecordsPerCollection, maxCollections) without going through the full setup wizard again.
6. WHEN the user adjusts configuration in the Settings section, THE UI SHALL show a confirmation dialog explaining the impact of the change before applying it.
7. THE System Page health summary SHALL include a "Data Store" indicator showing enabled/disabled status and current storage usage percentage when enabled.
