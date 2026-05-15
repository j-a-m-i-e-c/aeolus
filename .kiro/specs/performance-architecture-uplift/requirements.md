# Requirements Document

## Introduction

This feature replaces two memory-heavy dependencies in the Aeolus backend — the TypeScript compiler and sql.js — with lightweight alternatives (esbuild and better-sqlite3), and caps V8 heap size. The goal is to reduce idle memory from ~370MB to ~150-200MB on the Raspberry Pi 4 (4GB RAM), improve transpilation speed, and prevent unbounded heap growth. These are internal implementation swaps with no changes to external API surfaces or frontend behavior.

## Glossary

- **Transpiler**: The module at `src/automations/transpiler.ts` that converts TypeScript/TSX source code into JavaScript for execution in the automation sandbox or browser
- **Logic_Script**: A TypeScript automation script that runs in the isolated-vm sandbox — imports are forbidden, all APIs are globals
- **UI_Component**: A TSX source file that compiles to an ES module with React JSX transform for custom dashboard panels
- **Database_Module**: The module at `src/db/database.ts` that initializes and provides access to the SQLite database
- **Backend**: The Node.js Express server running in the Docker production container
- **esbuild**: A fast JavaScript/TypeScript bundler and transpiler written in Go, used here only for its `transformSync()` API
- **better-sqlite3**: A native C++ SQLite binding for Node.js that keeps the database on disk and provides synchronous query APIs
- **WAL_Mode**: SQLite Write-Ahead Logging mode that improves concurrent read performance
- **Heap_Cap**: The `--max-old-space-size` Node.js flag that limits V8 old-generation heap memory

## Requirements

### Requirement 1: Logic Script Transpilation via esbuild

**User Story:** As a platform operator, I want automation scripts transpiled using esbuild instead of the TypeScript compiler, so that transpilation uses less memory and completes faster.

#### Acceptance Criteria

1. WHEN a Logic_Script source is submitted for transpilation, THE Transpiler SHALL strip type annotations and emit ES2022 JavaScript using esbuild's `transformSync()` API
2. WHEN a Logic_Script source contains import or require statements, THE Transpiler SHALL reject the source and return a structured error before invoking esbuild
3. WHEN a Logic_Script source contains a syntax error, THE Transpiler SHALL return a structured error object with line, column, and message fields matching the existing `TranspileError` interface
4. WHEN a Logic_Script source is empty or whitespace-only, THE Transpiler SHALL return a structured error indicating the source cannot be empty
5. THE Transpiler SHALL expose the same function signatures and return types (`transpile()` returning `TranspileResult`) as the current implementation

### Requirement 2: UI Component Transpilation via esbuild

**User Story:** As a platform operator, I want UI components transpiled using esbuild with JSX support, so that TSX compilation uses less memory while producing identical output.

#### Acceptance Criteria

1. WHEN a UI_Component TSX source is submitted for transpilation, THE Transpiler SHALL transform it to ES module JavaScript using esbuild with the React JSX automatic runtime transform
2. WHEN a UI_Component source contains a syntax error, THE Transpiler SHALL return a structured error object with line, column, and message fields
3. WHEN a UI_Component source is empty or whitespace-only, THE Transpiler SHALL return a structured error indicating the source cannot be empty
4. THE Transpiler SHALL expose the same function signature and return type (`transpileUi()` returning `TranspileResult`) as the current implementation
5. THE Transpiler SHALL configure esbuild to target ES2022 and output ESNext module format for UI_Component transpilation

### Requirement 3: Remove TypeScript Compiler from Production

**User Story:** As a platform operator, I want the TypeScript compiler removed from production dependencies, so that it no longer consumes ~60-80MB of RAM at runtime.

#### Acceptance Criteria

1. THE Backend SHALL NOT include the `typescript` package in production dependencies
2. THE Backend SHALL retain the `typescript` package as a devDependency for build-time type checking via `tsc`
3. THE Backend SHALL include `esbuild` as a production dependency
4. WHEN the Backend starts, THE Backend SHALL NOT load the TypeScript compiler module into memory

### Requirement 4: Replace sql.js with better-sqlite3

**User Story:** As a platform operator, I want the database backed by better-sqlite3 instead of sql.js, so that the entire database is not loaded into RAM and memory usage scales with query working set rather than total database size.

#### Acceptance Criteria

1. THE Database_Module SHALL use better-sqlite3 to open and query the SQLite database file at the configured `DB_PATH`
2. THE Database_Module SHALL create the database file automatically if it does not exist at the configured path
3. THE Database_Module SHALL enable WAL_Mode via `PRAGMA journal_mode=WAL` on database initialization
4. THE Database_Module SHALL enable foreign keys via `PRAGMA foreign_keys = ON` on database initialization
5. THE Database_Module SHALL execute all existing schema creation statements (devices, automation_rules, tabs, panes, connectors, services, automation_state, device_history tables) on initialization
6. WHEN a database query is executed, THE Database_Module SHALL use better-sqlite3's synchronous prepared statement API (`prepare().run()`, `prepare().all()`, `prepare().get()`)
7. THE Database_Module SHALL NOT require an explicit `persistDatabase()` call — all writes persist to disk automatically on execution

