# Requirements Document

## Introduction

Activate the "UI" tab in the AutomationPane so users can write custom React/TSX components that serve as the visual interface for their automations. The custom component renders in the pane's status mode, replacing or augmenting the default FlowDiagram/ActivityFeed. The approach uses build-time compilation (Approach A): user-authored TSX is saved to disk, an auto-generated registry imports all custom components, and a "Rebuild Frontend" action triggers `docker compose up -d --build frontend` to compile the code through the normal Vite/React pipeline. This avoids runtime eval and keeps the security model identical to the rest of the codebase.

## Glossary

- **Automation_Pane**: The existing dashboard pane type (`automation`) that encapsulates the full lifecycle of a single automation rule — creation, editing, status display, and deletion.
- **UI_Tab**: The second tab in the Automation_Pane editing view (alongside the "Logic" tab) where users write custom React/TSX component source code.
- **UI_Source**: The user-authored TSX string stored in the `ui_source` column of the `automation_rules` database table and persisted as a `.tsx` file on disk for build-time compilation.
- **Custom_Component_File**: A TSX file written to `frontend/src/components/panes/custom/automation-{ruleId}.tsx` containing the user's custom React component.
- **Custom_Component_Registry**: An auto-generated TypeScript file at `frontend/src/components/panes/custom/index.ts` that re-exports all Custom_Component_Files as a lookup map keyed by rule ID.
- **UI_Editor**: A Monaco editor instance in the UI_Tab configured for TSX/React editing with Aeolus type definitions, the Aeolus dark theme, and IntelliSense for the custom component props interface.
- **Custom_Component_Props**: The props interface provided to every custom component, giving access to live device state, automation execution history, MQTT publish, device actions, and the rule's metadata.
- **Rebuild_Frontend**: The action that triggers `docker compose up -d --build frontend` on the host, recompiling the Vite frontend with any new or updated Custom_Component_Files.
- **Rebuild_Status**: The backend-tracked state of a frontend rebuild: `idle` (no rebuild), `rebuilding` (build in progress, frontend container not yet responding), or `ready` (new frontend container healthy and serving). Exposed via `GET /api/system/rebuild-status` and polled by the frontend for live status indication.
- **Snippet_Catalog**: The existing module (`src/automations/snippet-catalog.ts`) that aggregates platform and connector code snippets for the automation script editor.
- **Script_Editor**: The existing Monaco-based TypeScript editor component (`frontend/src/components/ScriptEditor.tsx`) with the Aeolus dark theme and IntelliSense.
- **Pane_Registry**: The frontend module (`frontend/src/lib/pane-registry.ts`) that maps pane type identifiers to React components and metadata.
- **Automation_API**: The Express REST API at `/api/automations` providing CRUD operations for automation rules.
- **System_API**: The Express REST API at `/api/system` providing host diagnostics and the self-update endpoint.
- **Automation_State_Store**: A per-rule key-value store that enables bidirectional communication between the backend automation script (Logic tab) and the frontend custom component (UI tab). The script writes state via a `state` sandbox global; the frontend receives live updates via WebSocket and exposes them as `props.state`. Persisted to SQLite for restart survival.

## Requirements

### Requirement 1: UI Tab in Editing View

**User Story:** As a user, I want a "UI" tab alongside the "Logic" tab when editing an automation, so that I can write a custom React component for the automation's visual interface.

#### Acceptance Criteria

1. WHEN the Automation_Pane is in editing mode, THE Automation_Pane SHALL display a tab bar with "Logic" and "UI" tabs.
2. WHEN the user selects the "UI" tab, THE Automation_Pane SHALL display the UI_Editor instead of the Script_Editor.
3. THE UI_Tab SHALL remove the "Experimental" badge and label that currently marks the tab as a placeholder.
4. WHEN the user switches between the "Logic" and "UI" tabs, THE Automation_Pane SHALL preserve unsaved changes in both editors independently.
5. THE UI_Tab SHALL also be visible in Setup_Mode (new automation creation), allowing users to write a custom component from the start.

### Requirement 2: UI Editor with TSX Support

**User Story:** As a user, I want a Monaco editor configured for TSX/React when I open the UI tab, so that I get syntax highlighting and IntelliSense while writing my custom component.

#### Acceptance Criteria

