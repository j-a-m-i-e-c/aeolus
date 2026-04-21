# Requirements Document

## Introduction

Replace the current multi-component automation workflow (AutomationsEditorPane embedding the full AutomationsPage, plus the separate AutomationCardPane) with a single self-contained Automation Pane. One pane equals one automation — the pane IS the automation. Users write TypeScript code, configure the trigger topic, and monitor status all within a single dashboard pane. The form-based "Quick Rule" mode is removed from the pane; code is the only authoring interface.

The status mode of the pane provides three tiers of visual richness depending on how the automation is authored:

1. **Structured automations** — Scripts that use the `automation()` helper with declared `condition` and `actions` sections get an auto-generated flow diagram showing trigger → condition → actions as connected nodes.
2. **Free-form code** — Scripts that use raw sandbox code (without the helper) get a live activity feed showing recent executions, actions taken, and success/failure status.
3. **Custom UI (future)** — Advanced users can author a React component that renders as the pane's status visual, providing full control over appearance.

## Glossary

- **Automation_Pane**: A new dashboard pane type (`automation`) registered in the Pane_Registry that encapsulates the full lifecycle of a single automation rule — creation, editing, status display, and deletion.
- **Pane_Registry**: The frontend module (`frontend/src/lib/pane-registry.ts`) that maps pane type identifiers to React components, metadata, and default configuration.
- **Dashboard_Store**: The Zustand store (`frontend/src/store/dashboard-store.ts`) that manages tabs, panes, positions, sizes, and configuration, with debounced persistence to the backend.
- **Script_Editor**: The existing Monaco-based TypeScript editor component (`frontend/src/components/ScriptEditor.tsx`) with the Aeolus dark theme, IntelliSense from sandbox type definitions, and Ctrl+S save binding.
- **Automation_API**: The Express REST API at `/api/automations` providing CRUD operations, toggle, and execution history for automation rules.
- **Transpiler**: The backend module (`src/automations/transpiler.ts`) that converts TypeScript automation source to ES2022 JavaScript, rejecting imports/requires and returning structured errors.
- **Execution_Log**: The in-memory ring buffer (`src/automations/execution-log.ts`) that records automation execution entries including rule ID, duration, and timestamp.
- **Setup_Mode**: The Automation_Pane state shown when no rule ID exists in the pane config — displays name field, trigger topic field, Script_Editor, and a Save button.
- **Status_Mode**: The Automation_Pane state shown when a rule ID exists in the pane config — displays the automation visual summary (flow diagram or activity feed), enabled/disabled toggle, last fired timestamp, and an Edit button.
- **Structured_Automation**: An automation script that uses the `automation()` helper function with declared `condition` and `actions` sections. The structured shape enables the frontend to extract metadata and render an auto-generated flow diagram.
- **Flow_Diagram**: A visual representation of a Structured_Automation rendered in Status_Mode, showing the trigger, condition, and actions as connected nodes.
- **Activity_Feed**: A chronological list of recent execution entries for an automation, showing timestamps, actions taken, targets, and success/failure status. Displayed in Status_Mode for free-form automations that do not use the `automation()` helper.
- **Custom_UI**: A future capability allowing advanced users to author a React component (JSX) that renders as the Status_Mode visual for their automation, providing full control over the pane's appearance.
- **Pane_Config**: The type-specific configuration object stored on each pane (`PaneConfig` in `frontend/src/types/dashboard.ts`), persisted via the layout API.
- **WebSocket_Server**: The real-time event broadcast server (`src/websocket/ws-server.ts`) that pushes `automation-fired` events to connected dashboard clients.

## Requirements

### Requirement 1: Pane Registration

**User Story:** As a user, I want to add an "Automation" pane from the PanePicker, so that I can create a new automation directly on any custom tab.

#### Acceptance Criteria

