# Implementation Plan: Connector UI System

## Overview

Replace the hardcoded connector setup and standalone LightingPage with a fully generic, backend-driven setup wizard and connector-provided control panes. The implementation proceeds backend-first (new API endpoint), then frontend API client, then generic wizard refactor, then control panes, then pane registry + default layout cleanup, and finally removal of legacy code.

## Tasks

- [ ] 1. Add backend setup-steps endpoint and ConnectorManager method
  - [-] 1.1 Add `getSetupSteps()` method to ConnectorManager
    - Add method that takes an `instanceId`, looks up the managed instance, and returns `instance.connector.getSetupSteps?.() ?? []`
    - Throw if instance not found
    - _Requirements: 1.1, 1.2_

  - [~] 1.2 Add `GET /api/connectors/:id/setup-steps` route to `connector.routes.ts`
    - Delegate to `connectorManager.getSetupSteps(id)`
    - Return 404 with descriptive message if instance not found
    - Return `[]` if connector doesn't implement `getSetupSteps()`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.3 Write unit tests for the setup-steps endpoint
    - Test 200 with steps array for a connector that implements `getSetupSteps()`
    - Test 200 with empty array for a connector without `getSetupSteps()`
    - Test 404 for non-existent instance ID
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 1.4 Write property test for setup steps API faithfulness
    - **Property 1: Setup steps API faithfully returns connector steps**
    - Generate random `SetupStepDescriptor[]` arrays, mock a connector returning them, call the route, assert response matches
    - **Validates: Requirements 1.1, 1.2, 1.4**

- [ ] 2. Add frontend API client functions
  - [~] 2.1 Add `fetchSetupSteps()` and `patchConnectorConfig()` to `api-client.ts`
    - `fetchSetupSteps(connectorId)` → `GET /api/connectors/${connectorId}/setup-steps`
    - `patchConnectorConfig(connectorId, config)` → `PATCH /api/connectors/${connectorId}` with `{ config }`
    - _Requirements: 2.1, 3.1_

- [ ] 3. Refactor ConnectorsPage and SetupWizard to be fully generic
  - [~] 3.1 Remove `getSetupStepsForType()` from ConnectorsPage and fetch steps from backend
    - Delete the `getSetupStepsForType()` helper function at the bottom of `ConnectorsPage.tsx`
    - In `handleEnableSubmit`, after enabling a connector with `requiresSetup: true`, call `fetchSetupSteps(result.id)` to get steps from the backend
    - Pass fetched steps to `SetupWizard`
    - _Requirements: 2.1, 2.7_

  - [~] 3.2 Add accumulated data propagation and config patching to SetupWizard
    - Merge each step's `result.data` into a running `accumulatedConfig` object
    - Pass accumulated data as params to subsequent step executions
    - On `complete: true`, call `patchConnectorConfig(connectorId, accumulatedConfig)` before calling `onComplete()`
    - On `success: false`, display error message and stay on current step
    - _Requirements: 2.3, 2.4, 2.5, 3.1, 3.2, 3.3_

  - [ ]* 3.3 Write property test for wizard data accumulation
    - **Property 4: Wizard accumulates data across steps**
    - Generate random sequences of `SetupStepResult` objects with `data` fields, simulate wizard step execution, assert accumulated params contain all prior data keys
    - **Validates: Requirements 3.2**

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement HueControlPane component
  - [~] 5.1 Create `HueControlPane.tsx` in `frontend/src/components/panes/`
    - Read devices from `useDeviceStore` filtering `integration === "hue"` and `type === "light"`
    - Render responsive grid of light cards with: name, on/off toggle, online/offline badge, brightness slider, colour picker for color-capable lights
    - Toggle sends `POST /api/devices/:id/action` with `{ type: "toggle" }` and optimistically flips `state.on`
    - Brightness slider tracks local value during drag, sends `{ type: "brightness", params: { brightness } }` on release only
    - Colour picker shows preset swatches, sends `{ type: "color", params: { hue, saturation } }` on swatch click
    - Colour capability detected by checking if device type string contains "color" or "extended" (case-insensitive)
    - Show empty state message when no Hue lights found
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8_

  - [ ]* 5.2 Write property test for Hue control pane device filtering
    - **Property 5: Hue control pane renders exactly the Hue lights from the device store**
    - Generate random device store states with mixed integrations/types, render HueControlPane, assert card count equals count of devices with `integration=hue AND type=light`
    - **Validates: Requirements 4.1, 4.7**

  - [ ]* 5.3 Write property test for colour picker visibility
    - **Property 7: Colour picker visibility determined by device type**
    - Generate random device type strings, apply the `isColorLight()` function, assert it returns true iff the string contains "color" or "extended" (case-insensitive)
    - **Validates: Requirements 4.5**

