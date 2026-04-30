# Implementation Plan: Runtime Custom UI

## Overview

Replace the build-time custom UI pipeline (Docker rebuild) with a runtime loading model. The backend transpiles TSX at save time, stores compiled output in the database, serves it via API, and the frontend loads it dynamically — eliminating the Docker rebuild cycle entirely.

## Tasks

- [x] 1. Extend backend transpiler with `transpileUi()` function
  - [x] 1.1 Add `transpileUi()` function to `src/automations/transpiler.ts`
    - Implement `transpileUi(source: string): TranspileResult` with compiler options: `target: ES2022`, `module: ESNext`, `jsx: react-jsx`, `jsxImportSource: react`, `strict: false`
    - Allow import statements (do NOT apply the `IMPORT_REQUIRE_RE` rejection used by `transpile()`)
    - Return structured errors with line/column/message for syntax failures
    - Return error for empty source strings: `"UI source cannot be empty"`
    - Preserve default export in the output
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 1.2 Write property tests for `transpileUi()` (Properties 1–4)
    - **Property 1: TSX transpilation round-trip produces valid JavaScript**
    - **Validates: Requirements 1.1, 1.6**
    - **Property 2: Default export preservation**
    - **Validates: Requirements 1.4**
    - **Property 3: Transpilation error reporting structure**
    - **Validates: Requirements 1.2**
    - **Property 4: React imports are allowed and JSX runtime is emitted**
    - **Validates: Requirements 1.5, 5.1**
    - Add tests to `src/automations/transpiler.test.ts` using `@fast-check/vitest` and `fast-check`
    - Generate random valid TSX component strings for Properties 1, 2, 4
    - Generate random invalid TSX strings for Property 3

  - [ ]* 1.3 Write unit tests for `transpileUi()` edge cases
    - Test `transpileUi("")` returns error (Req 1.3)
    - Test `transpileUi` with `import React from "react"` succeeds (Req 1.5)
    - Test existing `transpile` with `import React from "react"` still fails (existing behavior preserved)
    - Test output contains `react/jsx-runtime` reference for JSX input (Req 5.1)
    - _Requirements: 1.2, 1.3, 1.5, 5.1_

- [x] 2. Database migration — add `compiled_ui` column
  - [x] 2.1 Add `compiled_ui` column to `automation_rules` table in `src/db/database.ts`
    - Add `addColumn("compiled_ui", "TEXT DEFAULT NULL")` in the migration section of `initSchema()`
    - Add `compiled_ui` to the `StoredRule` interface in `src/api/routes/automation.routes.ts`
    - Ensure existing rows are not broken by the migration
    - _Requirements: 2.5_

- [x] 3. Checkpoint — Ensure transpiler and migration work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update API routes — transpile and store compiled UI on create/update
  - [x] 4.1 Update `POST /api/automations` to transpile `uiSource` and store `compiled_ui`
    - Import `transpileUi` from `transpiler.ts`
    - When `uiSource` is provided, call `transpileUi(uiSource)` and store result in `compiled_ui` column
    - If transpilation fails, return 400 with structured error details and do NOT create the rule
    - Remove `customUiManager.writeComponent()` calls from the create handler
    - _Requirements: 2.1, 2.4_

  - [x] 4.2 Update `PUT /api/automations/:id` to re-transpile `uiSource` and update `compiled_ui`
    - When `uiSource` is updated, call `transpileUi(uiSource)` and update `compiled_ui` column
    - When `uiSource` is cleared (empty/null), set `compiled_ui` to null
    - If transpilation fails, return 400 with structured errors and do NOT modify `compiled_ui`
    - Remove `customUiManager.writeComponent()` and `customUiManager.deleteComponent()` calls from the update handler
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 4.3 Add `GET /api/automations/:id/ui-module` endpoint
    - Query `compiled_ui` from the database for the given rule ID
    - If rule exists and has `compiled_ui`, respond with the JS string, `Content-Type: application/javascript`, and `Cache-Control: no-cache`
    - If rule does not exist or has no `compiled_ui`, respond with 404
    - Add the route BEFORE the `/:id` parameter routes to avoid conflicts
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 4.4 Write unit/integration tests for API changes
    - Test POST with valid `uiSource` stores `compiled_ui` (Req 2.1)
    - Test PUT with new `uiSource` updates `compiled_ui` (Req 2.2)
    - Test PUT with `uiSource=""` clears `compiled_ui` (Req 2.3)
    - Test POST with invalid TSX returns 400, no rule created (Req 2.4)
    - Test GET `/:id/ui-module` returns correct Content-Type and Cache-Control (Req 3.1, 3.4)
    - Test GET `/:id/ui-module` returns 404 for missing rule (Req 3.3)
    - Test GET `/:id/ui-module` returns 404 for rule without `compiled_ui` (Req 3.2)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