1. THE Pane_Registry SHALL contain an entry with key `automation`, display name "Automation", category "automations", and default icon "code".
2. THE Pane_Registry entry SHALL specify a default size of 6 columns wide and 5 rows tall.
3. THE Pane_Registry entry SHALL specify a default config of `{ ruleId: "" }`.
4. WHEN a user selects the "Automation" pane type in the PanePicker, THE Dashboard_Store SHALL create a new pane with pane type `automation` on the target tab.

### Requirement 2: Setup Mode — New Automation

**User Story:** As a user, I want the Automation Pane to start in setup mode when no automation rule is linked, so that I can create a new automation from scratch.

#### Acceptance Criteria

1. WHEN the Automation_Pane config contains no `ruleId` or an empty `ruleId`, THE Automation_Pane SHALL render in Setup_Mode.
2. THE Setup_Mode SHALL display a text input for the automation name with placeholder text "Automation name".
3. THE Setup_Mode SHALL display a text input for the trigger topic with placeholder text "e.g. sensor/+/temperature" rendered in monospace font.
4. THE Setup_Mode SHALL display the Script_Editor component filling the remaining vertical space of the pane.
5. THE Setup_Mode SHALL display a "Save" button that is disabled when the name field or trigger topic field is empty.

### Requirement 3: Create Automation on Save

**User Story:** As a user, I want to save my automation script from the pane, so that the rule is created in the backend and the pane becomes linked to it.

#### Acceptance Criteria

1. WHEN the user clicks the Save button in Setup_Mode, THE Automation_Pane SHALL send a POST request to `/api/automations` with `name`, `triggerTopic`, `ruleType: "script"`, and `scriptSource` from the editor.
2. WHEN the Automation_API returns a successful response with an `id`, THE Automation_Pane SHALL store the returned `id` as `ruleId` in the pane config via the Dashboard_Store `updatePaneConfig` action.
3. WHEN the Automation_API returns a successful response, THE Automation_Pane SHALL transition from Setup_Mode to Status_Mode.
4. IF the Automation_API returns a 400 response with transpilation error details, THEN THE Automation_Pane SHALL display the errors inline below the Script_Editor and remain in Setup_Mode.
5. WHEN the user presses Ctrl+S (or Cmd+S) in the Script_Editor during Setup_Mode, THE Automation_Pane SHALL trigger the same save action as clicking the Save button.

### Requirement 4: Status Mode — Existing Automation

**User Story:** As a user, I want to see the status of my automation at a glance when the pane is linked to a rule, so that I can monitor it without opening an editor.

#### Acceptance Criteria

1. WHEN the Automation_Pane config contains a non-empty `ruleId`, THE Automation_Pane SHALL fetch the rule data from `GET /api/automations` and render in Status_Mode.
2. THE Status_Mode SHALL display the automation name as the primary heading.
3. THE Status_Mode SHALL display the trigger topic as a monospace badge.
4. THE Status_Mode SHALL display an enabled/disabled toggle that sends a PATCH request to `/api/automations/:id/toggle` when clicked.
5. THE Status_Mode SHALL display the last fired timestamp, sourced from the `automation-fired` WebSocket events or from the execution history endpoint `GET /api/automations/history`.
6. THE Status_Mode SHALL display an "Edit" button that transitions the pane to an editing view with the Script_Editor pre-loaded with the current script source.
7. IF the rule is not found in the API response (deleted externally), THEN THE Automation_Pane SHALL display a "Rule not found" message and offer a button to reset the pane to Setup_Mode by clearing the `ruleId` from the pane config.

### Requirement 5: Edit Existing Automation

**User Story:** As a user, I want to edit my automation script from the same pane, so that I can update the code and trigger topic without leaving the pane context.

#### Acceptance Criteria

