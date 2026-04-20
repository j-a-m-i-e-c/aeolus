# Implementation Plan: Automation Overhaul

## Overview

Transform Aeolus from a platform that logs automation actions into one that executes them — with a TypeScript sandbox, Monaco code editor, Action Executor dispatch pipeline, and richer form actions. Implementation proceeds backend-first (Action Executor → Transpiler → Sandbox → DB migration → API routes), then frontend (Monaco editor → dual-mode page → form enhancements), then integration and documentation.

## Tasks

- [x] 1. Action Executor — core dispatch service
  - [x] 1.1 Create `ActionDescriptor` and `ActionExecutorDeps` interfaces in `src/automations/action-executor.ts`
    - Define `ActionDescriptor` with `type`, `target`, `params` fields
    - Define `ActionExecutorDeps` accepting `MqttService`, `ConnectorManager`, `Logger`
    - Export the `ActionExecutor` class with `execute(action, ruleId)` and `executeSequence(actions, ruleId)` methods
    - Implement dispatch logic: `publish` → `MqttService.publish()`, `toggle` → `ConnectorManager.executeAction()`, `device_action` → `ConnectorManager.executeAction()`, `log` → `logger.info()`, `delay` → `setTimeout` wrapper, `webhook` → `fetch()`
    - Wrap each action in try/catch — log errors with rule ID, never throw
    - Emit `AUTOMATION_FIRED` on event bus after each successful action
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.4_

  - [ ]* 1.2 Write property tests for Action Executor (`src/automations/action-executor.property.test.ts`)
    - **Property 1: Action dispatch correctness** — for any valid ActionDescriptor, verify correct service is called with exact target and params
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7**
    - **Property 2: Unknown action types handled gracefully** — for any string not in the valid set, verify no throw and warning logged
    - **Validates: Requirements 1.8**
    - **Property 3: Sequence failure isolation** — for any sequence with some failing actions, verify all non-failing actions still execute
    - **Validates: Requirements 1.9**
    - **Property 4: AUTOMATION_FIRED event emission** — for any successful action, verify event emitted with correct ruleId, actionType, target, and recent timestamp
    - **Validates: Requirements 2.4**

  - [ ]* 1.3 Write unit tests for Action Executor (`src/automations/action-executor.test.ts`)
    - Test delay with zero/negative duration treated as no-op
    - Test publish when MqttService is disconnected — error logged, no crash
    - Test webhook with non-2xx response — error logged, sequence continues
    - _Requirements: 1.6, 1.8, 1.9, 2.3_

- [x] 2. TypeScript Transpiler
  - [x] 2.1 Create `transpile()` function in `src/automations/transpiler.ts`
    - Define `TranspileResult` and `TranspileError` interfaces
    - Use `ts.transpileModule()` with ES2022 target to strip type annotations
    - Pre-check source for `import`/`require` statements via regex — reject with descriptive error
    - Reject empty source strings with "Script source cannot be empty"
    - Return structured errors with `line`, `column`, `message` on failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 2.2 Write property tests for Transpiler (`src/automations/transpiler.property.test.ts`)
    - **Property 9: TypeScript transpilation round-trip** — for any valid TS source with type annotations, verify output contains no TS-specific syntax
    - **Validates: Requirements 4.1, 4.3, 4.5**
    - **Property 10: Transpilation error reporting with line numbers** — for any source with a syntax error at a known line, verify error line matches
    - **Validates: Requirements 4.2**
    - **Property 11: Import/require rejection** — for any source containing import/require, verify rejection with descriptive error
    - **Validates: Requirements 4.4**

  - [ ]* 2.3 Write unit tests for Transpiler (`src/automations/transpiler.test.ts`)
    - Test empty source rejection
    - Test specific syntax error cases
    - Test valid TS with interfaces, type aliases, typed params produces clean JS
    - _Requirements: 4.1, 4.2, 4.4_

