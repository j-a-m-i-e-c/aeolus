# Implementation Plan: Data Store

## Overview

Implement a persistent time-series and key-value storage system built on sql.js SQLite. The implementation proceeds bottom-up: pure utility module (duration parser), core DataStore class, REST API, sandbox integration, event bus wiring, frontend Zustand store and UI components, sidebar integration, and finally application startup wiring.

## Tasks

- [x] 1. Implement the duration parser module
  - [x] 1.1 Create `src/data-store/duration.ts` with `parseDuration` and `formatDuration` pure functions
    - Define the `UNITS` map: m (60_000), h (3_600_000), d (86_400_000), w (604_800_000), y (31_536_000_000)
    - `parseDuration(input: string): number` — validate format (positive integer + supported unit suffix), throw descriptive error on invalid input (empty, decimal, unknown suffix, negative)
    - `formatDuration(ms: number): string` — convert milliseconds to shortest valid duration string using largest fitting unit
    - Export both functions and the UNITS constant
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 1.2 Write property tests for duration parser — Property 10: Round-trip consistency
    - Create `src/data-store/__tests__/duration.test.ts`
    - Generate arbitrary valid duration strings (positive integer + unit from {m, h, d, w, y})
    - Assert: `parseDuration(formatDuration(parseDuration(s))) === parseDuration(s)` for all valid inputs
    - Use fast-check with minimum 100 iterations
    - **Property 10: Duration parser round-trip**
    - **Validates: Requirements 12.1, 12.3**

  - [ ]* 1.3 Write property tests for duration parser — Property 11: Invalid duration rejection
    - In the same test file, add property test for invalid inputs
    - Generate arbitrary strings that do NOT match the pattern (positive integer + supported unit)
    - Assert: `parseDuration(invalidInput)` throws a descriptive error
    - Include edge cases: empty strings, decimals ("1.5h"), unknown suffixes ("7x"), negative numbers ("-3d")
    - **Property 11: Invalid duration rejection**
    - **Validates: Requirements 12.4, 12.5**