- [x] 5. Checkpoint — Ensure backend API changes work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend dynamic loader — `useDynamicComponent` hook
  - [x] 6.1 Register external dependencies as globals in `frontend/src/main.tsx`
    - Import `React`, `ReactDOM`, and `react/jsx-runtime` as namespace imports
    - Assign them to `window.__AEOLUS_EXTERNALS__` with keys `"react"`, `"react-dom"`, `"react/jsx-runtime"`
    - Add TypeScript declaration for `window.__AEOLUS_EXTERNALS__` on the `Window` interface
    - _Requirements: 4.4, 5.2_

  - [x] 6.2 Create `frontend/src/hooks/useDynamicComponent.ts` hook
    - Implement `useDynamicComponent(ruleId: string, hasUiSource: boolean): DynamicComponentState`
    - Fetch compiled module from `GET /api/automations/:ruleId/ui-module`
    - Implement import specifier rewriting: replace `import { ... } from "react"`, `import { ... } from "react-dom"`, `import { ... } from "react/jsx-runtime"` with destructuring from `window.__AEOLUS_EXTERNALS__`
    - Create blob URL from rewritten source, call `import(blobUrl)`, extract `.default` export
    - Validate default export is a function; set error if not
    - Revoke blob URL after import
    - Return `{ Component, loading, error }` state
    - Handle non-200 responses with descriptive error messages
    - Handle network errors/timeouts with connection error message
    - Re-fetch when `ruleId` changes (dependency in useEffect)
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 5.2, 7.2, 7.3, 7.4_

  - [ ]* 6.3 Write property test for import specifier rewriting (Property 5)
    - **Property 5: Import specifier rewriting resolves all React externals**
    - **Validates: Requirements 4.4, 5.2**
    - Extract the import rewriting function as a testable pure function
    - Generate JS strings with various `import { ... } from "react"` patterns
    - Verify output contains zero remaining `import ... from "react..."` statements for external specifiers
    - Add tests to `frontend/src/hooks/useDynamicComponent.test.ts`

  - [ ]* 6.4 Write unit tests for `useDynamicComponent` hook
    - Test loading state is shown while fetching (Req 4.6)
    - Test error state for non-function default export (Req 7.3)
    - Test error state for network failure (Req 7.4)
    - Test error state for non-200 response (Req 7.2)
    - Test re-fetch on ruleId change (Req 4.5)
    - _Requirements: 4.5, 4.6, 7.2, 7.3, 7.4_

- [x] 7. Integrate dynamic loader into AutomationPane
  - [x] 7.1 Replace static `CUSTOM_COMPONENTS` import with `useDynamicComponent` in `AutomationPane.tsx`
    - Remove `import { CUSTOM_COMPONENTS } from "./custom/index"`
    - Call `useDynamicComponent(ruleId, !!rule?.uiSource)` in the status mode section
    - Replace `CUSTOM_COMPONENTS[ruleId]` lookup with the hook's `Component` result
    - Show loading indicator while `loading` is true
    - Show error message within the pane when `error` is set
    - Wrap the dynamic component in `CustomComponentBoundary` (already exists)
    - Remove `showRebuildBanner` logic (no longer needed — components load instantly)
    - _Requirements: 4.1, 4.2, 4.6, 6.3, 7.1_

- [x] 8. Remove old build-time custom UI pipeline
  - [x] 8.1 Remove `CustomUiManager` from backend
    - Delete `src/automations/custom-ui-manager.ts`
    - Remove `CustomUiManager` import and instantiation from `src/index.ts`
    - Remove `customUiManager` parameter from `createAutomationRoutes()` function signature
    - Remove remaining `customUiManager` references in `automation.routes.ts` (delete handler)
    - _Requirements: 6.1, 6.5_

  - [x] 8.2 Remove rebuild endpoints from system routes
    - Remove `POST /api/system/rebuild-frontend` route from `src/api/routes/system.routes.ts`
    - Remove `GET /api/system/rebuild-status` route from `src/api/routes/system.routes.ts`
    - Remove `rebuildStatus`, `startRebuildTracking`, `stopRebuildTracking` state machine and exports
    - _Requirements: 6.4_

  - [x] 8.3 Remove rebuild UI from AutomationPane
    - Remove "Rebuild Frontend" button from the editing mode action buttons
    - Remove rebuild status polling (`rebuildPollRef`, `handleRebuild`, `rebuildStatus`, `rebuildStartTime`, `rebuildElapsed`)
    - Remove rebuild status indicators (rebuilding spinner, "Rebuild complete" banner, "Refresh Now" button)
    - Remove unused imports: `Hammer`, `CheckCircle`, `RefreshCw`
    - _Requirements: 6.2_

  - [x] 8.4 Remove static custom component registry
    - Delete `frontend/src/components/panes/custom/index.ts` (the auto-generated `CUSTOM_COMPONENTS` registry)
    - Keep `frontend/src/components/panes/custom/types.ts` (still used by dynamic components)
    - _Requirements: 6.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify `CustomUiManager` file does not exist (Req 6.5)
  - Verify `rebuild-frontend` endpoint is removed (Req 6.4)
  - Verify AutomationPane does not import `CUSTOM_COMPONENTS` (Req 6.3)

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 5 correctness properties from the design document using `fast-check`
- The existing `CustomComponentBoundary` error boundary is retained unchanged (Req 7.1)
- The existing `CustomComponentProps` interface in `types.ts` is retained unchanged