- [x] 3. TypeScript Sandbox with `isolated-vm`
  - [x] 3.1 Add `isolated-vm` to dependencies and update Dockerfile build tools
    - Add `isolated-vm` to `package.json` dependencies
    - Ensure Dockerfile includes C++ build toolchain (`build-essential`, `python3`) for native addon compilation on ARM64
    - _Requirements: 3.1_

  - [x] 3.2 Create `Sandbox` class in `src/automations/sandbox.ts`
    - Accept `SandboxDeps` (ActionExecutor, DeviceRegistry) in constructor
    - Implement `execute(compiledJs, context, ruleId)` method
    - Create `ivm.Isolate` with 32MB memory limit per execution
    - Create `ivm.Context` and inject sandbox API globals: `devices`, `mqtt`, `log`, `context`
    - `devices.get/list/filter` — synchronous, copy data into isolate via `ivm.ExternalCopy`
    - `devices.action()` and `mqtt.publish()` — host-side callbacks via `ivm.Reference` delegating to ActionExecutor
    - `log.info/warn/error` — host-side callbacks delegating to logger with ruleId context
    - `context` — inject as frozen object with `topic`, `deviceId`, `state`, `timestamp`
    - Enforce 5-second execution timeout via `script.run(context, { timeout: 5000 })`
    - Ensure `require`, `import`, `process`, `fs`, `child_process`, `eval`, `Function`, `global` are inaccessible
    - Catch all errors — log with ruleId, never propagate to caller
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [ ]* 3.3 Write property tests for Sandbox (`src/automations/sandbox.property.test.ts`)
    - **Property 5: Sandbox API data correctness** — for any device registry state and event context, verify `devices.list()` length, `devices.get(id)` correctness, `devices.filter()` predicate, and `context` field matching
    - **Validates: Requirements 3.2, 3.5**
    - **Property 6: Sandbox-to-host delegation** — for any script calling `mqtt.publish`, `log.*`, or `devices.action`, verify host-side service receives exact arguments
    - **Validates: Requirements 2.2, 3.3, 3.4, 3.10**
    - **Property 7: Sandbox security — forbidden globals** — for any identifier in {require, import, process, fs, child_process, eval, Function, global}, verify access yields undefined or ReferenceError
    - **Validates: Requirements 3.6**
    - **Property 8: Sandbox error isolation** — for any script that throws, verify error is caught, logged with ruleId, and not propagated
    - **Validates: Requirements 3.8**

  - [ ]* 3.4 Write unit tests for Sandbox (`src/automations/sandbox.test.ts`)
    - Test 5-second timeout enforcement (script with infinite loop)
    - Test 32MB memory limit (script allocating large arrays)
    - Test integration: script calling `devices.action()` triggers ActionExecutor
    - _Requirements: 3.8, 3.9_

- [x] 4. Checkpoint — backend core modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Database migration and type definition bundle
  - [x] 5.1 Migrate SQLite schema for script rule support
    - Update `initSchema` in `src/db/database.ts` to include `rule_type`, `script_source`, `compiled_js` columns in the `automation_rules` table
    - Add `CHECK(rule_type IN ('form', 'script'))` constraint in the full CREATE TABLE statement
    - Add migration logic: `UPDATE automation_rules SET rule_type = 'form' WHERE rule_type IS NULL`
    - _Requirements: 5.1, 5.2, 5.3, 6.1_

  - [x] 5.2 Create sandbox type definition bundle at `src/automations/sandbox-types.d.ts`
    - Declare `Device` interface matching core `Device` type
    - Declare `devices` global with `get`, `list`, `filter`, `action` methods — fully JSDoc-documented
    - Declare `mqtt` global with `publish` method
    - Declare `log` global with `info`, `warn`, `error` methods
    - Declare `context` global with `topic`, `deviceId`, `state`, `timestamp` fields
    - File will be served as plain text from `GET /api/automations/types`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 6. Execution history ring buffer
  - [x] 6.1 Create `ExecutionLog` class in `src/automations/execution-log.ts`
    - Define `ExecutionLogEntry` interface with `id`, `ruleId`, `ruleName`, `ruleType`, `triggerTopic`, `actions` array, `duration`, `timestamp`
    - Implement in-memory ring buffer capped at 200 entries
    - Implement `push(entry)`, `list(limit?)`, `getByRuleId(ruleId)` methods
    - _Requirements: 2.4_

