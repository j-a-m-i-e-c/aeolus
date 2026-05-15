# Implementation Plan: Performance Architecture Uplift

## Overview

Replace the TypeScript compiler and sql.js with esbuild and better-sqlite3 respectively, upgrade to Node.js 24, and cap V8 heap size. The implementation proceeds in isolation layers: transpiler first (single file, no dependencies), then database module (single file), then consumers (mechanical migration), then infrastructure/docs cleanup.

## Tasks

- [ ] 1. Replace TypeScript compiler with esbuild in the transpiler module
  - [ ] 1.1 Update `src/automations/transpiler.ts` to use esbuild `transformSync()`
    - Replace `import * as ts from "typescript"` with `import { transformSync, type Message } from "esbuild"`
    - Implement `logicOptions` config object (loader: "ts", target: "es2022", format: "esm", sourcemap: false)
    - Implement `uiOptions` config object (loader: "tsx", target: "es2022", format: "esm", jsx: "automatic", jsxImportSource: "react")
    - Implement `mapEsbuildErrors()` helper to convert esbuild `Message[]` to `TranspileError[]`
    - Rewrite `transpile()` to use `transformSync(source, logicOptions)` with try/catch for syntax errors
    - Rewrite `transpileUi()` to use `transformSync(source, uiOptions)` with try/catch for syntax errors
    - Preserve existing empty/whitespace check and import/require rejection logic unchanged
    - Ensure function signatures and `TranspileResult` type remain identical
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 1.2 Write property tests for the transpiler (Properties 1-5, 7)
    - **Property 1: Type annotation stripping produces valid JavaScript**
    - **Property 2: Import/require patterns are always rejected**
    - **Property 3: Whitespace-only input rejection**
    - **Property 4: Syntax error structure correctness**
    - **Property 5: JSX automatic runtime transform in UI output**
    - **Property 7: Transpilation performance bound**
    - Create or update `src/automations/transpiler.property.test.ts`
    - Use fast-check with @fast-check/vitest, minimum 100 iterations per property
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.5, 9.2**

- [ ] 2. Checkpoint — Verify transpiler swap
  - Ensure all transpiler-related tests pass, ask the user if questions arise.

- [ ] 3. Rewrite the database module to use better-sqlite3
  - [ ] 3.1 Rewrite `src/db/database.ts` with better-sqlite3
    - Replace `import initSqlJs` / sql.js imports with `import Database from "better-sqlite3"`
    - Implement synchronous `getDatabase()` that returns `DatabaseType` directly (not a Promise)
    - Create database file directory with `fs.mkdirSync(dir, { recursive: true })` if needed
    - Open database with `new Database(config.dbPath)`
    - Set `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`
    - Call `initSchema(db)` using `db.exec()` for DDL statements
    - Implement `closeDatabase()` for graceful shutdown
    - Remove the `persistDatabase()` export entirely
    - Update `initSchema()` to use `database.exec()` for CREATE TABLE/INDEX statements
    - Preserve all existing schema migration logic (migrateAddColumns, migrateRemoveTypeCheck)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3_

  - [ ]* 3.2 Write property test for database persistence (Property 6)
    - **Property 6: Database write round-trip persistence**
    - Create or update `src/db/database.property.test.ts`
    - Use an in-memory database (`:memory:`) for test isolation
    - Verify that any key-value pair written via prepared statement is immediately readable without explicit flush
    - **Validates: Requirements 4.7, 5.8**

  - [ ] 3.3 Remove `src/types/sql.js.d.ts` type declaration file
    - Delete the sql.js type shim as it is no longer needed
    - _Requirements: 5.9_