- [x] 2. Implement the DataStore core class
  - [x] 2.1 Create `src/data-store/data-store.ts` with schema initialization and config management
    - Define interfaces: `DataStoreConfig`, `WriteOptions`, `QueryOptions`, `QueryResult`, `DataRecord`, `CollectionMetadata`, `DataStoreStats`
    - Implement constructor that accepts `Database`, `EventEmitter`, and optional `Partial<DataStoreConfig>`
    - Create DDL for `ds_config`, `ds_collections`, `ds_records`, `ds_buckets` tables and indexes
    - Implement `isEnabled()`, `enable()`, `disable()`, `getConfig()`, `updateConfig()` methods
    - Load config from `ds_config` table on construction
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 13.1, 13.2, 13.3, 13.10, 14.1_

  - [x] 2.2 Implement time-series write operations with FIFO eviction and safeguards
    - Implement `write(collection, payload, options?)` method
    - Auto-create collection if it doesn't exist (default retentionDays = null)
    - Store payload as JSON TEXT, tags as JSON TEXT, timestamp as epoch ms
    - Check storage limit (`maxStorageMb`) before write — reject if exceeded
    - Check collection record count against `maxRecordsPerCollection` — FIFO evict oldest if exceeded
    - Emit `DATA_STORE_WRITE` event on eventBus after successful write
    - Persist database to disk after write
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 13.4, 13.5, 13.9_

  - [x] 2.3 Implement time-series query operations with aggregation and filtering
    - Implement `query(collection, options?)` method
    - Support `from` as duration string (via `parseDuration`) or epoch ms
    - Support `to` as epoch ms (default: now)
    - Support `limit` and `offset` for pagination
    - Support `tags` filter — match records whose tags contain all specified key-value pairs
    - Support `aggregate` (sum, avg, min, max, count) with required `field` parameter
    - Return empty result for non-existent collections (no error)
    - Order results by timestamp DESC by default
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 2.4 Implement key-value bucket operations
    - Implement `get(bucket, key)`, `set(bucket, key, value)`, `delete(bucket, key)` methods
    - Implement `listBucket(bucket)` and `listBuckets()` methods
    - Use UPSERT (INSERT OR REPLACE) for set operations
    - Persist database to disk after set/delete
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 2.5 Implement collection management and retention enforcement
    - Implement `createCollection()`, `updateCollection()`, `deleteCollection()`, `listCollections()` methods
    - Check `maxCollections` limit on creation — reject if exceeded
    - Emit `DATA_STORE_COLLECTION_DELETED` event on delete
    - Implement `enforceRetention()` — delete records older than retentionDays for each collection
    - Log pruned record counts per collection
    - Implement `startRetentionTimer()` (hourly interval), `stopRetentionTimer()`, `dispose()`
    - Implement `getStats()` returning total records, bucket entries, collections, estimated storage
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 11.1, 11.3, 11.4, 13.6_

  - [ ]* 2.6 Write property tests for DataStore — Property 1: Write round-trip preserves data
    - Create `src/data-store/__tests__/data-store.test.ts`
    - Use in-memory sql.js Database for each test
    - Generate arbitrary collection names, JSON payloads, tag objects, and timestamps
    - Assert: write then query returns record with identical payload, tags, and timestamp
    - **Property 1: Write round-trip preserves data**
    - **Validates: Requirements 2.1, 2.3, 2.4**

  - [ ]* 2.7 Write property tests for DataStore — Property 2: Auto-create collection on write
    - Generate arbitrary valid collection names that don't pre-exist
    - Assert: writing to non-existent collection creates it with retentionDays = null and stores the record
    - **Property 2: Auto-create collection on write**
    - **Validates: Requirements 2.2**

  - [ ]* 2.8 Write property tests for DataStore — Property 3: Time-range filtering correctness
    - Generate sets of records with various timestamps and arbitrary time ranges
    - Assert: query returns exactly records within [from, to] inclusive, no others
    - **Property 3: Time-range filtering correctness**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 2.9 Write property tests for DataStore — Property 4: Aggregation correctness
    - Generate records with numeric fields and test each aggregation function
    - Assert: DataStore aggregation equals independently computed result
    - **Property 4: Aggregation correctness**
    - **Validates: Requirements 3.3**

  - [ ]* 2.10 Write property tests for DataStore — Property 5: Tag filtering completeness
    - Generate records with various tags and arbitrary tag filters
    - Assert: query returns exactly records whose tags are a superset of the filter
    - **Property 5: Tag filtering completeness**
    - **Validates: Requirements 3.4**

  - [ ]* 2.11 Write property tests for DataStore — Property 6: Pagination and ordering invariant
    - Generate record sets and test with various limit/offset combinations
    - Assert: paginated results concatenated equal full result set in timestamp-descending order
    - **Property 6: Pagination and ordering invariant**
    - **Validates: Requirements 3.5, 3.6, 3.8**

  - [ ]* 2.12 Write property tests for DataStore — Property 7: Bucket set/get/delete round-trip
    - Generate arbitrary bucket names, keys, and JSON-serializable values
    - Assert: set-then-get returns original value; set-then-delete-then-get returns undefined; double-set returns latest
    - **Property 7: Bucket set/get/delete round-trip**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ]* 2.13 Write property tests for DataStore — Property 8: Bucket list completeness
    - Generate sets of key-value pairs written to a bucket (with overwrites and deletes)
    - Assert: listBucket returns exactly the current keys with their latest values
    - **Property 8: Bucket list completeness**
    - **Validates: Requirements 4.4**

  - [ ]* 2.14 Write property tests for DataStore — Property 9: Retention enforcement correctness
    - Generate collections with various retentionDays and records with various timestamps
    - Assert: after enforceRetention(), records older than R days are deleted, records within R days preserved; null retention preserves all
    - **Property 9: Retention enforcement correctness**
    - **Validates: Requirements 5.1, 5.4**

  - [ ]* 2.15 Write property tests for DataStore — Property 12: FIFO eviction maintains size invariant
    - Generate write sequences exceeding maxRecordsPerCollection
    - Assert: collection never exceeds N records; oldest are evicted; newest write is always preserved
    - **Property 12: FIFO eviction maintains collection size invariant**
    - **Validates: Requirements 13.5**

  - [ ]* 2.16 Write property tests for DataStore — Property 13: Storage safeguard enforcement
    - Configure DataStore with small maxStorageMb and maxCollections limits
    - Assert: writes exceeding storage are rejected; collection creation exceeding max is rejected
    - **Property 13: Storage safeguard enforcement**
    - **Validates: Requirements 13.4, 13.6**