1. THE UI_Editor SHALL use the Monaco editor with language set to `typescriptreact` (TSX).
2. THE UI_Editor SHALL apply the existing Aeolus dark theme (`aeolus-dark`) defined in the Script_Editor module.
3. THE UI_Editor SHALL load type definitions for the Custom_Component_Props interface so that IntelliSense provides autocompletion for `props.devices`, `props.ruleId`, and other available fields.
4. THE UI_Editor SHALL support Ctrl+S (Cmd+S on macOS) to trigger the save action, consistent with the Logic tab behaviour.
5. THE UI_Editor SHALL use the same Monaco options as the Script_Editor: JetBrains Mono font at 13px, no minimap, word wrap enabled, bracket pair colourisation enabled, and automatic layout.

### Requirement 3: Custom Component Props Interface

**User Story:** As a user, I want my custom component to receive live device state, execution history, and action helpers as props, so that I can build interactive dashboards for my automations.

#### Acceptance Criteria

1. THE Custom_Component_Props interface SHALL include a `devices` field providing the full device list from the Zustand device store as an array of Device objects.
2. THE Custom_Component_Props interface SHALL include a `ruleId` field containing the automation rule's unique identifier.
3. THE Custom_Component_Props interface SHALL include a `ruleName` field containing the automation rule's display name.
4. THE Custom_Component_Props interface SHALL include a `lastFired` field containing the Unix timestamp of the most recent execution, or `null` if the automation has not fired.
5. THE Custom_Component_Props interface SHALL include an `enabled` field indicating whether the automation rule is currently enabled.
6. THE Custom_Component_Props interface SHALL include a `deviceAction` function with signature `(deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>` for triggering device actions from the component.
7. THE Custom_Component_Props interface SHALL include a `mqttPublish` function with signature `(topic: string, payload: string) => void` for publishing MQTT messages from the component.
8. THE Custom_Component_Props interface SHALL include an `executionHistory` field containing the most recent 10 execution log entries for this rule.
9. THE Custom_Component_Props interface SHALL include a `state` field of type `Map<string, unknown>` containing the live key-value pairs from the Automation_State_Store for this rule, as specified in Requirement 16.
10. THE Custom_Component_Props interface SHALL include a `stateSet` function with signature `(key: string, value: unknown) => void` for writing state back to the Automation_State_Store from the UI component, as specified in Requirement 16.

### Requirement 4: Save UI Source to Database and Disk

**User Story:** As a user, I want my custom UI code to be saved both to the database and as a file on disk, so that the code persists across restarts and is available for the Vite build pipeline.

#### Acceptance Criteria

1. WHEN the user saves an automation that has UI_Source content, THE Automation_API SHALL store the UI_Source string in the `ui_source` column of the automation rule's database row.
2. WHEN the Automation_API stores UI_Source, THE Automation_API SHALL write the UI_Source content to the Custom_Component_File at `frontend/src/components/panes/custom/automation-{ruleId}.tsx` on the host filesystem.
3. WHEN the Automation_API writes a Custom_Component_File, THE Automation_API SHALL regenerate the Custom_Component_Registry file that imports and re-exports all existing Custom_Component_Files as a `Record<string, ComponentType<CustomComponentProps>>` keyed by rule ID.
4. IF the UI_Source is empty or cleared by the user, THEN THE Automation_API SHALL delete the corresponding Custom_Component_File and regenerate the Custom_Component_Registry without that entry.
5. WHEN the Automation_API writes files to the frontend directory, THE Automation_API SHALL use the `AEOLUS_PROJECT_DIR` environment variable to resolve the host filesystem path, consistent with the existing self-update mechanism.

### Requirement 5: Custom Component Registry Generation

**User Story:** As a developer, I want an auto-generated registry file that imports all custom components, so that the Vite build can statically resolve all custom UI modules without dynamic imports.

#### Acceptance Criteria

1. THE Custom_Component_Registry file SHALL be located at `frontend/src/components/panes/custom/index.ts`.
2. THE Custom_Component_Registry SHALL export a `CUSTOM_COMPONENTS` constant of type `Record<string, ComponentType<CustomComponentProps>>`.
3. WHEN no Custom_Component_Files exist, THE Custom_Component_Registry SHALL export an empty object: `export const CUSTOM_COMPONENTS: Record<string, ComponentType<CustomComponentProps>> = {};`.
4. FOR EACH Custom_Component_File on disk, THE Custom_Component_Registry SHALL contain a static import statement and a corresponding entry in the `CUSTOM_COMPONENTS` map.
5. THE Custom_Component_Registry SHALL include a generated-file header comment warning users not to edit the file manually.