- [x] 7. Update StoredRule interface and automation API routes
  - [x] 7.1 Extend `StoredRule` interface and update `src/api/routes/automation.routes.ts`
    - Add `rule_type`, `script_source`, `compiled_js` fields to `StoredRule` interface
    - Update `GET /api/automations` to return `ruleType` field and `scriptSource` for script rules
    - Update `POST /api/automations` to accept `ruleType: "script"` with `scriptSource` — transpile on save, store both source and compiled JS, register in Rule Registry
    - Add `PUT /api/automations/:id` — re-transpile script source on update, update DB and re-register rule
    - Update `DELETE /api/automations/:id` to handle script rules
    - Update `PATCH /api/automations/:id/toggle` to handle script rule enable/disable with compiled JS
    - Add `GET /api/automations/types` endpoint — serve `sandbox-types.d.ts` as `text/plain`
    - Add `GET /api/automations/history` endpoint — return execution log entries with optional `limit` query param
    - Wire form rule actions through ActionExecutor instead of just logging
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.3, 6.4, 9.1, 9.7_

  - [ ]* 7.2 Write integration tests for automation routes (`src/api/routes/automation.routes.test.ts`)
    - Test CRUD flow for script rules (create, read, update, delete)
    - Test transpilation error returns 400 with line numbers
    - Test toggle enable/disable for script rules
    - Test GET /api/automations returns both form and script rules with `ruleType` field
    - Test GET /api/automations/types returns type definitions as text/plain
    - Test backward compatibility — existing form rules still work
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.4_

- [x] 8. Wire Sandbox into AutomationEngine
  - [x] 8.1 Update `AutomationEngine` to dispatch script rules to Sandbox
    - Modify `evaluate()` in `src/automations/automation-engine.ts` to detect script rules (by checking `compiled_js` on the rule)
    - For script rules: create Sandbox instance, inject context, execute compiled JS
    - For form rules: build ActionDescriptor from stored action type/target/params, pass to ActionExecutor
    - Record execution in ExecutionLog with duration timing
    - Ensure file-based DSL rules continue to work unchanged
    - _Requirements: 2.1, 3.1, 6.2, 6.3_

- [x] 9. Update `src/index.ts` entry point
  - [x] 9.1 Wire new services into the application bootstrap
    - Instantiate `ActionExecutor` with `MqttService`, `ConnectorManager`, `Logger`
    - Instantiate `ExecutionLog`
    - Instantiate `Sandbox` with `ActionExecutor`, `DeviceRegistry`
    - Pass `ActionExecutor`, `Sandbox`, `ExecutionLog` to `AutomationEngine`
    - Update `createAutomationRoutes` call to pass new dependencies
    - Move `typescript` from devDependencies to dependencies in `package.json`
    - _Requirements: 1.1, 2.1, 3.1_

- [x] 10. Checkpoint — backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Monaco Script Editor component
  - [x] 11.1 Install frontend dependencies
    - Add `@monaco-editor/react` and `monaco-editor` to `frontend/package.json`
    - _Requirements: 7.1_

  - [x] 11.2 Create `ScriptEditor` component in `frontend/src/components/ScriptEditor.tsx`
    - Wrap `@monaco-editor/react` with Aeolus dark theme configuration
    - Define `aeolus-dark` Monaco theme: keywords `#3BA4FF`, strings `#5CE1E6`, comments `#6B7785`, functions `#E6EDF3`, types `#9AA6B2`, numbers `#F59E0B`, background `#0B0F14`, gutter `#121821`
    - Set JetBrains Mono as editor font (load via Google Fonts link in `index.html`)
    - Fetch type definitions from `GET /api/automations/types` on mount
    - Register types via `monaco.languages.typescript.typescriptDefaults.addExtraLib()`
    - Accept `onChange`, `onSave`, `initialValue`, `errors` props
    - Display inline error markers from backend transpilation errors at corresponding line numbers
    - Follow Aeolus design system: surface card wrapper, 12-16px border radius
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 9.7_

  - [ ]* 11.3 Write unit tests for ScriptEditor (`frontend/src/components/ScriptEditor.test.tsx`)
    - Test type definition loading on mount
    - Test error marker display from transpilation errors
    - Test onChange and onSave callbacks
    - _Requirements: 7.2, 7.7_