- [ ] 4. Migrate device-registry to better-sqlite3
  - [ ] 4.1 Update `src/core/device-registry.ts`
    - Change import from `sql.js` Database type to `better-sqlite3` Database type
    - Replace `db.exec(sql, params)` calls with `db.prepare(sql).all(...params)` for SELECT queries
    - Replace `db.run(sql, params)` calls with `db.prepare(sql).run(...params)` for INSERT/UPDATE/DELETE
    - Remove all `persistDatabase()` imports and calls
    - Replace manual column/value array parsing with direct object property access on returned rows
    - Define typed row interfaces for type-safe property access
    - _Requirements: 5.1, 5.8_

  - [ ]* 4.2 Update device-registry tests
    - Update `src/core/device-registry.property.test.ts` to use better-sqlite3 `:memory:` database
    - Replace `initSqlJs()` test setup with `new Database(":memory:")`
    - Ensure all existing test assertions still pass
    - _Requirements: 5.1_

- [ ] 5. Migrate automation-state-store to better-sqlite3
  - [ ] 5.1 Update `src/automations/automation-state-store.ts`
    - Change import from `sql.js` Database type to `better-sqlite3` Database type
    - Replace `db.exec()` / `db.run()` calls with `db.prepare().all()` / `db.prepare().run()`
    - Remove all `persistDatabase()` imports and calls
    - Replace manual column/value parsing with direct object property access
    - _Requirements: 5.2, 5.8_

- [ ] 6. Migrate connector-store to better-sqlite3
  - [ ] 6.1 Update `src/connectors/connector-store.ts`
    - Change import from `sql.js` Database type to `better-sqlite3` Database type
    - Replace `db.exec()` / `db.run()` calls with `db.prepare().all()` / `db.prepare().run()`
    - Remove all `persistDatabase()` imports and calls
    - Replace manual column/value parsing with direct object property access
    - Define `ConnectorRow` interface for typed row access
    - _Requirements: 5.3, 5.8_

  - [ ]* 6.2 Update connector-store tests
    - Update `src/connectors/connector-store.test.ts` to use better-sqlite3 `:memory:` database
    - Replace `initSqlJs()` test setup with `new Database(":memory:")`
    - _Requirements: 5.3_

- [ ] 7. Migrate service-store to better-sqlite3
  - [ ] 7.1 Update `src/services/service-store.ts`
    - Change import from `sql.js` Database type to `better-sqlite3` Database type
    - Replace `db.exec()` / `db.run()` calls with `db.prepare().all()` / `db.prepare().run()`
    - Remove all `persistDatabase()` imports and calls
    - Replace manual column/value parsing with direct object property access
    - _Requirements: 5.4, 5.8_

- [ ] 8. Migrate data-store to better-sqlite3
  - [ ] 8.1 Update `src/data-store/data-store.ts`
    - Change import from `sql.js` Database type to `better-sqlite3` Database type
    - Replace all `db.exec(sql, params)` calls with `db.prepare(sql).all(...params)` for SELECT queries
    - Replace all `db.run(sql, params)` calls with `db.prepare(sql).run(...params)` for mutations
    - Remove all `persistDatabase()` imports and calls
    - Replace manual column/value array parsing with direct object property access
    - This is the largest consumer — carefully migrate each query method
    - _Requirements: 5.5, 5.8_

  - [ ]* 8.2 Update data-store tests
    - Update `src/data-store/__tests__/` test files to use better-sqlite3 `:memory:` database
    - Replace `initSqlJs()` test setup with `new Database(":memory:")`
    - _Requirements: 5.5_

- [ ] 9. Migrate layout routes to better-sqlite3
  - [ ] 9.1 Update `src/api/routes/layout.routes.ts`
    - Change import from `sql.js` Database type to `better-sqlite3` Database type
    - Replace `db.exec()` / `db.run()` calls with `db.prepare().all()` / `db.prepare().run()`
    - Replace manual BEGIN/COMMIT/ROLLBACK transaction pattern with `db.transaction(() => { ... })()`
    - Remove all `persistDatabase()` imports and calls
    - _Requirements: 5.6, 5.8_