### Requirement 6: Render Custom Component in Status Mode

**User Story:** As a user, I want my custom React component to render in the automation pane's status mode after a frontend rebuild, so that I see my custom dashboard widget instead of the default flow diagram or activity feed.

#### Acceptance Criteria

1. WHEN the Automation_Pane is in Status_Mode and the rule has a non-empty `ui_source` field, THE Automation_Pane SHALL check the Custom_Component_Registry for a component matching the rule ID.
2. WHEN a matching custom component exists in the Custom_Component_Registry, THE Automation_Pane SHALL render the custom component and pass the Custom_Component_Props.
3. WHEN a matching custom component does NOT exist in the Custom_Component_Registry (rebuild not yet performed), THE Automation_Pane SHALL display the default visual (FlowDiagram or ActivityFeed) with a banner indicating "Custom UI saved — rebuild frontend to activate".
4. THE custom component SHALL be wrapped in a React error boundary so that rendering errors in user code do not crash the rest of the dashboard.
5. WHEN the error boundary catches an error, THE Automation_Pane SHALL display the error message and a "Show Default View" button that falls back to the FlowDiagram or ActivityFeed.

### Requirement 7: Rebuild Frontend Action

**User Story:** As a user, I want a "Rebuild Frontend" button so that I can compile my custom UI components into the running frontend after saving changes.

#### Acceptance Criteria

1. THE System_API SHALL expose a `POST /api/system/rebuild-frontend` endpoint that triggers `docker compose up -d --build frontend` on the host.
2. THE `POST /api/system/rebuild-frontend` endpoint SHALL use the `AEOLUS_PROJECT_DIR` environment variable to resolve the project directory, consistent with the existing `POST /api/system/update` endpoint.
3. WHEN the rebuild is triggered, THE System_API SHALL return an immediate response with `{ success: true, message: "Frontend rebuild started" }` and run the build process in the background.
4. IF the `AEOLUS_PROJECT_DIR` is not mounted or does not exist, THEN THE System_API SHALL return a 400 response with an error message indicating the rebuild is only available on deployed systems.
5. THE Automation_Pane SHALL display a "Rebuild Frontend" button in the UI_Tab action bar when the user has unsaved or recently saved UI_Source changes.
6. WHEN the user clicks "Rebuild Frontend", THE Automation_Pane SHALL call `POST /api/system/rebuild-frontend` and display a live rebuild status indicator as specified in Requirement 13.
7. WHILE a rebuild is in progress, THE "Rebuild Frontend" button SHALL be disabled to prevent concurrent rebuilds.

### Requirement 8: Default UI Component Template

**User Story:** As a user, I want a sensible starter template when I open the UI tab for the first time, so that I can see the expected component structure and available props without reading documentation.

#### Acceptance Criteria

1. WHEN the UI_Editor is opened for a rule with no existing UI_Source, THE UI_Editor SHALL display a default template that exports a valid React functional component.
2. THE default template SHALL demonstrate usage of at least three Custom_Component_Props fields: `devices`, `ruleName`, and `lastFired`.
3. THE default template SHALL use Tailwind CSS classes consistent with the Aeolus design system colours (background `#121821`, text `#E6EDF3`, accent `#3BA4FF`).
4. THE default template SHALL include comments explaining the available props and how to access device state.

### Requirement 9: UI Component Snippets

**User Story:** As a user, I want code snippets for common UI patterns available in the snippet panel, so that I can quickly build custom components using proven patterns.

#### Acceptance Criteria

1. THE Snippet_Catalog SHALL include a "UI Components" category with snippets for custom automation UI components.
2. THE "UI Components" category SHALL include a snippet for a device status card that displays a single device's name, type, and current state.
3. THE "UI Components" category SHALL include a snippet for a toggle button that calls `props.deviceAction` to toggle a device on or off.
4. THE "UI Components" category SHALL include a snippet for an execution history list that renders `props.executionHistory` entries with timestamps and status indicators.
5. THE snippet panel SHALL be available in the UI_Tab, using the same toggle mechanism as the Logic tab.

