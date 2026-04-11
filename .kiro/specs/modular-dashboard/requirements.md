# Requirements Document

## Introduction

The modular dashboard feature replaces the hardcoded page navigation in Aeolus (Dashboard, Lighting, Automations, System) with a user-defined tab system. Users create custom tabs in the sidebar, each containing a configurable layout of reusable Panes. Panes map to existing Aeolus components (device grid, sensor panel, MQTT inspector, Hue light controls, automation rules, system stats) and accept a config object that controls filtering and display (e.g. filter by room, device type, topic pattern). First-time users receive a sensible default layout that mirrors the current hardcoded pages. This differentiates Aeolus from YAML-driven dashboards by being visual, instant, and native.

## Glossary

- **Tab**: A user-defined navigation entry in the sidebar. Each Tab has an id, name, icon, display order, and an ordered collection of Panes.
- **Pane**: A reusable UI building block placed on a Tab. Each Pane has an id, type identifier, configuration object, grid position, and size. Named after a window pane — the surface through which the wind (data) flows.
- **Pane_Type**: A registered category of Pane (e.g. "device-grid", "sensor-panel", "mqtt-inspector", "hue-lights", "automation-rules", "system-stats", "topic-tree", "event-log"). Each Pane_Type maps to an existing React component.
- **Pane_Config**: A JSON object attached to a Pane that controls filtering and display behaviour (e.g. `{ "room": "kitchen", "deviceType": "sensor" }`).
- **Tab_Layout**: The spatial arrangement of Panes within a Tab, defined by each Pane's grid position and size.
- **Default_Layout**: The pre-configured set of Tabs and Panes shipped with a fresh Aeolus installation, replicating the current four-page experience.
- **Dashboard_Store**: The Zustand store slice responsible for persisting and managing Tab and Pane state on the frontend.
- **Layout_API**: The backend REST endpoints that persist Tab and Pane configurations to SQLite.
- **Sidebar**: The left navigation panel that displays user-defined Tabs and system controls.
- **Pane_Registry**: The frontend module that maps Pane_Type identifiers to their React component implementations and default configurations.

## Requirements

### Requirement 1: Tab Management

**User Story:** As an Aeolus user, I want to create, rename, reorder, and delete custom tabs in the sidebar, so that I can organize my dashboard around my own workflows.

#### Acceptance Criteria

1. WHEN the user clicks the "Add Tab" button in the Sidebar, THE Sidebar SHALL display an inline form to enter a tab name and select an icon.
2. WHEN the user submits the new tab form with a non-empty name, THE Dashboard_Store SHALL create a new Tab with a unique id, the provided name, the selected icon, and an order value placing the Tab at the end of the list.
3. WHEN the user double-clicks a Tab name in the Sidebar, THE Sidebar SHALL display an inline text input pre-filled with the current name, allowing the user to rename the Tab.
4. WHEN the user confirms a rename with a non-empty name, THE Dashboard_Store SHALL update the Tab name.
5. WHEN the user drags a Tab to a new position in the Sidebar, THE Dashboard_Store SHALL update the order values of all affected Tabs to reflect the new sequence.
6. WHEN the user clicks the delete action on a Tab, THE Sidebar SHALL display a confirmation prompt before removing the Tab.
7. WHEN the user confirms Tab deletion, THE Dashboard_Store SHALL remove the Tab and all associated Panes from state and persistence.
8. THE Sidebar SHALL display all Tabs in ascending order by their order field.
9. IF the user attempts to create a Tab with an empty name, THEN THE Sidebar SHALL display a validation message and prevent Tab creation.

### Requirement 2: Pane Placement and Layout

**User Story:** As an Aeolus user, I want to place Panes onto my tabs and arrange them in a grid layout, so that I can build custom views of my IoT data.

#### Acceptance Criteria

1. WHEN the user opens the Pane picker on a Tab, THE Dashboard_Store SHALL present a list of all available Pane_Types from the Pane_Registry.
2. WHEN the user selects a Pane_Type from the picker, THE Dashboard_Store SHALL add a new Pane of that type to the active Tab with default position and size.
3. WHEN the user drags a Pane to a new grid position within a Tab, THE Dashboard_Store SHALL update the Pane position to reflect the new placement.
4. WHEN the user resizes a Pane by dragging its resize handle, THE Dashboard_Store SHALL update the Pane size within the grid constraints.
5. WHEN the user clicks the remove action on a Pane, THE Dashboard_Store SHALL remove the Pane from the Tab.
6. THE Tab_Layout SHALL render Panes in a responsive grid that adapts to the viewport width.
7. IF two Panes overlap after a drag operation, THEN THE Tab_Layout SHALL reflow the Panes to eliminate the overlap.

### Requirement 3: Pane Configuration

**User Story:** As an Aeolus user, I want to configure what data each Pane shows (filter by room, device type, topic pattern), so that I can tailor each view to specific needs.

#### Acceptance Criteria