- [ ] 10. Migrate automation routes to better-sqlite3
  - [ ] 10.1 Update `src/api/routes/automation.routes.ts`
    - Change import from `sql.js` Database type to `better-sqlite3` Database type
    - Replace `db.exec()` / `db.run()` calls with `db.prepare().all()` / `db.prepare().run()`
    - Remove all `persistDatabase()` imports and calls
    - _Requirements: 5.7, 5.8_

- [ ] 11. Checkpoint — Verify all database consumer migrations
  - Ensure all tests pass, ask the user if questions arise.
  - Grep the codebase for any remaining `persistDatabase` references or `sql.js` imports

- [ ] 12. Update application entry point and startup
  - [ ] 12.1 Update `src/index.ts` for synchronous database initialization
    - Replace `await getDatabase()` with synchronous `getDatabase()` call
    - Remove any async wrapper around database initialization
    - Ensure `closeDatabase()` is called on graceful shutdown (SIGTERM/SIGINT handlers)
    - _Requirements: 6.1, 6.2_

- [ ] 13. Update package.json dependencies
  - [ ] 13.1 Modify `package.json` dependency sections
    - Add `better-sqlite3` (^11.0.0) to dependencies
    - Add `esbuild` (^0.25.0) to dependencies
    - Remove `sql.js` from dependencies entirely
    - Move `typescript` from dependencies to devDependencies (keep version ^5.7.3)
    - Add `@types/better-sqlite3` (^7.6.0) to devDependencies
    - Run `npm install` to regenerate lock file
    - _Requirements: 3.1, 3.2, 3.3, 5.9, 5.10_

- [ ] 14. Update Dockerfile for Node.js 24 and heap cap
  - [ ] 14.1 Modify `Dockerfile`
    - Change builder stage from `node:22-alpine` to `node:24-alpine`
    - Change production stage from `node:22-alpine` to `node:24-alpine`
    - Update tsup target from `--target node22` to `--target node24`
    - Update CMD to `["node", "--max-old-space-size=1024", "dist/index.js"]`
    - Verify `python3 make g++` are already in builder stage for native module compilation
    - _Requirements: 7.1, 7.2, 11.1_

- [ ] 15. Update CI/CD workflow for Node.js 24
  - [ ] 15.1 Modify `.github/workflows/ci.yml`
    - Update Node.js version matrix/setup to use Node.js 24
    - Ensure native build tools are available for better-sqlite3 compilation in CI
    - _Requirements: 11.2, 11.3_

- [ ] 16. Update documentation
  - [ ] 16.1 Update `CONTRIBUTING.md` with native build prerequisites
    - Document required native build tools: Python 3, make, g++ (Linux/macOS)
    - Document Windows requirements: node-gyp with Visual Studio Build Tools
    - Note that Docker build environment already includes the C++ toolchain
    - Update Node.js version reference to 24
    - _Requirements: 10.1, 10.2, 11.4_

- [ ] 17. Final verification and cleanup
  - [ ]* 17.1 Write integration smoke tests
    - Verify `typescript` is not in production dependencies (parse package.json)
    - Verify `sql.js` is not in any dependency section
    - Grep codebase for any remaining `persistDatabase()` calls — should be zero
    - Grep codebase for any remaining `sql.js` or `initSqlJs` imports — should be zero
    - Verify Dockerfile uses `node:24-alpine` and `--max-old-space-size=1024`
    - _Requirements: 3.1, 3.4, 5.8, 5.9, 8.3, 8.4_

- [ ] 18. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify the application starts successfully with `npm start` or equivalent
  - Confirm no TypeScript compilation errors with `npx tsc --noEmit`

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The transpiler swap (task 1) is isolated — it touches only one file and has no database dependencies
- The database module rewrite (task 3) is the foundation — all consumer migrations depend on it
- Consumer migrations (tasks 4-10) follow an identical mechanical pattern and can be done in any order
- The biggest risk is missing a `persistDatabase()` call or `sql.js` import — task 11 includes a grep check
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All changes are backend-internal — no frontend modifications required