### Requirement 10: UI Source in Automation API

**User Story:** As a user, I want the automation API to accept and return UI source code alongside the logic script, so that both are persisted and available when I edit the automation.

#### Acceptance Criteria

1. THE `POST /api/automations` endpoint SHALL accept an optional `uiSource` field in the request body.
2. THE `PUT /api/automations/:id` endpoint SHALL accept an optional `uiSource` field in the request body.
3. THE `GET /api/automations` response SHALL include the `uiSource` field for each rule that has custom UI source code.
4. WHEN a rule is deleted via `DELETE /api/automations/:id`, THE Automation_API SHALL delete the corresponding Custom_Component_File and regenerate the Custom_Component_Registry.
5. WHEN the Automation_API receives a `uiSource` field, THE Automation_API SHALL validate that the string is non-empty before writing the Custom_Component_File.

### Requirement 11: Custom Component Type Definitions

**User Story:** As a user, I want IntelliSense and type checking in the UI editor, so that I can discover available props and catch errors before saving.

#### Acceptance Criteria

1. THE backend SHALL serve a type definitions file for custom UI components at `GET /api/automations/ui-types`.
2. THE type definitions SHALL declare the `CustomComponentProps` interface with all fields specified in Requirement 3.
3. THE type definitions SHALL include React type declarations sufficient for `React.FC`, JSX elements, `useState`, `useEffect`, and `useCallback`.
4. THE UI_Editor SHALL fetch and register the type definitions with the Monaco TypeScript language service on mount, consistent with how the Script_Editor loads sandbox type definitions.

### Requirement 12: Cleanup on Rule Deletion

**User Story:** As a user, I want custom UI files to be cleaned up when I delete an automation, so that stale component files do not accumulate on disk or cause build errors.

#### Acceptance Criteria

1. WHEN an automation rule with a non-empty `ui_source` is deleted, THE Automation_API SHALL delete the Custom_Component_File from disk.
2. WHEN a Custom_Component_File is deleted, THE Automation_API SHALL regenerate the Custom_Component_Registry to remove the deleted component's import and map entry.
3. IF the Custom_Component_File does not exist on disk at deletion time (already manually removed), THEN THE Automation_API SHALL skip the file deletion without raising an error and still regenerate the Custom_Component_Registry.

### Requirement 13: Rebuild Status Tracking

**User Story:** As a user, I want a live status indicator that shows me when the frontend rebuild is complete, so that I know when to refresh the browser to see my custom UI component.

#### Acceptance Criteria

1. WHEN the `POST /api/system/rebuild-frontend` endpoint is called, THE backend SHALL begin polling the frontend container's HTTP health (e.g. `http://localhost:3000`) every 2 seconds in the background.
2. THE System_API SHALL expose a `GET /api/system/rebuild-status` endpoint that returns the current rebuild state as one of: `idle` (no rebuild in progress), `rebuilding` (build triggered, frontend not yet responding), or `ready` (frontend responding after a rebuild).
3. WHEN the frontend container stops responding during the rebuild (container being replaced), THE rebuild status SHALL transition from `idle` to `rebuilding`.
4. WHEN the frontend container starts responding again after a rebuild (new container healthy), THE rebuild status SHALL transition from `rebuilding` to `ready`.
5. THE rebuild status SHALL automatically reset to `idle` after 30 seconds in the `ready` state, so stale status does not persist indefinitely.
6. THE Automation_Pane SHALL poll `GET /api/system/rebuild-status` every 3 seconds while a rebuild is in progress and display a live status indicator: a spinning animation during `rebuilding`, and a green check with "Rebuild complete — refresh to activate" when `ready`.
7. WHEN the rebuild status transitions to `ready`, THE Automation_Pane SHALL display a "Refresh Now" button that reloads the page via `window.location.reload()`.
8. IF the rebuild status remains `rebuilding` for more than 120 seconds, THE Automation_Pane SHALL display a warning message suggesting the user check the system logs for build errors.

### Requirement 14: UI Tab in Setup Mode

**User Story:** As a user, I want to write a custom UI component when creating a new automation (not just when editing), so that I can set up both logic and visuals from the start.

#### Acceptance Criteria