- [x] 3. Checkpoint — Core module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement REST API routes
  - [x] 4.1 Create `src/api/routes/data-store.routes.ts` with collection endpoints
    - Implement `createDataStoreRoutes(dataStore: DataStore): Router`
    - `GET /collections` — list all collections with metadata
    - `POST /collections` — create collection (validate name, check duplicates → 409)
    - `PATCH /collections/:name` — update description/retentionDays (404 if not found)
    - `DELETE /collections/:name` — delete collection and all records
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.12_

  - [x] 4.2 Add record endpoints to data-store routes
    - `POST /collections/:name/records` — write record (validate payload, 503 if disabled)
    - `GET /collections/:name/records` — query with from, to, limit, offset, tags, aggregate, field params
    - `GET /collections/:name/export` — CSV export with Content-Type and Content-Disposition headers
    - Validate query params (400 for invalid duration, non-numeric limit/offset)
    - _Requirements: 7.5, 7.6, 7.11, 7.13_

  - [x] 4.3 Add bucket endpoints to data-store routes
    - `GET /buckets` — list all buckets with key counts
    - `GET /buckets/:bucket` — list all entries in a bucket
    - `PUT /buckets/:bucket/:key` — set a key-value pair
    - `DELETE /buckets/:bucket/:key` — delete a key
    - _Requirements: 7.7, 7.8, 7.9, 7.10_

  - [x] 4.4 Add config, stats, enable/disable endpoints
    - `GET /config` — return current DataStoreConfig
    - `PUT /config` — update config (validate values)
    - `GET /stats` — return DataStoreStats
    - `POST /enable` — enable DataStore with provided config
    - `POST /disable` — disable DataStore
    - _Requirements: 13.7, 13.8, 11.1, 14.11, 14.12_

  - [ ]* 4.5 Write integration tests for REST API routes
    - Create `src/data-store/__tests__/data-store.routes.test.ts`
    - Use supertest with in-memory sql.js Database
    - Test CRUD operations, error responses (400, 404, 409, 503), CSV export
    - Test enable/disable lifecycle
    - _Requirements: 7.1–7.13, 13.7, 13.8_

- [x] 5. Implement sandbox `db` global integration
  - [x] 5.1 Wire DataStore into the Sandbox class
    - Add `dataStore?: DataStore` to `SandboxDeps` interface
    - In sandbox setup, create host-side references (`__dbWriteRef`, `__dbQueryRef`, `__dbGetRef`, `__dbSetRef`, `__dbDeleteRef`, `__dbCollectionsRef`) when dataStore is provided and enabled
    - Each reference wraps the corresponding DataStore method with JSON serialization/deserialization
    - Handle errors gracefully — log via sandbox log system, don't crash the script
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 14.2, 14.8_

  - [x] 5.2 Add bootstrap script additions for `db` global
    - Extend the BOOTSTRAP_SCRIPT string with the `globalThis.db` object wiring
    - Only wire if references are set (DataStore enabled); otherwise `db` remains undefined
    - _Requirements: 6.1, 14.2_

  - [x] 5.3 Update `sandbox-types.d.ts` with `db` global type declarations
    - Add type declarations for `db.write()`, `db.query()`, `db.get()`, `db.set()`, `db.delete()`, `db.collections()`
    - Include parameter types and return types
    - _Requirements: 6.9_

  - [ ]* 5.4 Write integration tests for sandbox `db` global
    - Create `src/data-store/__tests__/data-store.sandbox.test.ts`
    - Test that `db` methods work correctly through the sandbox isolation boundary
    - Test that `db` is undefined when DataStore is disabled
    - Test error handling (invalid payload logged, script continues)
    - _Requirements: 6.1–6.10_

- [x] 6. Implement event bus and WebSocket real-time updates
  - [x] 6.1 Add event constants and WebSocket mappings
    - Add `DATA_STORE_WRITE` and `DATA_STORE_COLLECTION_DELETED` constants to `src/core/event-bus.ts`
    - Add entries to the `WS_MAPPINGS` array in `index.ts` for both events
    - _Requirements: 9.1, 9.2, 9.4, 10.6_

  - [ ]* 6.2 Write integration tests for event emission
    - Test that `write()` emits `DATA_STORE_WRITE` with correct payload
    - Test that `deleteCollection()` emits `DATA_STORE_COLLECTION_DELETED`
    - _Requirements: 9.1, 9.4_

- [x] 7. Checkpoint — Backend complete, all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement frontend Zustand store
  - [x] 8.1 Create `frontend/src/store/data-store-store.ts`
    - Define `DataStoreState` interface with all state fields and actions
    - Implement REST API calls for fetchConfig, fetchCollections, fetchRecords, fetchBuckets, fetchBucketEntries, fetchStats
    - Implement selectCollection, selectBucket, setTimeRange actions
    - Implement `addRealtimeRecord` for WebSocket-driven updates
    - Implement `removeCollection` for real-time collection deletion
    - _Requirements: 8.2, 8.3, 9.3, 11.2_

  - [x] 8.2 Add WebSocket message handlers for data-store events
    - In `frontend/src/ws-client.ts` (or equivalent), add handlers for `data-store-write` and `data-store-collection-deleted` message types
    - Call `addRealtimeRecord` and `removeCollection` on the Zustand store
    - _Requirements: 9.3, 9.4_