1. WHEN the user clicks the "Edit" button in Status_Mode, THE Automation_Pane SHALL render the Script_Editor pre-loaded with the current `scriptSource` from the rule data.
2. THE editing view SHALL display the name field and trigger topic field pre-filled with the current values, allowing the user to modify them.
3. WHEN the user clicks "Save" in the editing view, THE Automation_Pane SHALL send a PUT request to `/api/automations/:id` with the updated `name`, `triggerTopic`, and `scriptSource`.
4. WHEN the Automation_API returns a successful response to the PUT request, THE Automation_Pane SHALL transition back to Status_Mode with the updated data.
5. IF the Automation_API returns a 400 response with transpilation error details during editing, THEN THE Automation_Pane SHALL display the errors inline below the Script_Editor and remain in the editing view.
6. THE editing view SHALL display a "Cancel" button that discards changes and returns to Status_Mode.
7. WHEN the user presses Ctrl+S (or Cmd+S) in the Script_Editor during editing, THE Automation_Pane SHALL trigger the same save action as clicking the Save button.

### Requirement 6: Delete Automation on Pane Removal

**User Story:** As a user, I want the backend automation rule to be cleaned up when I remove the pane, so that I do not accumulate orphaned rules.

#### Acceptance Criteria

1. WHEN the user removes an Automation_Pane that has a non-empty `ruleId` in its config, THE Automation_Pane SHALL send a DELETE request to `/api/automations/:id` before the pane is removed from the Dashboard_Store.
2. IF the DELETE request fails (network error or non-2xx response), THEN THE Automation_Pane SHALL still allow the pane to be removed from the dashboard layout.
3. WHEN the user removes an Automation_Pane that has no `ruleId` (still in Setup_Mode), THE Dashboard_Store SHALL remove the pane without making any API calls.

### Requirement 7: Deprecate Legacy Automation Panes

**User Story:** As a user, I want the old Automation Editor and Automation Card pane types to be replaced by the new Automation Pane, so that the dashboard has a single, consistent automation authoring experience.

#### Acceptance Criteria

1. THE Pane_Registry SHALL remove the `automations-editor` entry that wraps the full AutomationsPage.
2. THE Pane_Registry SHALL remove the `automation-card` entry.
3. THE `automation-rules` entry (Automation List) SHALL remain in the Pane_Registry as a read-only overview of all rules.
4. THE AutomationsPage component SHALL remain in the codebase but SHALL no longer be referenced by any pane in the Pane_Registry.

### Requirement 8: Transpilation Error Display

**User Story:** As a user, I want to see transpilation errors inline in the pane, so that I can fix my TypeScript code without switching context.

#### Acceptance Criteria

1. WHEN the Automation_API returns transpilation errors (400 response with `details` array), THE Automation_Pane SHALL pass the errors to the Script_Editor component via the `errors` prop.
2. THE Script_Editor SHALL render error markers in the Monaco editor gutter at the reported line and column positions.
3. THE Automation_Pane SHALL display a summary error panel below the Script_Editor listing each error with its line number, column, and message.

### Requirement 9: Real-Time Last Fired Updates

**User Story:** As a user, I want the "last fired" timestamp to update in real time, so that I can see when my automation triggers without refreshing.

#### Acceptance Criteria

1. WHILE the Automation_Pane is in Status_Mode, THE Automation_Pane SHALL listen for `automation-fired` WebSocket messages.
2. WHEN an `automation-fired` message is received with a `ruleId` matching the pane's configured rule ID, THE Automation_Pane SHALL update the displayed last fired timestamp to the event's timestamp.
3. WHEN the Automation_Pane first enters Status_Mode, THE Automation_Pane SHALL fetch the most recent execution entry for the rule from `GET /api/automations/history` to populate the initial last fired timestamp.

### Requirement 10: Pane Resizability and Editor Layout

**User Story:** As a user, I want the Automation Pane to be resizable and have the code editor fill the available space, so that I can adjust the pane to a comfortable editing size.

#### Acceptance Criteria

1. THE Automation_Pane SHALL allow the react-grid-layout resize handle to change the pane dimensions.
2. WHILE the Automation_Pane is in Setup_Mode or editing view, THE Script_Editor SHALL expand to fill all vertical space not occupied by the name field, trigger topic field, error panel, and action buttons.
3. THE Script_Editor SHALL use the `automaticLayout: true` Monaco option so that the editor reflows when the pane is resized.

