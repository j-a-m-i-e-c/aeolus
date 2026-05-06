# Implementation Plan: Custom Panels

## Overview

This plan implements Custom Panels as a new first-class entity in Aeolus, following the same architectural patterns as the automation system (state store, CRUD API, WebSocket broadcasting, pane registration) while keeping the two systems fully independent. Tasks are ordered to build backend foundations first, then frontend integration, ensuring each step produces testable, wired-up code.

## Tasks

- [x] 1. Create backend data layer and state store
  - [x] 1.1 Add `custom_panels` and `panel_state` tables to database schema
    - Add DDL statements to `initSchema` in `src/db/database.ts`
    - Create `custom_panels` table: id (TEXT PK), name (TEXT NOT NULL), ui_source (TEXT DEFAULT NULL), compiled_ui (TEXT DEFAULT NULL), created_at (INTEGER NOT NULL), updated_at (INTEGER NOT NULL)
    - Create `panel_state` table: panel_id (TEXT NOT NULL), key (TEXT NOT NULL), value (TEXT NOT NULL), PRIMARY KEY (panel_id, key)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Create `PanelStateStore` class in `src/panels/panel-state-store.ts`
    - Implement in-memory cache backed by SQLite persistence (mirror `AutomationStateStore` pattern)
    - Methods: `loadFromDb()`, `get(panelId, key)`, `getAll(panelId)`, `set(panelId, key, value)`, `delete(panelId, key)`, `deleteAll(panelId)`
    - _Requirements: 1.3, 1.4, 3.1, 3.2_

  - [ ]* 1.3 Write property tests for PanelStateStore
    - **Property 4: Panel state round-trip**
    - **Validates: Requirements 3.1, 3.2, 6.3**
    - Generate random key-value pairs, write via `set()`, read via `getAll()`, verify equality
    - **Property 3: Panel deletion cascades to state**
    - **Validates: Requirements 1.4, 2.6**
    - Generate panels with random state entries, call `deleteAll()`, verify zero entries remain
    - Test file: `src/panels/panel-state-store.test.ts`

- [x] 2. Create panel type definitions and event bus extension
  - [x] 2.1 Create `CustomPanelProps` type definition in `src/panels/panel-types.d.ts`
    - Define `Device` interface and `CustomPanelProps` interface
    - Include: devices, panelId, panelName, deviceAction, mqttPublish, state, stateSet
    - Exclude: ruleId, ruleName, lastFired, enabled, executionHistory
    - _Requirements: 6.1, 6.2_

  - [x] 2.2 Add `PANEL_STATE_CHANGE` event to `src/core/event-bus.ts`
    - Export `PANEL_STATE_CHANGE = "panel:state-change"` constant
    - _Requirements: 11.1, 11.3_

- [x] 3. Implement panel CRUD API routes
  - [x] 3.1 Create `src/api/routes/panel.routes.ts` with all endpoints
    - `GET /api/panels` — list all panels
    - `POST /api/panels` — create panel with default template, return created object
    - `GET /api/panels/:id` — get single panel (404 if not found)
    - `PUT /api/panels/:id` — update name/uiSource, transpile via `transpileUi`, store compiled output
    - `DELETE /api/panels/:id` — delete panel + cascade state via `PanelStateStore.deleteAll()`
    - `GET /api/panels/:id/state` — return all state as JSON object
    - `PUT /api/panels/:id/state` — persist key-value, emit `PANEL_STATE_CHANGE` event
    - `GET /api/panels/:id/ui-module` — serve compiled_ui as `application/javascript`
    - Handle error cases: 400 for missing fields, 404 for non-existent panels, transpilation errors returned without updating compiled_ui
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 12.1, 12.2_

  - [ ]* 3.2 Write property tests for panel CRUD API
    - **Property 1: Panel CRUD round-trip**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Generate random name strings, create panels, verify round-trip via GET
    - **Property 2: Panel update persists source and compiled output**
    - **Validates: Requirements 2.5, 4.3**
    - Generate valid TSX templates, update panels, verify source + compiled stored
    - **Property 7: Default template transpiles without errors**
    - **Validates: Requirements 12.3**
    - Transpile the default template, verify success result
    - Test file: `src/api/routes/panel.routes.test.ts`

  - [ ]* 3.3 Write unit tests for panel API error handling
    - Test 404 responses for non-existent panel IDs
    - Test 400 response for missing `name` on POST
    - Test 400 response for missing `key`/`value` on state PUT
    - Test transpilation failure preserves existing compiled_ui
    - Test file: `src/api/routes/panel.routes.test.ts`