- [x] 9. Implement frontend pages and components
  - [x] 9.1 Create `DataStorePage` component
    - Create `frontend/src/pages/DataStorePage.tsx`
    - Fetch config on mount; render SetupWizard if disabled, DataExplorer if enabled
    - _Requirements: 14.3_

  - [x] 9.2 Create `SetupWizard` component
    - Display system info (disk space, RAM, current DB size) — fetch from a stats endpoint or use placeholder
    - Show recommended defaults based on available disk (< 8GB, 8-32GB, > 32GB tiers)
    - Render editable config form (maxStorageMb, maxRecordsPerCollection, maxCollections)
    - Include brief explanation of what the Data Store does and how retention helps
    - On confirm, call `POST /api/data-store/enable` with chosen config
    - Follow Aeolus design system: Tailwind tokens, Lucide icons, card layout
    - _Requirements: 14.3, 14.4, 14.5, 14.6, 14.7, 14.10, 14.11, 8.11_

  - [x] 9.3 Create `DataExplorer` component with SummaryBar and tab switcher
    - SummaryBar: total collections, records, buckets, storage usage with progress bar
    - Amber warning at 80% storage, red critical at 95%
    - Tab switcher: Collections | Buckets | Settings
    - _Requirements: 8.2, 11.2, 15.1, 15.2, 15.3_

  - [x] 9.4 Create `CollectionList` and `CollectionDetail` components
    - CollectionList: card grid with name, description, record count, retention, last write, estimated size
    - "New Collection" button with creation form (name, description, retentionDays)
    - CollectionDetail: time-series chart + paginated record table + management controls (edit, delete with confirmation)
    - "Export CSV" button per collection
    - _Requirements: 8.2, 8.3, 8.6, 8.7, 8.8, 8.9, 15.4_

  - [x] 9.5 Create `TimeSeriesChart` component
    - Reuse existing `StateHistoryChart` SVG component with adapted props for DataStore records
    - Time range picker with presets: 1h, 6h, 24h, 7d, 30d
    - Auto-detect numeric fields from record payloads for multi-series display
    - Legend with toggleable series visibility
    - Smooth Catmull-Rom spline interpolation consistent with existing chart
    - _Requirements: 8.3, 8.4, 8.5, 8.12_

  - [x] 9.6 Create `RecordTable` component
    - Paginated table showing timestamp, payload fields, and tags
    - Support pagination controls (next/prev page)
    - _Requirements: 8.6_

  - [x] 9.7 Create `BucketList` component
    - Expandable list of buckets with key-value pairs
    - Show bucket name and key count in collapsed state
    - Expand to show all key-value entries with their updatedAt timestamps
    - _Requirements: 8.10_

  - [x] 9.8 Create `SettingsPanel` component
    - View and edit DataStore configuration (maxStorageMb, maxRecordsPerCollection, maxCollections)
    - Confirmation dialog before applying changes explaining impact
    - _Requirements: 15.5, 15.6_

- [x] 10. Sidebar integration and routing
  - [x] 10.1 Add "Data" pinned tab to sidebar and route
    - Add pinned tab entry to dashboard store default tabs: `{ id: "default-data-store", name: "Data", icon: "database", pinned: true, order: 3 }`
    - Add `"default-data-store": "/data-store"` to `PINNED_ROUTES` map in `Sidebar.tsx`
    - Add `<Route path="/data-store" element={<DataStorePage />} />` in `App.tsx`
    - Show subtle indicator (dot/badge) on sidebar tab when Data Store is disabled
    - _Requirements: 8.1, 14.9_

- [x] 11. Application wiring — startup and shutdown
  - [x] 11.1 Wire DataStore into `src/index.ts` startup sequence
    - Instantiate DataStore after database initialization, before automation engine loads rules
    - Pass DataStore to Sandbox constructor as optional dependency
    - Mount data-store routes at `/api/data-store` on Express app
    - Add WS_MAPPINGS entries for DATA_STORE_WRITE and DATA_STORE_COLLECTION_DELETED
    - Start retention enforcement timer after DataStore initialization
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

  - [x] 11.2 Add graceful shutdown handling for DataStore
    - Stop retention enforcement timer on shutdown signal
    - Persist database to disk before exit
    - _Requirements: 10.5_

- [x] 12. Final checkpoint — Full integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 13 universal correctness properties defined in the design
- Unit/integration tests validate specific examples, edge cases, and API behavior
- The duration parser module (task 1) has zero dependencies and can be implemented and tested in isolation
- The DataStore class (task 2) uses in-memory sql.js for testing — no file system needed
- Frontend components (tasks 8-10) depend on backend being complete (tasks 1-7)
- Application wiring (task 11) is the final step that connects all pieces
