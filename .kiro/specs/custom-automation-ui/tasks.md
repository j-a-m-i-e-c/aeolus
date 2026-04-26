# Implementation Plan: Custom Automation UI

## Overview

This plan implements the custom automation UI feature in a backend-first order: state store and persistence layer, sandbox wiring, API endpoints, WebSocket broadcast, file manager, then frontend components (editor, error boundary, AutomationPane changes, Zustand store), and finally integration tasks (rebuild system, snippets, cleanup). Each task builds incrementally on the previous ones so there is no orphaned code.

## Tasks

- [x] 1. Create AutomationStateStore with SQLite table and in-memory cache
  - [x] 1.1 Add `automation_state` table to `src/db/database.ts`
    - Add `CREATE TABLE IF NOT EXISTS automation_state (rule_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (rule_id, key));` to `initSchema()`
    - _Requirements: 17.1_
  - [x] 1.2 Implement `src/automations/automation-state-store.ts`
    - Create `AutomationStateStore` class with constructor accepting `Database`
    - Implement `loadFromDb()` to populate in-memory `Map<string, Map<string, unknown>>` cache from SQLite
    - Implement `get(ruleId, key)`, `getAll(ruleId)`, `set(ruleId, key, value)` with SQLite upsert + cache update, `delete(ruleId, key)`, and `deleteAll(ruleId)`
    - `set()` should JSON.stringify the value for SQLite storage and JSON.parse on read
    - Handle non-serializable values (circular refs, BigInt) by catching `JSON.stringify` errors and logging a warning
    - Call `persistDatabase()` after each write operation
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6, 15.8, 17.1, 17.5, 17.6_
  - [ ]* 1.3 Write property test for AutomationStateStore round-trip
    - **Property 7: Automation state round-trip through sandbox and API**
    - Generate random JSON-serializable values (strings, numbers, booleans, arrays, plain objects), call `set(ruleId, key, value)` then `get(ruleId, key)`, verify deep equality
    - **Validates: Requirements 15.2, 15.3, 15.6, 17.2, 17.3**
  - [ ]* 1.4 Write property test for state cleanup on rule deletion
    - **Property 8: State cleanup on rule deletion**
    - Generate random sets of key-value pairs for a rule, call `deleteAll(ruleId)`, verify `getAll(ruleId)` returns empty object and SQLite table has no rows for that rule
    - **Validates: Requirements 17.5**

- [x] 2. Wire state sandbox global into isolated-vm
  - [x] 2.1 Add state references to `src/automations/sandbox.ts`
    - Add `AutomationStateStore` to `SandboxDeps` interface
    - Add `ruleId` parameter to the `execute()` method signature (or extract from existing context)
    - Create `setStateRefs(jail, ruleId)` method that sets `__stateGetRef`, `__stateSetRef`, `__stateGetAllRef`, `__stateDeleteRef` as `ivm.Reference` callbacks
    - The `set` callback should accept `(key, jsonValue)`, parse the JSON, call `stateStore.set(ruleId, key, value)`, and trigger WebSocket broadcast via a callback
    - The `get` callback should call `stateStore.get(ruleId, key)` and return the value via `ExternalCopy`
    - The `getAll` callback should call `stateStore.getAll(ruleId)` and return via `ExternalCopy`
    - The `delete` callback should call `stateStore.delete(ruleId, key)`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 2.2 Update bootstrap script in `sandbox.ts`
    - Add `globalThis.state = { get, set, getAll, delete }` wiring using the `__state*Ref` temporaries
    - Clean up the temporary globals in the bootstrap cleanup section
    - _Requirements: 15.1_
  - [x] 2.3 Update `src/automations/sandbox-types.d.ts`
    - Add `declare const state` with JSDoc for `get(key)`, `set(key, value)`, `getAll()`, `delete(key)` methods
    - _Requirements: 15.9_
  - [x] 2.4 Instantiate AutomationStateStore in `src/index.ts` and pass to Sandbox
    - Create `const stateStore = new AutomationStateStore(db); stateStore.loadFromDb();`
    - Pass `stateStore` to the `Sandbox` constructor via `SandboxDeps`
    - _Requirements: 17.6_

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 4. Add state API endpoints and WebSocket broadcast
  - [~] 4.1 Add state routes to `src/api/routes/automation.routes.ts`
    - Accept `AutomationStateStore` as a parameter in `createAutomationRoutes()`
    - `GET /api/automations/:id/state` — return `stateStore.getAll(id)` as JSON object
    - `PUT /api/automations/:id/state` — accept `{ key, value }`, call `stateStore.set()`, broadcast via WebSocket, return success
    - `DELETE /api/automations/:id/state/:key` — call `stateStore.delete()`, return success
    - _Requirements: 17.2, 17.3, 17.4_
  - [~] 4.2 Add WebSocket broadcast method to `src/websocket/ws-server.ts`
    - Add a new event constant `AUTOMATION_STATE_CHANGE` to `src/core/event-bus.ts`
    - Listen for `AUTOMATION_STATE_CHANGE` in `WsServer` constructor and broadcast `{ type: "automation-state", data: { ruleId, key, value } }`
    - _Requirements: 15.7_
  - [~] 4.3 Wire state broadcast into the sandbox set callback and API PUT handler
    - In the sandbox `set` callback (from task 2.1), emit `AUTOMATION_STATE_CHANGE` on the event bus after persisting
    - In the `PUT /api/automations/:id/state` handler, also emit `AUTOMATION_STATE_CHANGE`
    - Pass `eventBus` to `createAutomationRoutes()` if not already available
    - _Requirements: 15.7, 16.5_
  - [~] 4.4 Add state cleanup to DELETE /api/automations/:id handler
    - When a rule is deleted, call `stateStore.deleteAll(id)` before removing the DB row
    - _Requirements: 17.5_

