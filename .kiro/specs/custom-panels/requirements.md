# Requirements Document

## Introduction

Custom Panels (also called "Views") are a new first-class entity in Aeolus that provides UI-only panels for data visualization and manual device controls. Unlike Automations — which are reactive, event-driven (trigger topic + conditions + actions + optional UI) — Custom Panels have no trigger, no conditions, and no reactive logic. They share the same React/TSX component system and runtime props (devices, deviceAction, mqttPublish, state, stateSet) but are purpose-built for dashboards, overviews, and manual control surfaces.

This feature addresses the pattern where users create automations solely to get a custom UI panel (e.g., an irrigation dashboard showing soil moisture with a "Water Now" button) without needing any automation logic.

## Glossary

- **Custom_Panel**: A UI-only entity consisting of a user-authored React/TSX component rendered in a dashboard pane, with access to device data and control actions but without automation engine wiring.
- **Panel_Editor**: The code editor interface for authoring and saving a Custom Panel's TSX source, including live transpilation and error feedback.
- **Panel_State_Store**: A per-panel key-value store (analogous to the per-rule Automation State Store) enabling persistent state for Custom Panel components.
- **Panel_Pane**: The dashboard pane type that renders a Custom Panel, supporting both editing and display modes.
- **Pane_Registry**: The frontend registry mapping pane type identifiers to React components and metadata.
- **Tab_Layout**: The dashboard component that renders panes in a grid and provides header action buttons.
- **PanePicker**: The modal overlay listing available built-in pane types for insertion into a tab.
- **Transpiler**: The TypeScript compiler API service that converts TSX source into executable JavaScript at save time.

## Requirements

### Requirement 1: Custom Panel Entity Storage

**User Story:** As a developer, I want Custom Panels stored as their own entity in the database, so that they are independent from automation rules and can be managed with dedicated CRUD operations.

#### Acceptance Criteria

1. THE Database SHALL store Custom Panels in a `custom_panels` table with columns: id (TEXT PRIMARY KEY), name (TEXT NOT NULL), ui_source (TEXT DEFAULT NULL), compiled_ui (TEXT DEFAULT NULL), created_at (INTEGER NOT NULL), updated_at (INTEGER NOT NULL).
2. WHEN the application starts, THE Database SHALL create the `custom_panels` table if it does not exist.
3. THE Database SHALL store per-panel state in a `panel_state` table with columns: panel_id (TEXT NOT NULL), key (TEXT NOT NULL), value (TEXT NOT NULL), with a composite primary key of (panel_id, key).
4. WHEN a Custom Panel is deleted, THE Database SHALL delete all associated entries from the `panel_state` table.

### Requirement 2: Custom Panel CRUD API

**User Story:** As a frontend client, I want a REST API for creating, reading, updating, and deleting Custom Panels, so that the dashboard can manage panels independently of automations.

#### Acceptance Criteria

1. WHEN a POST request is sent to `/api/panels` with a JSON body containing `name`, THE API SHALL create a new Custom Panel record and return the created panel object with a generated UUID.
2. WHEN a GET request is sent to `/api/panels`, THE API SHALL return an array of all Custom Panel records.
3. WHEN a GET request is sent to `/api/panels/:id`, THE API SHALL return the Custom Panel record matching the provided id.
4. IF a GET request is sent to `/api/panels/:id` with a non-existent id, THEN THE API SHALL return a 404 status with an error message.
5. WHEN a PUT request is sent to `/api/panels/:id` with a JSON body containing `name`, `uiSource`, or both, THE API SHALL update the matching record, transpile the `uiSource` if provided, store the compiled output, and return the updated panel object.
6. WHEN a DELETE request is sent to `/api/panels/:id`, THE API SHALL delete the Custom Panel record, its associated panel state, and return a success response.
7. IF a DELETE request is sent to `/api/panels/:id` with a non-existent id, THEN THE API SHALL return a 404 status with an error message.

### Requirement 3: Custom Panel State API

**User Story:** As a Custom Panel component, I want to read and write persistent key-value state, so that I can maintain data across page reloads without needing automation logic.

#### Acceptance Criteria

1. WHEN a GET request is sent to `/api/panels/:id/state`, THE API SHALL return all key-value pairs for the specified panel as a JSON object.
2. WHEN a PUT request is sent to `/api/panels/:id/state` with a JSON body containing `key` and `value`, THE API SHALL persist the key-value pair to the `panel_state` table and broadcast the update via WebSocket.
3. IF a PUT request is sent to `/api/panels/:id/state` for a non-existent panel, THEN THE API SHALL return a 404 status with an error message.

### Requirement 4: Custom Panel Transpilation

**User Story:** As a developer, I want Custom Panel TSX source transpiled on save using the same compiler pipeline as automation UI, so that components are validated and compiled consistently.

#### Acceptance Criteria

1. WHEN a Custom Panel's `uiSource` is saved via the API, THE Transpiler SHALL compile the TSX source into executable JavaScript using the same `transpileUi` function used for automation UI components.
2. IF the TSX source contains syntax errors or type errors, THEN THE Transpiler SHALL return the error details without saving the compiled output.
3. WHEN transpilation succeeds, THE API SHALL store both the original `ui_source` and the `compiled_ui` in the database.
4. FOR ALL valid Custom Panel TSX sources, transpiling then loading the compiled output SHALL produce a renderable React component (round-trip property).

### Requirement 5: Panel Pane Registration

**User Story:** As a user, I want Custom Panels to appear as a pane type in the dashboard, so that I can view and interact with my custom UI components.

#### Acceptance Criteria