### Requirement 5: Update All Database Consumers

**User Story:** As a platform operator, I want all modules that access the database updated to use the better-sqlite3 API, so that the application functions correctly with the new database driver.

#### Acceptance Criteria

1. WHEN the device-registry module performs database operations, THE device-registry SHALL use better-sqlite3 prepared statement methods
2. WHEN the automation-state-store module performs database operations, THE automation-state-store SHALL use better-sqlite3 prepared statement methods
3. WHEN the connector-store module performs database operations, THE connector-store SHALL use better-sqlite3 prepared statement methods
4. WHEN the service-store module performs database operations, THE service-store SHALL use better-sqlite3 prepared statement methods
5. WHEN the data-store module performs database operations, THE data-store SHALL use better-sqlite3 prepared statement methods
6. WHEN the layout routes module performs database operations, THE layout routes SHALL use better-sqlite3 prepared statement methods
7. WHEN the automation routes module performs database operations, THE automation routes SHALL use better-sqlite3 prepared statement methods
8. THE Backend SHALL remove all calls to `persistDatabase()` throughout the codebase
9. THE Backend SHALL NOT include `sql.js` in production or development dependencies
10. THE Backend SHALL include `better-sqlite3` and `@types/better-sqlite3` in the appropriate dependency sections

### Requirement 6: Database Initialization API Change

**User Story:** As a platform operator, I want the database initialization to be synchronous, so that startup is simpler and faster without WASM compilation overhead.

#### Acceptance Criteria

1. THE Database_Module SHALL provide a synchronous `getDatabase()` function that returns the database instance directly (not wrapped in a Promise)
2. WHEN the Backend starts, THE Database_Module SHALL initialize the database synchronously without loading or compiling WASM binaries
3. THE Database_Module SHALL run all schema migrations synchronously during initialization

### Requirement 7: Cap V8 Heap Size

**User Story:** As a platform operator, I want the Node.js process heap capped at 1024MB, so that the backend cannot consume all available RAM on the Raspberry Pi and Docker can restart it if memory grows unbounded.

#### Acceptance Criteria

1. THE Dockerfile CMD SHALL start the Node.js process with the `--max-old-space-size=1024` flag
2. IF the Node.js process exceeds the 1024MB heap limit, THEN THE Backend SHALL terminate with an out-of-memory error allowing Docker to restart the container via the configured restart policy

### Requirement 8: Backward Compatibility

**User Story:** As a platform operator, I want all existing automations, data, and API behavior preserved after the architecture changes, so that the upgrade is transparent to users and connected devices.

#### Acceptance Criteria

1. THE Transpiler SHALL produce functionally equivalent JavaScript output for all valid Logic_Script inputs as the previous TypeScript compiler implementation
2. THE Transpiler SHALL produce functionally equivalent JavaScript output for all valid UI_Component inputs as the previous TypeScript compiler implementation
3. THE Database_Module SHALL operate on the same SQLite database file without requiring data migration or schema changes
4. THE Backend SHALL return identical API responses for all existing endpoints after the dependency swap
5. THE Backend seed script SHALL continue to function correctly with the new database driver
6. THE Frontend SHALL require no modifications — all changes are backend-internal

### Requirement 9: Performance Targets

**User Story:** As a platform operator, I want measurable performance improvements from the architecture changes, so that the platform runs sustainably on resource-constrained hardware.

#### Acceptance Criteria

1. WHILE the Backend is idle with no active requests, THE Backend SHALL consume no more than 200MB of RSS memory
2. WHEN a Logic_Script is transpiled, THE Transpiler SHALL complete the transformation in under 10ms for scripts under 10KB
3. WHEN the Backend starts, THE Backend SHALL reach a ready state faster than the previous implementation by avoiding WASM compilation and full database loading into RAM
4. WHEN a database query is executed, THE Database_Module SHALL complete the query faster than the equivalent sql.js WASM-based execution for typical workloads

### Requirement 10: Development Environment Documentation

**User Story:** As a contributor, I want clear documentation on build prerequisites for better-sqlite3, so that I can set up the development environment on any supported platform.

#### Acceptance Criteria

1. WHEN a contributor reads CONTRIBUTING.md, THE documentation SHALL describe the native build tools required for better-sqlite3 (Python 3, make, g++ on Linux/macOS; node-gyp with Visual Studio Build Tools on Windows)
2. THE documentation SHALL note that the Docker build environment already includes the required C++ toolchain and requires no Dockerfile changes

### Requirement 11: Upgrade to Node.js 24 LTS

**User Story:** As a platform operator, I want Aeolus running on the current Node.js LTS release, so that I benefit from the latest performance improvements, security patches, and V8 engine optimizations.

#### Acceptance Criteria

1. THE Dockerfile SHALL use `node:24-alpine` as the base image for both builder and production stages
2. THE CI_Pipeline SHALL use Node.js 24 in the GitHub Actions workflow
3. THE Backend SHALL be verified to start and pass all tests on Node.js 24
4. THE documentation SHALL reference Node.js 24 as the required runtime version