- [ ] 5. Implement CustomUiManager for file writes and registry generation
  - [~] 5.1 Create `src/automations/custom-ui-manager.ts`
    - Constructor takes `projectDir` string (from `AEOLUS_PROJECT_DIR`)
    - `isAvailable()` — check if `projectDir` exists and the `frontend/src/components/panes/custom/` subdirectory is writable
    - `writeComponent(ruleId, uiSource)` — write to `${projectDir}/frontend/src/components/panes/custom/automation-${ruleId}.tsx`, then call `regenerateRegistry()`
    - `deleteComponent(ruleId)` — delete the file (catch ENOENT silently), then call `regenerateRegistry()`
    - `regenerateRegistry()` — scan `custom/` directory for `automation-*.tsx` files, generate `index.ts` with static imports and `CUSTOM_COMPONENTS` map, include the auto-generated header comment
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 12.1, 12.2, 12.3_
  - [ ]* 5.2 Write property test for registry generation
    - **Property 2: Registry generation matches component files on disk**
    - Generate random sets of rule IDs and source strings, write components, verify registry content has exactly one import and one map entry per rule ID
    - **Validates: Requirements 4.2, 4.3, 5.2, 5.4**
  - [ ]* 5.3 Write property test for cleanup
    - **Property 3: Cleanup removes files and registry entries**
    - Generate random subsets to delete from a set of written components, verify file removal and registry update
    - **Validates: Requirements 4.4, 10.4, 12.1, 12.2**
  - [ ]* 5.4 Write property test for empty uiSource
    - **Property 4: Empty uiSource does not create files**
    - Generate whitespace-only strings, verify no files are created; if a file previously existed, verify it is deleted
    - **Validates: Requirements 10.5**

- [ ] 6. Modify automation API to handle uiSource and file writes
  - [~] 6.1 Update POST /api/automations to accept `uiSource`
    - Accept optional `uiSource` field in request body
    - Store in `ui_source` column on INSERT
    - If `uiSource` is non-empty, call `customUiManager.writeComponent(id, uiSource)` (skip if manager not available)
    - If `uiSource` is empty/whitespace, skip file write
    - _Requirements: 10.1, 10.5, 4.1, 4.2_
  - [~] 6.2 Update PUT /api/automations/:id to accept `uiSource`
    - Accept optional `uiSource` field in request body
    - Update `ui_source` column
    - If `uiSource` is non-empty, call `customUiManager.writeComponent(id, uiSource)`
    - If `uiSource` is empty/cleared, call `customUiManager.deleteComponent(id)` and set `ui_source` to NULL
    - _Requirements: 10.2, 4.1, 4.4_
  - [~] 6.3 Update GET /api/automations to return `uiSource`
    - Include `uiSource` field in the response for each rule that has a non-null `ui_source` column
    - _Requirements: 10.3_
  - [~] 6.4 Update DELETE /api/automations/:id to clean up files
    - If the deleted rule has a non-empty `ui_source`, call `customUiManager.deleteComponent(id)`
    - _Requirements: 10.4, 12.1, 12.2, 12.3_
  - [~] 6.5 Instantiate CustomUiManager in `src/index.ts` and pass to routes
    - Create `const customUiManager = new CustomUiManager(process.env.AEOLUS_PROJECT_DIR || "/aeolus-host")`
    - Pass to `createAutomationRoutes()`
    - _Requirements: 4.5_
  - [ ]* 6.6 Write property test for UI source round-trip
    - **Property 1: UI source round-trip through API**
    - Generate random non-empty TSX strings, create/update via API (mock DB), retrieve via GET, verify exact match
    - **Validates: Requirements 4.1, 10.1, 10.2, 10.3, 14.2**