- [x] 12. Dual-mode Automations Page
  - [x] 12.1 Update `AutomationsPage` with mode toggle and script creation
    - Add segmented control toggle: "Quick Rule" (FormInput icon) / "Script" (Code icon) using Lucide icons
    - In "Script" mode: render `ScriptEditor` with name input and trigger topic input
    - Wire save to `POST /api/automations` with `ruleType: "script"` and `scriptSource`
    - Display transpilation errors from backend response inline in the editor
    - _Requirements: 8.1, 8.4, 8.6_

  - [x] 12.2 Update rule list with type badges and script editing
    - Add `ruleType` field to `AutomationRule` interface (values: `"file"`, `"form"`, `"script"`)
    - Show `<Code />` icon badge for script rules, `<FormInput />` icon badge for form rules
    - Clicking a script rule opens it in the ScriptEditor with source pre-loaded
    - Wire edit save to `PUT /api/automations/:id`
    - _Requirements: 8.3, 8.5_

  - [x] 12.3 Expand form-based rule creator with richer action types
    - Add `device_action`, `delay`, and `webhook` options to the action type dropdown
    - For `device_action`: show device selector + action type input + parameters field
    - For `delay`: show duration input in milliseconds
    - For `webhook`: show URL, HTTP method selector, and body fields
    - For `publish`: show target topic field and payload field
    - Update DSL preview to reflect new action types
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 8.2_

  - [ ]* 12.4 Write unit tests for AutomationsPage (`frontend/src/components/AutomationsPage.test.tsx`)
    - Test mode toggle between Quick Rule and Script
    - Test rule list displays type badges correctly
    - Test form action type dropdown shows all options
    - _Requirements: 8.1, 8.3, 10.1_

- [x] 13. Checkpoint — frontend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Integration wiring and documentation
  - [x] 14.1 End-to-end integration: form rule fires through ActionExecutor
    - Verify a form rule with `publish` action actually calls `MqttService.publish()`
    - Verify a form rule with `toggle` action calls `ConnectorManager.executeAction()`
    - Verify execution is recorded in ExecutionLog
    - _Requirements: 2.1, 6.3_

  - [x] 14.2 End-to-end integration: script rule fires through Sandbox
    - Verify a script rule with `devices.action()` call triggers ActionExecutor → ConnectorManager
    - Verify a script rule with `mqtt.publish()` call triggers ActionExecutor → MqttService
    - Verify execution is recorded in ExecutionLog
    - _Requirements: 2.2, 3.10_

  - [x] 14.3 Update `docs/COMPREHENSIVE_DOCUMENTATION.md`
    - Add Automation Overhaul section: Action Executor, Sandbox, Transpiler, Execution Log
    - Document new API endpoints: PUT /api/automations/:id, GET /api/automations/types, GET /api/automations/history
    - Update SQLite schema section with new columns
    - Update project structure tree with new files
    - Document Monaco editor component and dual-mode page in Dashboard Features
    - Add `isolated-vm`, `@monaco-editor/react`, `monaco-editor` to dependencies section
    - Note `typescript` moved to runtime dependencies
    - Update design decisions section with isolated-vm rationale and Monaco choice
    - _Requirements: all_

- [x] 15. Final checkpoint — all tests pass, feature complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at backend core, backend complete, frontend complete, and final stages
- Property tests validate the 11 correctness properties defined in the design using `@fast-check/vitest`
- Unit tests validate specific examples, edge cases, and error paths
- Backend foundations (tasks 1–3) must be complete before API routes (task 7) can wire them together
- Frontend tasks (11–12) depend on backend API endpoints being functional
- Documentation update (14.3) follows the `documentation-updates` steering rules