- [x] 4. Wire backend into application entry point
  - [x] 4.1 Register panel routes and state store in `src/index.ts`
    - Instantiate `PanelStateStore` and call `loadFromDb()`
    - Mount panel routes via `createPanelRoutes(db, panelStateStore, eventBus)`
    - Add `{ eventName: PANEL_STATE_CHANGE, messageType: "panel-state" }` to WS_MAPPINGS
    - _Requirements: 11.1, 11.3_

- [x] 5. Checkpoint - Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create frontend panel state store
  - [x] 6.1 Create Zustand store in `frontend/src/store/panel-state-store.ts`
    - Implement `stateByPanel` map with `setPanelState`, `initPanelState`, `clearPanelState` actions
    - Mirror pattern from `automation-state-store.ts`
    - _Requirements: 11.2_

  - [ ]* 6.2 Write property test for frontend panel state store
    - **Property 6: Frontend store merges panel state updates**
    - **Validates: Requirements 11.2**
    - Generate sequences of state update messages, apply to store, verify final state has latest value per key
    - Test file: `frontend/src/store/panel-state-store.test.ts`

- [x] 7. Adapt `useDynamicComponent` hook and add WebSocket handler
  - [x] 7.1 Parameterize `useDynamicComponent` to accept a `moduleUrl` argument
    - Add optional `moduleUrl` parameter (defaults to automation URL for backward compatibility)
    - For panels: use `/api/panels/${panelId}/ui-module`
    - File: `frontend/src/hooks/useDynamicComponent.ts`
    - _Requirements: 5.2_

  - [x] 7.2 Add `panel-state` message handler to WebSocket client
    - Handle incoming `panel-state` messages by calling `usePanelStateStore.getState().setPanelState()`
    - File: `frontend/src/lib/ws-client.ts`
    - _Requirements: 11.2, 11.3_

- [x] 8. Create CustomPanelPane component
  - [x] 8.1 Create `frontend/src/components/panes/CustomPanelPane.tsx`
    - Implement two modes: editing (Monaco editor with save/cancel) and display (rendered component)
    - In display mode: use `useDynamicComponent` with panel module URL, pass `CustomPanelProps` (devices, panelId, panelName, deviceAction, mqttPublish, state, stateSet)
    - In editing mode: reuse editor patterns from `UiEditor`/`ScriptEditor`, show transpilation errors inline
    - Show placeholder when no compiled UI exists
    - Display panel name in pane header during display mode
    - Wrap rendered component in `CustomComponentBoundary` error boundary
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 6.3, 6.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.3_

  - [ ]* 8.2 Write unit tests for CustomPanelPane
    - Test that correct props are passed (no automation-specific props)
    - Test placeholder shown when no compiled UI
    - Test editor preserves source on transpilation failure
    - Test file: `frontend/src/components/panes/CustomPanelPane.test.tsx`

- [x] 9. Register pane type and update PanePicker
  - [x] 9.1 Add `custom-panel` entry to pane registry
    - Register in `frontend/src/lib/pane-registry.ts` with displayName "Custom Panel", defaultIcon "layout-dashboard", defaultSize { w: 6, h: 8 }, category "controls"
    - _Requirements: 5.1_

  - [x] 9.2 Exclude `custom-panel` from PanePicker and rename header
    - Add `custom-panel` to `EXCLUDED_FROM_PICKER` set in `frontend/src/components/PanePicker.tsx`
    - Rename PanePicker header/title to "Browse Panes"
    - _Requirements: 10.1, 10.2_

- [x] 10. Update TabLayout with "New Pane" button and rename "Add Pane"
  - [x] 10.1 Add "New Pane" button and rename "Add Pane" to "Browse Panes" in `frontend/src/components/TabLayout.tsx`
    - Add "New Pane" button with gradient primary style (matching "New Automation")
    - On click: POST to `/api/panels` to create panel, then add `custom-panel` pane in editing mode
    - Rename existing "Add Pane" button to "Browse Panes" with secondary outline style
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 10.2 Implement panel deletion on pane removal
    - When a `custom-panel` pane is removed from the dashboard, call DELETE `/api/panels/:id`
    - _Requirements: 9.1_

- [x] 11. Checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Transpilation property test
  - [ ]* 12.1 Write property test for transpilation round-trip
    - **Property 5: Transpilation round-trip**
    - **Validates: Requirements 4.4**
    - Generate valid TSX component sources that export a default function accepting `CustomPanelProps`, transpile, verify output is loadable
    - Test file: `src/api/routes/panel.routes.test.ts`

- [x] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The backend is built first (tasks 1–5) so the frontend can integrate against real endpoints
- The `useDynamicComponent` hook is parameterized rather than duplicated, maintaining backward compatibility