- [ ] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Add rebuild frontend endpoint and status tracker
  - [~] 8.1 Add rebuild status state machine to `src/api/routes/system.routes.ts`
    - Add module-level `rebuildStatus: "idle" | "rebuilding" | "ready"` state
    - Add `pollInterval` and `readyTimeout` timer references
    - Implement `startRebuildTracking()` — poll `http://localhost:3000` every 2s; when response succeeds after being down, transition to `ready`; set 30s auto-reset timeout back to `idle`
    - Implement `stopRebuildTracking()` — clear intervals and timeouts
    - _Requirements: 13.1, 13.3, 13.4, 13.5_
  - [~] 8.2 Add `POST /api/system/rebuild-frontend` endpoint
    - Check `AEOLUS_PROJECT_DIR` exists, return 400 if not
    - Spawn `docker compose up -d --build frontend` in background (detached, stdio ignore)
    - Set `rebuildStatus = "rebuilding"` and call `startRebuildTracking()`
    - Return `{ success: true, message: "Frontend rebuild started" }`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [~] 8.3 Add `GET /api/system/rebuild-status` endpoint
    - Return `{ status: rebuildStatus }`
    - _Requirements: 13.2_
  - [ ]* 8.4 Write property test for rebuild status state machine
    - **Property 5: Rebuild status state machine transitions**
    - Generate random sequences of health check results, drive the state machine, verify correct transitions (idle→rebuilding→ready→idle)
    - **Validates: Requirements 13.1, 13.3, 13.4, 13.5**

- [ ] 9. Add UI types endpoint
  - [~] 9.1 Add `GET /api/automations/ui-types` endpoint
    - Create a `ui-types.d.ts` file in `src/automations/` with `CustomComponentProps`, `ExecutionEntry`, React.FC, useState, useEffect, useCallback type declarations
    - Serve it as `text/plain` from the new endpoint, similar to the existing `/api/automations/types` endpoint
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 10. Create custom component types file and empty registry scaffold
  - [~] 10.1 Create `frontend/src/components/panes/custom/types.ts`
    - Define `ExecutionEntry` and `CustomComponentProps` interfaces as specified in the design
    - Include `state: Map<string, unknown>` and `stateSet: (key: string, value: unknown) => void` fields
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_
  - [~] 10.2 Create `frontend/src/components/panes/custom/index.ts`
    - Create the empty registry scaffold with auto-generated header comment
    - Export `CUSTOM_COMPONENTS: Record<string, ComponentType<CustomComponentProps>> = {}`
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [ ] 11. Implement UiEditor component
  - [~] 11.1 Create `frontend/src/components/UiEditor.tsx`
    - Wrap Monaco editor with language `typescriptreact`
    - Reuse `aeolus-dark` theme definition from ScriptEditor (extract to shared util or duplicate)
    - Load type definitions from `GET /api/automations/ui-types` and register with Monaco TS language service
    - Support `initialValue`, `onChange`, `onSave` (Ctrl+S / Cmd+S), `onEditorReady` props
    - Use same Monaco options as ScriptEditor: JetBrains Mono 13px, no minimap, word wrap, bracket pair colorization, automatic layout
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 12. Implement CustomComponentBoundary error boundary
  - [~] 12.1 Create `frontend/src/components/CustomComponentBoundary.tsx`
    - React class component implementing `componentDidCatch` and `getDerivedStateFromError`
    - State: `{ hasError: boolean, error: Error | null }`
    - Props: `{ children: React.ReactNode, onFallback: () => void }`
    - Error state renders error message text and a "Show Default View" button that calls `onFallback`
    - Use Aeolus design system colors (red for error, standard text colors)
    - _Requirements: 6.4, 6.5_

- [ ] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Create frontend automation state store
  - [~] 14.1 Create `frontend/src/store/automation-state-store.ts`
    - Zustand store with `stateByRule: Map<string, Map<string, unknown>>`
    - Actions: `setRuleState(ruleId, key, value)` — merge into existing map, `initRuleState(ruleId, state)` — set full state from API, `clearRuleState(ruleId)`
    - _Requirements: 16.1, 16.6_
  - [~] 14.2 Add WebSocket listener for `automation-state` messages
    - In the existing WebSocket connection setup (or a new hook), listen for `type: "automation-state"` messages
    - On receive, call `setRuleState(data.ruleId, data.key, data.value)` on the Zustand store
    - _Requirements: 16.3_
  - [~] 14.3 Add `stateSet` helper that calls `PUT /api/automations/:id/state`
    - Create a function `sendStateUpdate(ruleId, key, value)` that POSTs to the API
    - This will be passed as `props.stateSet` to custom components
    - _Requirements: 16.2, 16.5_

