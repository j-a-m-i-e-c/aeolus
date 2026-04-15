# Requirements Document

## Introduction

The Connector UI System unifies all connector setup and device control into a single, generic framework. Currently, the ConnectorsPage hardcodes Hue setup steps instead of fetching them from the backend, and the LightingPage is a standalone page with its own bridge discovery/pairing UI that bypasses the connector framework entirely. This feature replaces that fragmented approach with a fully generic setup wizard driven by the backend connector API, and introduces connector-provided control panes that can be added to custom dashboard tabs for device-specific controls (e.g. Hue light grid with toggle/brightness/colour, Kasa plug grid with on/off and energy stats).

## Glossary

- **Setup_Wizard**: The multi-step guided UI in the ConnectorsPage that walks users through connector-specific setup flows (e.g. bridge discovery, button-press pairing). Steps are fetched from the backend, not hardcoded.
- **Control_Pane**: A React component registered in the Pane_Registry that renders device-specific controls for a particular connector type. Users can add control panes to custom dashboard tabs via the PanePicker.
- **Pane_Registry**: The frontend registry (`pane-registry.ts`) that maps pane type identifiers to React components with metadata (display name, icon, default size).
- **ConnectorsPage**: The pinned system tab that serves as the single entry point for all connector management: enable, configure, setup wizard, health monitoring, disable, retry.
- **Connector_API**: The backend REST API at `/api/connectors/` that provides generic endpoints for connector lifecycle management, setup step execution, and status queries.
- **Setup_Step_Descriptor**: A data structure returned by a connector's `getSetupSteps()` method describing a single step in the setup flow, including its ID, title, description, and optional input fields.
- **LightingPage**: The existing standalone Hue bridge setup and light control page that will be replaced by the generic connector framework.
- **Hue_Control_Pane**: A connector-provided control pane for Philips Hue that renders a light grid with toggle, brightness, and colour controls.
- **Kasa_Control_Pane**: A connector-provided control pane for TP-Link Kasa that renders a plug/device grid with on/off and energy monitoring stats.

## Requirements

### Requirement 1: Backend Setup Steps API