1. THE Pane_Registry SHALL include a `custom-panel` pane type entry with display name "Custom Panel", a default icon, and a default size.
2. WHEN a `custom-panel` pane is rendered, THE Panel_Pane SHALL load and display the compiled UI component for the panel referenced in its config.
3. WHILE a `custom-panel` pane is in display mode, THE Panel_Pane SHALL pass the following props to the rendered component: devices, deviceAction, mqttPublish, state, stateSet.
4. THE Panel_Pane SHALL NOT pass automation-specific props (ruleId, ruleName, lastFired, enabled, executionHistory) to Custom Panel components.
5. WHILE a `custom-panel` pane is in display mode, THE Panel_Pane SHALL display the panel name in the pane header.

### Requirement 6: Custom Panel Component Props

**User Story:** As a component author, I want a well-defined props interface for Custom Panels, so that I know exactly what data and actions are available without automation-specific clutter.

#### Acceptance Criteria

1. THE Transpiler SHALL provide a `CustomPanelProps` type definition containing: devices (Device[]), panelId (string), panelName (string), deviceAction (function), mqttPublish (function), state (Map<string, unknown>), stateSet (function).
2. THE `CustomPanelProps` type SHALL NOT include ruleId, ruleName, lastFired, enabled, or executionHistory fields.
3. WHEN a Custom Panel component calls `stateSet(key, value)`, THE Panel_State_Store SHALL persist the value and broadcast it to all connected clients via WebSocket.
4. WHEN a Custom Panel component calls `deviceAction(deviceId, actionType, params)`, THE system SHALL execute the device action identically to how automation UI components execute device actions.

### Requirement 7: Dashboard Button Layout

**User Story:** As a user, I want clear, distinct buttons for creating automations, creating custom panes, and browsing built-in panes, so that I can quickly choose the right action.

#### Acceptance Criteria

1. THE Tab_Layout SHALL display three action buttons in the header area: "New Automation", "New Pane", and "Browse Panes".
2. WHEN the user clicks "New Automation", THE Tab_Layout SHALL add an automation pane in setup mode to the active tab (existing behavior, unchanged).
3. WHEN the user clicks "New Pane", THE Tab_Layout SHALL create a new Custom Panel via the API and add a `custom-panel` pane in editing mode to the active tab.
4. WHEN the user clicks "Browse Panes", THE Tab_Layout SHALL open the PanePicker modal displaying available built-in pane types (renamed from "Add Pane").
5. THE "New Pane" button SHALL be visually styled as a primary action alongside "New Automation", distinct from the secondary "Browse Panes" button.

### Requirement 8: Panel Editor Interface

**User Story:** As a developer, I want an inline code editor for Custom Panels with the same capabilities as the automation UI editor, so that I can author TSX components with syntax highlighting, error feedback, and snippet support.

#### Acceptance Criteria

1. WHEN a `custom-panel` pane is in editing mode, THE Panel_Editor SHALL display a code editor with TypeScript/TSX syntax highlighting.
2. WHEN the user clicks "Save" in the Panel_Editor, THE Panel_Editor SHALL send the source to the API for transpilation and persist the result.
3. IF transpilation fails, THEN THE Panel_Editor SHALL display the error messages inline without discarding the user's source code.
4. WHEN the user clicks "Cancel" or the close button while editing, THE Panel_Editor SHALL discard unsaved changes and return to display mode.
5. THE Panel_Editor SHALL provide access to the same snippet catalog available in the automation UI editor, filtered to UI-relevant snippets.

### Requirement 9: Panel Pane Lifecycle

**User Story:** As a user, I want Custom Panel panes to handle creation and deletion cleanly, so that removing a pane also cleans up the underlying panel entity.

#### Acceptance Criteria

1. WHEN a `custom-panel` pane is removed from the dashboard, THE Tab_Layout SHALL delete the associated Custom Panel entity via the API.
2. WHEN a new Custom Panel is created via the "New Pane" button, THE system SHALL generate a default name (e.g., "Untitled Pane") that the user can rename in the editor.
3. WHILE a Custom Panel has no compiled UI (newly created or after a failed save), THE Panel_Pane SHALL display a placeholder prompting the user to write their component.

### Requirement 10: PanePicker Exclusion

**User Story:** As a user, I want the PanePicker (Browse Panes modal) to show only built-in pane types, so that Custom Panels are created exclusively through the dedicated "New Pane" button.

#### Acceptance Criteria

1. THE PanePicker SHALL exclude the `custom-panel` pane type from its listing, consistent with how the `automation` pane type is already excluded.
2. THE PanePicker header SHALL display "Browse Panes" as its title (renamed from "Add Pane").

### Requirement 11: Panel State WebSocket Integration

**User Story:** As a user viewing a Custom Panel, I want state changes to appear in real-time, so that the panel reflects the latest data without requiring a page refresh.

#### Acceptance Criteria

1. WHEN a panel state value is updated (via the API or from within the component), THE system SHALL broadcast the update to all connected WebSocket clients.
2. WHEN a WebSocket client receives a panel state update, THE frontend store SHALL merge the new value into the panel's state map.
3. THE WebSocket message for panel state updates SHALL include the panel_id, key, and value fields, distinguishing panel state from automation state messages.

### Requirement 12: Custom Panel Pretty Printer

**User Story:** As a developer, I want a default TSX template generated for new Custom Panels, so that I have a working starting point with correct type annotations.

#### Acceptance Criteria

1. WHEN a new Custom Panel is created, THE system SHALL populate the `ui_source` field with a default TSX template that imports `CustomPanelProps` and exports a valid default component.
2. THE default template SHALL demonstrate usage of at least one prop (e.g., `devices` or `panelName`) so the developer sees a working example.
3. FOR ALL default templates, transpiling the template SHALL produce a valid compiled output without errors (round-trip property).