- [ ] 15. Update AutomationPane with UI tab, custom component rendering, and rebuild status
  - [~] 15.1 Add UI tab to both setup and editing modes
    - Show tab bar with "Logic" and "UI" tabs in both setup mode and editing mode (currently only editing mode has tabs)
    - Remove the "Experimental" badge and placeholder text from the UI tab
    - Track `uiSource` state alongside `scriptSource`, preserve both independently when switching tabs
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 14.1_
  - [~] 15.2 Render UiEditor in UI tab
    - When UI tab is selected, render `UiEditor` component instead of ScriptEditor
    - Pass `uiSource` as `initialValue`, wire `onChange` to `setUiSource`, wire `onSave`
    - Show snippet panel in UI tab (same toggle mechanism as Logic tab)
    - _Requirements: 1.2, 2.1, 9.5_
  - [~] 15.3 Add default UI template
    - When `uiSource` is empty, populate with a default template that exports a React.FC using `CustomComponentProps`
    - Template demonstrates `devices`, `ruleName`, `lastFired` props usage
    - Uses Tailwind classes with Aeolus design system colors (#121821, #E6EDF3, #3BA4FF)
    - Includes comments explaining available props
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 14.3_
  - [~] 15.4 Include `uiSource` in save/update API calls
    - Modify `handleSave` (setup mode) to include `uiSource` in the POST body
    - Modify `handleUpdate` (editing mode) to include `uiSource` in the PUT body
    - On entering editing mode, populate `uiSource` from the fetched rule data
    - _Requirements: 10.1, 10.2, 14.2_
  - [~] 15.5 Render custom component in status mode
    - Import `CUSTOM_COMPONENTS` from `./custom/index`
    - In status mode, if rule has `uiSource` and `CUSTOM_COMPONENTS[ruleId]` exists, render the custom component wrapped in `CustomComponentBoundary`
    - Pass all `CustomComponentProps`: devices from store, ruleId, ruleName, lastFired, enabled, deviceAction, mqttPublish, executionHistory, state from automation-state-store, stateSet helper
    - If `uiSource` exists but no compiled component in registry, show banner "Custom UI saved — rebuild frontend to activate"
    - Error boundary `onFallback` switches to default FlowDiagram/ActivityFeed view
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 3.1–3.10, 16.1, 16.2, 16.4_
  - [~] 15.6 Fetch initial state snapshot in status mode
    - When entering status mode for a rule, fetch `GET /api/automations/:id/state` and call `initRuleState()` on the Zustand store
    - _Requirements: 16.4_
  - [~] 15.7 Add "Rebuild Frontend" button and status indicator
    - Add "Rebuild Frontend" button in the UI tab action bar
    - On click, call `POST /api/system/rebuild-frontend`, disable button during rebuild
    - Poll `GET /api/system/rebuild-status` every 3s while rebuilding
    - Show spinning animation during `rebuilding`, green check + "Rebuild complete — refresh to activate" + "Refresh Now" button when `ready`
    - Show warning if `rebuilding` persists > 120s
    - _Requirements: 7.5, 7.6, 7.7, 13.6, 13.7, 13.8_
  - [ ]* 15.8 Write property test for tab switch content preservation
    - **Property 6: Tab switch preserves editor content**
    - Generate random string pairs (scriptSource, uiSource), simulate tab switches, verify both strings preserved
    - **Validates: Requirements 1.4**

- [ ] 16. Add UI component snippets to snippet catalog
  - [~] 16.1 Add "UI Components" category to `src/automations/snippet-catalog.ts`
    - Add a new `SnippetGroup` with category "UI Components", icon "layout"
    - Include snippet: device status card (displays device name, type, state)
    - Include snippet: toggle button (calls `props.deviceAction` to toggle)
    - Include snippet: execution history list (renders `props.executionHistory` with timestamps)
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 17. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation order is: backend state store → sandbox wiring → API + WebSocket → file manager → API changes → rebuild system → frontend components → integration
- The `AEOLUS_PROJECT_DIR` environment variable is already configured in `docker-compose.yml` as `/aeolus-host` with the project root bind-mounted