1. WHEN the Automation_Pane is in Setup_Mode, THE Automation_Pane SHALL display the "Logic" and "UI" tab bar, identical to the editing view.
2. WHEN the user saves a new automation from Setup_Mode with UI_Source content, THE Automation_API SHALL store the UI_Source and write the Custom_Component_File in the same request that creates the rule.
3. THE UI_Editor in Setup_Mode SHALL display the default template, consistent with Requirement 8.

### Requirement 15: Automation State Store — Backend (Sandbox Global)

**User Story:** As a user, I want my automation script to store computed values (averages, modes, counters) in a per-rule state store, so that my custom UI component can display them without re-computing.

#### Acceptance Criteria

1. THE sandbox SHALL expose a `state` global alongside the existing `devices`, `mqtt`, `log`, `context`, `services`, and `http` globals.
2. THE `state` global SHALL provide a `set(key: string, value: unknown): void` method that stores a key-value pair scoped to the current rule ID.
3. THE `state` global SHALL provide a `get(key: string): unknown` method that retrieves a previously stored value for the current rule ID, or `undefined` if the key does not exist.
4. THE `state` global SHALL provide a `getAll(): Record<string, unknown>` method that returns all key-value pairs for the current rule ID.
5. THE `state` global SHALL provide a `delete(key: string): void` method that removes a key-value pair for the current rule ID.
6. WHEN `state.set()` is called, THE backend SHALL persist the key-value pair to the Automation_State_Store (in-memory with SQLite persistence).
7. WHEN `state.set()` is called, THE backend SHALL broadcast a WebSocket message of type `automation-state` with the rule ID, key, and value to all connected clients.
8. THE state values SHALL be JSON-serializable (strings, numbers, booleans, arrays, plain objects). Non-serializable values (functions, symbols, circular references) SHALL be rejected with a warning log.
9. THE sandbox type definitions (`sandbox-types.d.ts`) SHALL declare the `state` global with full JSDoc documentation.

### Requirement 16: Automation State Store — Frontend (Props)

**User Story:** As a user, I want my custom UI component to receive live automation state as a prop, so that computed values from the backend script are displayed in real-time without polling.

#### Acceptance Criteria

1. THE Custom_Component_Props interface SHALL include a `state` field of type `Map<string, unknown>` containing all key-value pairs from the Automation_State_Store for this rule.
2. THE Custom_Component_Props interface SHALL include a `stateSet` function with signature `(key: string, value: unknown) => void` that allows the UI component to write state back to the Automation_State_Store.
3. WHEN the frontend receives a WebSocket message of type `automation-state` matching the rule ID, THE `state` prop SHALL be updated and the custom component SHALL re-render with the new value.
4. THE frontend SHALL fetch the initial state snapshot for a rule from `GET /api/automations/:id/state` when the AutomationPane enters Status_Mode.
5. WHEN `props.stateSet()` is called from the UI component, THE frontend SHALL send a `PUT /api/automations/:id/state` request with the key-value pair, which the backend persists and broadcasts via WebSocket.
6. THE state updates from WebSocket SHALL be merged into the existing state map (not replace it), so that setting one key does not clear other keys.

### Requirement 17: Automation State Store — Persistence and API

**User Story:** As a user, I want my automation's computed state to survive restarts, so that dashboard widgets show the last known values immediately after a reboot.

#### Acceptance Criteria

1. THE backend SHALL persist automation state to a SQLite table (`automation_state`) with columns: `rule_id TEXT`, `key TEXT`, `value TEXT` (JSON-serialized), and a composite primary key on `(rule_id, key)`.
2. THE Automation_API SHALL expose `GET /api/automations/:id/state` that returns all key-value pairs for a rule as a JSON object.
3. THE Automation_API SHALL expose `PUT /api/automations/:id/state` that accepts `{ key: string, value: unknown }` and upserts the key-value pair, persists to SQLite, and broadcasts via WebSocket.
4. THE Automation_API SHALL expose `DELETE /api/automations/:id/state/:key` that removes a single key-value pair.
5. WHEN an automation rule is deleted, THE backend SHALL delete all associated state entries from the `automation_state` table.
6. THE Automation_State_Store SHALL load all state entries from SQLite into an in-memory cache on startup for fast reads from the sandbox.