**User Story:** As a frontend developer, I want to fetch setup step descriptors from the backend for any connector instance, so that the setup wizard can be fully generic without hardcoded step definitions.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/connectors/:id/setup-steps`, THE Connector_API SHALL return the array of Setup_Step_Descriptor objects from the connector instance's `getSetupSteps()` method.
2. IF the connector instance does not implement `getSetupSteps()`, THEN THE Connector_API SHALL return an empty array.
3. IF the connector instance ID does not exist, THEN THE Connector_API SHALL return a 404 error with a descriptive message.
4. THE Connector_API SHALL include each Setup_Step_Descriptor's `id`, `title`, `description`, and `fields` properties in the response.

### Requirement 2: Generic Setup Wizard

**User Story:** As a user, I want the setup wizard in the ConnectorsPage to dynamically fetch and render setup steps from the backend, so that any connector's setup flow works without frontend changes.

#### Acceptance Criteria

1. WHEN a connector with `requiresSetup: true` is enabled, THE Setup_Wizard SHALL fetch setup steps from `GET /api/connectors/:id/setup-steps` instead of using hardcoded step definitions.
2. THE Setup_Wizard SHALL render each step's title, description, and input fields dynamically based on the Setup_Step_Descriptor data returned by the backend.
3. WHEN the user completes a step by clicking Continue, THE Setup_Wizard SHALL execute the step via `POST /api/connectors/:id/setup/:stepId` with the user-provided parameters.
4. WHEN a setup step returns `complete: true`, THE Setup_Wizard SHALL close the wizard and update the connector's configuration with any data returned by the final step.
5. WHEN a setup step returns `success: false`, THE Setup_Wizard SHALL display the error message and allow the user to retry the current step.
6. THE Setup_Wizard SHALL display a step progress indicator showing the current step position relative to the total number of steps.
7. THE ConnectorsPage SHALL remove the `getSetupStepsForType()` function and all hardcoded step definitions.

### Requirement 3: Setup Step Configuration Propagation

**User Story:** As a user, I want the setup wizard to automatically apply configuration produced by setup steps (e.g. discovered bridge IP, generated API key) to the connector instance, so that I don't have to manually re-enter configuration after completing setup.

#### Acceptance Criteria

1. WHEN a setup step returns `complete: true` with a `data` field containing configuration values, THE Setup_Wizard SHALL send a PATCH request to `/api/connectors/:id` to update the connector's configuration with the returned values.
2. WHEN intermediate setup steps return `data` fields, THE Setup_Wizard SHALL accumulate the data and pass it as parameters to subsequent steps.
3. WHEN setup completes, THE ConnectorsPage SHALL refresh the enabled connectors list to reflect the updated configuration and health status.

### Requirement 4: Hue Control Pane

**User Story:** As a user, I want a Hue control pane that I can add to any custom dashboard tab, so that I can control my Hue lights with toggle, brightness, and colour controls without needing a separate standalone page.

#### Acceptance Criteria

1. THE Hue_Control_Pane SHALL display a grid of cards, one per Hue light discovered by the enabled Hue connector instance.
2. WHEN a Hue light card is displayed, THE Hue_Control_Pane SHALL show the light's name, on/off state, online/offline status, and brightness level.
3. WHEN the user clicks the toggle button on a light card, THE Hue_Control_Pane SHALL send a toggle action via `POST /api/devices/:id/action` and optimistically update the UI.
4. WHEN the user adjusts the brightness slider on a light card, THE Hue_Control_Pane SHALL send the brightness value via `POST /api/devices/:id/action` only on slider release (not during drag).
5. WHEN a Hue light is colour-capable (type contains "color" or "extended"), THE Hue_Control_Pane SHALL display a colour picker with preset colour swatches that sends hue and saturation values via `POST /api/devices/:id/action`.
6. THE Hue_Control_Pane SHALL be registered in the Pane_Registry with pane type `"hue-control"`, display name `"Hue Lights"`, icon `"lightbulb"`, and default size 12 columns by 6 rows.
7. THE Hue_Control_Pane SHALL fetch light data from the device store (Zustand), filtering devices where `integration === "hue"` and `type === "light"`.
8. THE Hue_Control_Pane SHALL receive real-time state updates via the existing WebSocket connection and device store subscription.

### Requirement 5: Kasa Control Pane

**User Story:** As a user, I want a Kasa control pane that I can add to any custom dashboard tab, so that I can control my Kasa smart plugs and view energy stats.

#### Acceptance Criteria

1. THE Kasa_Control_Pane SHALL display a grid of cards, one per Kasa device discovered by the enabled Kasa connector instance.
2. WHEN a Kasa device card is displayed, THE Kasa_Control_Pane SHALL show the device's name, on/off state, online status, and device type (plug, light, or switch).
3. WHEN the user clicks the toggle button on a device card, THE Kasa_Control_Pane SHALL send a toggle action via `POST /api/devices/:id/action` and optimistically update the UI.
4. WHEN a Kasa device has energy monitoring data in its state (voltage, current, power, totalConsumption), THE Kasa_Control_Pane SHALL display the energy stats on the device card.
5. THE Kasa_Control_Pane SHALL be registered in the Pane_Registry with pane type `"kasa-control"`, display name `"Kasa Devices"`, icon `"plug"`, and default size 12 columns by 6 rows.
6. THE Kasa_Control_Pane SHALL fetch device data from the device store (Zustand), filtering devices where `integration === "kasa"`.
7. THE Kasa_Control_Pane SHALL receive real-time state updates via the existing WebSocket connection and device store subscription.

### Requirement 6: Clean Default Layout

**User Story:** As a first-time user, I want the default layout to only contain the four pinned system tabs with no custom tabs, so that my dashboard starts clean and I build it to match my own setup.

#### Acceptance Criteria

1. THE default layout SHALL contain only the four pinned system tabs: Dashboard, Automations, Connectors, System.
2. THE default layout SHALL NOT include any custom (unpinned) tabs such as "Lighting".
3. THE default layout SHALL NOT include any panes for custom tabs.
4. WHEN a user wants to control Hue lights, THE user SHALL create a custom tab (e.g. "Lighting") and add the Hue_Control_Pane to it via the PanePicker.
5. THE standalone LightingPage component SHALL be removed from the codebase after the Hue_Control_Pane is functional.

### Requirement 7: Connector Control Panes in PanePicker

**User Story:** As a user, I want to see connector-specific control panes in the PanePicker when adding panes to a custom tab, so that I can build custom dashboards with device controls for any enabled connector.

#### Acceptance Criteria

1. THE Pane_Registry SHALL include entries for all connector control panes (Hue_Control_Pane, Kasa_Control_Pane).
2. WHEN the user opens the PanePicker on a custom tab, THE PanePicker SHALL display connector control panes alongside other available pane types.
3. WHEN the user selects a connector control pane from the PanePicker, THE PanePicker SHALL add the pane to the active tab with the default size and configuration defined in the Pane_Registry entry.

### Requirement 8: ConnectorsPage as Single Entry Point

**User Story:** As a user, I want the Connectors page to be the single place where I manage all connector lifecycle operations, so that I have a consistent experience regardless of which connector I'm using.

#### Acceptance Criteria

1. THE ConnectorsPage SHALL display all available connector types with their metadata, config schemas, and setup requirement badges.
2. THE ConnectorsPage SHALL display all enabled connector instances with health status, device count, last seen time, and error messages.
3. WHEN a connector requires setup, THE ConnectorsPage SHALL launch the generic Setup_Wizard after the connector is enabled.
4. THE ConnectorsPage SHALL provide disable and retry controls for each enabled connector instance.
5. THE ConnectorsPage SHALL refresh connector status automatically after setup completion, enable, disable, or retry operations.