- [ ] 6. Implement KasaControlPane component
  - [~] 6.1 Create `KasaControlPane.tsx` in `frontend/src/components/panes/`
    - Read devices from `useDeviceStore` filtering `integration === "kasa"`
    - Render responsive grid of device cards with: name, on/off toggle, online badge, device type badge (plug/light/switch)
    - Toggle sends `POST /api/devices/:id/action` with `{ type: "toggle" }` and optimistically flips `state.on`
    - If device state contains energy monitoring fields (`voltage`, `current`, `power`, `totalConsumption`), display energy stats section
    - Show empty state message when no Kasa devices found
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7_

  - [ ]* 6.2 Write property test for Kasa control pane device filtering
    - **Property 8: Kasa control pane renders exactly the Kasa devices from the device store**
    - Generate random device store states with mixed integrations, render KasaControlPane, assert card count equals count of devices with `integration=kasa`
    - **Validates: Requirements 5.1, 5.6**

  - [ ]* 6.3 Write property test for Kasa energy stats conditional display
    - **Property 10: Kasa energy stats displayed conditionally**
    - Generate random Kasa device states with/without energy fields, render card, assert energy stats section presence matches field presence
    - **Validates: Requirements 5.4**

- [ ] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Update pane registry and clean default layout
  - [~] 8.1 Update pane registry: replace `hue-lights` with `hue-control`, add `kasa-control`
    - Remove the `"hue-lights"` entry and its `HueLightsPane` import from `pane-registry.ts`
    - Add `"hue-control"` entry: component `HueControlPane`, displayName `"Hue Lights"`, icon `"lightbulb"`, defaultSize `{ w: 12, h: 6 }`
    - Add `"kasa-control"` entry: component `KasaControlPane`, displayName `"Kasa Devices"`, icon `"plug"`, defaultSize `{ w: 12, h: 6 }`
    - _Requirements: 4.6, 5.5, 7.1, 7.2_

  - [~] 8.2 Clean default layout in `dashboard.ts`
    - Remove the `"default-lighting"` tab from `DEFAULT_TABS` (keep only 4 pinned tabs)
    - Set `DEFAULT_PANES` to an empty array `[]`
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 8.3 Write property test for PanePicker default sizes
    - **Property 11: PanePicker creates panes with registry default sizes**
    - Generate random pane type selections from PANE_REGISTRY keys, call `addPane()`, assert resulting pane dimensions match registry defaults
    - **Validates: Requirements 7.3**

- [ ] 9. Remove legacy LightingPage and HueLightsPane
  - [~] 9.1 Delete `LightingPage.tsx` and `HueLightsPane.tsx`
    - Delete `frontend/src/components/LightingPage.tsx`
    - Delete `frontend/src/components/panes/HueLightsPane.tsx`
    - Remove any remaining imports of `LightingPage` or `HueLightsPane` from other files (verify `App.tsx`, `pane-registry.ts`)
    - _Requirements: 6.5_

- [ ] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The design uses TypeScript throughout — all implementation tasks use TypeScript/React