### Requirement 11: Structured Automation Pattern

**User Story:** As a user, I want to write automations using a structured `automation()` helper so that the dashboard can auto-generate a visual flow diagram from my code without me having to build a UI.

#### Acceptance Criteria

1. THE Sandbox type definitions SHALL declare an `automation()` global function that accepts an object with fields: `name` (string), `trigger` (string), `condition` (optional function receiving context and returning boolean), and `actions` (function receiving context).
2. THE default code template in the Script_Editor SHALL use the `automation()` helper pattern instead of free-form code.
3. WHEN a script uses the `automation()` helper, THE backend SHALL extract the structured metadata (name, trigger, condition source text, actions source text) during transpilation and store it alongside the compiled JavaScript.
4. THE Automation_API response for a Structured_Automation SHALL include a `structured` field containing the extracted metadata: `{ trigger, conditionText, actionsText }`.
5. THE `automation()` helper SHALL be optional — users MAY write free-form sandbox code without it, and the automation SHALL still function normally.

### Requirement 12: Flow Diagram in Status Mode

**User Story:** As a user, I want to see an auto-generated flow diagram when my automation uses the structured pattern, so that I can understand the automation's logic at a glance without reading code.

#### Acceptance Criteria

1. WHEN the Automation_Pane is in Status_Mode and the rule data includes a `structured` field, THE Automation_Pane SHALL render a Flow_Diagram showing the trigger, condition, and actions as connected visual nodes.
2. THE Flow_Diagram SHALL display the trigger topic as the first node.
3. IF the Structured_Automation includes a condition, THE Flow_Diagram SHALL display the condition as a diamond-shaped decision node with "Yes" and "No" branches.
4. THE Flow_Diagram SHALL display each action call (extracted from the actions source text) as a rectangular action node.
5. THE Flow_Diagram nodes SHALL use Aeolus design system colours: Aeolus Blue for trigger nodes, Wind Cyan for condition nodes, and Primary Text for action nodes, all on a Graphite background.
6. THE Flow_Diagram SHALL be rendered using SVG or a lightweight diagramming approach (not a heavy library like React Flow) to keep the bundle size small.

### Requirement 13: Activity Feed in Status Mode

**User Story:** As a user, I want to see a live activity feed of recent executions when my automation uses free-form code, so that I can understand what the automation is doing without reading the code.

#### Acceptance Criteria

1. WHEN the Automation_Pane is in Status_Mode and the rule data does NOT include a `structured` field, THE Automation_Pane SHALL render an Activity_Feed showing recent execution entries for this rule.
2. THE Activity_Feed SHALL display the most recent 5 execution entries from `GET /api/automations/history`, filtered by the rule ID.
3. EACH Activity_Feed entry SHALL display the timestamp, the actions taken (type and target from the ExecutionLogEntry), and a success/failure indicator.
4. THE Activity_Feed SHALL update in real time when new `automation-fired` WebSocket events are received for this rule.
5. IF no execution entries exist for the rule, THE Activity_Feed SHALL display a "No activity yet" placeholder message.

### Requirement 14: Custom UI Hook (Future)

**User Story:** As an advanced user, I want the option to author a custom React component that renders as my automation's status visual, so that I have full control over how the pane looks.

#### Acceptance Criteria

1. THE automation_rules database schema SHALL include an optional `ui_source` TEXT column for storing user-authored JSX/React component source code.
2. THE Automation_Pane editing view SHALL include a "UI" tab alongside the "Logic" tab, allowing users to write a React component that receives the automation's state and execution history as props.
3. WHEN a rule has a non-empty `ui_source`, THE Automation_Pane Status_Mode SHALL render the custom component instead of the Flow_Diagram or Activity_Feed.
4. THE Custom_UI capability SHALL be marked as experimental in the UI with a badge indicating it is an advanced feature.
5. THE Custom_UI source SHALL be transpiled and rendered in a sandboxed iframe or error boundary to prevent crashes from affecting the rest of the dashboard.