1. WHEN the user clicks the settings action on a Pane, THE Dashboard_Store SHALL display a configuration panel for that Pane.
2. THE configuration panel SHALL present form fields appropriate to the Pane_Type (e.g. room filter for device-grid, topic pattern for mqtt-inspector).
3. WHEN the user saves the Pane configuration, THE Dashboard_Store SHALL update the Pane_Config and the Pane SHALL re-render with the new filter applied.
4. THE Pane_Registry SHALL define a default Pane_Config for each Pane_Type so that newly placed Panes render meaningful content without manual configuration.
5. IF the user clears all filter fields in the configuration panel, THEN THE Pane SHALL display unfiltered data for its type.

### Requirement 4: Pane Registry

**User Story:** As a developer, I want a central registry that maps Pane type identifiers to React components and their default configs, so that adding new Pane types requires minimal code changes.

#### Acceptance Criteria

1. THE Pane_Registry SHALL map each Pane_Type identifier to a React component, a display name, a default icon, and a default Pane_Config.
2. THE Pane_Registry SHALL include entries for: device-grid, sensor-panel, mqtt-inspector, hue-lights, automation-rules, system-stats, topic-tree, and event-log.
3. WHEN a Tab renders its Panes, THE Tab_Layout SHALL look up each Pane's type in the Pane_Registry to resolve the correct React component.
4. IF a Pane references a Pane_Type not present in the Pane_Registry, THEN THE Tab_Layout SHALL render a placeholder error message identifying the unknown type.

### Requirement 5: Default Layout for New Users

**User Story:** As a first-time Aeolus user, I want a sensible starting layout that mirrors the current dashboard experience, so that I can use the platform immediately and customize later.

#### Acceptance Criteria

1. WHEN no saved Tab configuration exists (first launch), THE Dashboard_Store SHALL initialize the Default_Layout with four Tabs: "Dashboard", "Lighting", "Automations", and "System".
2. THE Default_Layout "Dashboard" Tab SHALL contain Panes for: system-stats, sensor-panel, device-grid, mqtt-inspector, topic-tree, and event-log.
3. THE Default_Layout "Lighting" Tab SHALL contain a single hue-lights Pane.
4. THE Default_Layout "Automations" Tab SHALL contain a single automation-rules Pane.
5. THE Default_Layout "System" Tab SHALL contain a single system-stats Pane configured to show host diagnostics.
6. THE user SHALL be able to modify or delete any Default_Layout Tab after initialization.

### Requirement 6: Backend Persistence

**User Story:** As an Aeolus user, I want my tab and Pane configurations to persist across browser refreshes and server restarts, so that I do not lose my custom layouts.

#### Acceptance Criteria

1. THE Layout_API SHALL expose a GET endpoint that returns all Tabs with their associated Panes.
2. THE Layout_API SHALL expose a PUT endpoint that accepts a complete Tab and Pane configuration and persists the layout to SQLite.
3. WHEN the Dashboard_Store modifies any Tab or Pane, THE Dashboard_Store SHALL send the updated layout to the Layout_API within 2 seconds (debounced save).
4. WHEN the frontend loads, THE Dashboard_Store SHALL fetch the saved layout from the Layout_API and initialize state from the response.
5. IF the Layout_API GET endpoint returns an empty result, THEN THE Dashboard_Store SHALL initialize the Default_Layout and persist the default configuration.
6. THE Layout_API SHALL store Tab and Pane data in SQLite tables with foreign key relationships (Panes reference their parent Tab).

### Requirement 7: Sidebar Integration

**User Story:** As an Aeolus user, I want the sidebar to display my custom tabs alongside system controls (simulator toggle, connection status), so that navigation feels seamless.

#### Acceptance Criteria

1. THE Sidebar SHALL replace the hardcoded navigation buttons with a dynamic list of Tabs loaded from the Dashboard_Store.
2. THE Sidebar SHALL continue to display the simulator toggle, MQTT connection status, and WebSocket status below the Tab list.
3. WHEN the user clicks a Tab in the Sidebar, THE Dashboard_Store SHALL set the active Tab and the main content area SHALL render the corresponding Tab_Layout.
4. THE Sidebar SHALL visually distinguish the currently active Tab from inactive Tabs using the existing highlight style (bg-elevated).
5. THE Sidebar SHALL display each Tab's configured icon next to its name.

### Requirement 8: Layout Serialization Round-Trip

**User Story:** As a developer, I want the layout configuration to survive a serialize-then-deserialize cycle without data loss, so that persistence is reliable.

#### Acceptance Criteria

1. THE Layout_API SHALL serialize Tab and Pane configurations to JSON for storage in SQLite.
2. THE Layout_API SHALL deserialize stored JSON back into Tab and Pane objects on retrieval.
3. FOR ALL valid Tab and Pane configurations, serializing then deserializing SHALL produce an object equivalent to the original (round-trip property).
4. IF the stored JSON is malformed or missing required fields, THEN THE Layout_API SHALL log a warning and fall back to the Default_Layout.
