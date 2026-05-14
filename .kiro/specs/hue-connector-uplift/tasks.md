# Implementation Plan: Hue Connector Uplift

## Overview

Uplift the Philips Hue connector from a basic toggle/brightness controller into a capability-aware system. Implementation proceeds bottom-up: pure CapabilityMapper module, enhanced HueConnector class with new action types and Zigbee search, REST endpoints, frontend component uplift with capability-driven controls, and finally documentation and metadata updates. The existing connector behavior is preserved throughout.

## Tasks

- [x] 1. Implement the CapabilityMapper pure module
  - [x] 1.1 Create `src/connectors/hue/capability-mapper.ts` with types and `mapTypeToCapabilities`
    - Define `HueCapability` type: `"on/off" | "brightness" | "color" | "color-temperature"`
    - Define `CapabilitySet` interface with `capabilities`, `hasColor`, `hasColorTemp`, `hasBrightness` fields
    - Define `RawHueLight` interface matching the Hue bridge API response shape (state, type, name, modelid, manufacturername, uniqueid, swversion, capabilities, config)
    - Implement `mapTypeToCapabilities(type: string): CapabilitySet` with the mapping table:
      - `"Extended color light"` → on/off, brightness, color, color-temperature
      - `"Color temperature light"` → on/off, brightness, color-temperature
      - `"Dimmable light"` → on/off, brightness
      - `"On/Off plug-in unit"` / `"On/Off light"` → on/off only
      - Unknown/unrecognized → on/off, brightness (safe default)
    - Derive boolean helpers (`hasColor`, `hasColorTemp`, `hasBrightness`) from the capabilities array
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Implement `extractDeviceState` and clamping helpers in `capability-mapper.ts`
    - Implement `extractDeviceState(rawLight: RawHueLight, capabilitySet: CapabilitySet): Record<string, unknown>`
    - Always include: `on`, `reachable`, `lightType`, `modelId`, `manufacturer`, `archetype`
    - Include `brightness` when `hasBrightness` is true
    - Include `hue`, `saturation`, `colorMode`, `gamutType` only when `hasColor` is true
    - Include `ct`, `ctMin`, `ctMax` only when `hasColorTemp` is true
    - Implement `clampHue(value: number): number` → clamp to [0, 65535]
    - Implement `clampSaturation(value: number): number` → clamp to [0, 254]
    - Implement `clampCt(value: number, ctMin: number, ctMax: number): number` → clamp to [ctMin, ctMax]
    - Export all functions
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.4, 4.4_

  - [ ]* 1.3 Write property test — Property 1: Capability mapping always produces valid result with on/off
    - Create `src/connectors/hue/__tests__/capability-mapper.property.test.ts`
    - Generate arbitrary strings (mix of known Hue types and random strings) using fast-check
    - Assert: result always contains `"on/off"` in capabilities array
    - Assert: capabilities array is never empty
    - Assert: for unknown types, result is exactly `["on/off", "brightness"]`
    - Use `{ numRuns: 100 }` minimum
    - **Property 1: Capability mapping always produces a valid result with on/off**
    - **Validates: Requirements 1.1, 1.6**

  - [ ]* 1.4 Write property test — Property 2: Color state fields present iff color capability
    - Generate arbitrary `RawHueLight` objects with varying types using fast-check
    - Assert: when capability set includes `"color"`, output of `extractDeviceState` includes `hue`, `saturation`, `colorMode`, `gamutType`
    - Assert: when capability set does NOT include `"color"`, those fields are absent
    - **Property 2: Color state fields present if and only if color capability**
    - **Validates: Requirements 2.2, 2.4**

  - [ ]* 1.5 Write property test — Property 3: Color temperature state fields present iff color-temperature capability
    - Generate arbitrary `RawHueLight` objects with varying types using fast-check
    - Assert: when capability set includes `"color-temperature"`, output includes `ct`, `ctMin`, `ctMax`
    - Assert: when capability set does NOT include `"color-temperature"`, those fields are absent
    - **Property 3: Color temperature state fields present if and only if color-temperature capability**
    - **Validates: Requirements 2.3, 2.5**

  - [ ]* 1.6 Write property test — Property 5: Color values are clamped to valid range
    - Generate arbitrary integers (including negatives and values exceeding max) using fast-check
    - Assert: `clampHue(value)` is always in [0, 65535]
    - Assert: `clampSaturation(value)` is always in [0, 254]
    - Assert: clamped value equals `Math.max(0, Math.min(value, maxValue))`
    - **Property 5: Color values are clamped to valid range**
    - **Validates: Requirements 3.4**

  - [ ]* 1.7 Write property test — Property 6: Color temperature values are clamped to light's supported range
    - Generate arbitrary integer ct values and random ctMin/ctMax ranges using fast-check
    - Assert: `clampCt(value, ctMin, ctMax)` is always in [ctMin, ctMax]
    - Assert: clamped value equals `Math.max(ctMin, Math.min(value, ctMax))`
    - **Property 6: Color temperature values are clamped to light's supported range**
    - **Validates: Requirements 4.4**

- [x] 2. Checkpoint — Verify CapabilityMapper
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Enhance HueConnector with capability mapping and new action types
  - [x] 3.1 Update `discoverDevices()` to use CapabilityMapper
    - Import `mapTypeToCapabilities` and `extractDeviceState` from `capability-mapper.ts`
    - Update the `HueLight` interface to include full raw fields (hue, sat, ct, colormode, type, capabilities, config)
    - For each light, call `mapTypeToCapabilities(light.type)` to get the capability set
    - Call `extractDeviceState(light, capabilitySet)` to build the enriched state object
    - Set `device.capabilities` to the capability set's capabilities array
    - Preserve the device ID format `hue-light-{index}` for backward compatibility
    - Store capability sets in an internal map for action validation
    - _Requirements: 1.1, 2.1, 8.4_

  - [x] 3.2 Extend `execute()` with color and color-temperature action types
    - Add capability validation: before executing any action, check the device's capability set
    - Reject actions for unsupported capabilities with descriptive error messages
    - Add `"color"` case: extract `hue` and `saturation` from params, clamp values, send `{ hue, sat }` to bridge
    - Add `"color-temp"` case: extract `ct` from params, look up device's ctMin/ctMax, clamp value, send `{ ct }` to bridge
    - Preserve existing `"toggle"` and `"brightness"` behavior unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 8.1, 8.2_

  - [x] 3.3 Implement `searchForNewLights()` and `getSearchStatus()` methods
    - Add `ZigbeeSearchState` interface to track search progress
    - Implement `searchForNewLights()`: POST to `/api/{key}/lights` to start scan
    - Poll `GET /api/{key}/lights/new` at ~5 second intervals until scan completes (~40s)
    - On completion, trigger `discoverDevices()` to incorporate new lights
    - Return search results with count and names of new lights
    - Implement `getSearchStatus()`: return current `ZigbeeSearchState`
    - Handle errors: return descriptive error if POST fails, log and retry on poll failures
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 3.4 Enhance `connect()` and `getHealthStatus()` with firmware update detection
    - In `connect()`, also fetch `GET /api/{key}/config` and read `swupdate2` object
    - Determine update availability from `swupdate2.state` ("anyreadytoinstall" or "allreadytoinstall")
    - Derive `updateType`: "bridge" (only bridge.state ready), "lights" (only device updates), "both"
    - Extend `getHealthStatus()` return type to include `updatesAvailable` and `updateType` fields
    - When `swupdate2` field is missing, treat as no updates available
    - _Requirements: 12.1, 12.2_

  - [ ]* 3.5 Write property test — Property 4: Action acceptance is gated by capability
    - Create `src/connectors/hue/__tests__/hue-connector.property.test.ts`
    - Generate random (device capability set, action type) pairs using fast-check
    - Assert: action is accepted iff device's capability set includes the required capability
    - Assert: "toggle" always accepted (on/off always present), "brightness" requires "brightness", "color" requires "color", "color-temp" requires "color-temperature"
    - Assert: rejected actions throw descriptive errors
    - **Property 4: Action acceptance is gated by capability**
    - **Validates: Requirements 3.1, 3.2, 4.1, 4.2, 8.1, 8.2**

  - [ ]* 3.6 Write property test — Property 7: Device ID format is preserved across discovery
    - Generate random string indices using fast-check
    - Assert: generated device ID always matches format `hue-light-{index}` where index is the exact string key
    - **Property 7: Device ID format is preserved across discovery**
    - **Validates: Requirements 8.4**

  - [ ]* 3.7 Write property test — Property 8: Firmware update status correctly derived from swupdate2
    - Generate random `swupdate2` state objects using fast-check
    - Assert: when state is "anyreadytoinstall" or "allreadytoinstall", `updatesAvailable` is true
    - Assert: `updateType` is "bridge" when only bridge.state indicates readiness, "lights" when only device updates pending, "both" when both ready
    - Assert: when no updates available, `updatesAvailable` is false or absent
    - **Property 8: Firmware update status correctly derived from swupdate2**
    - **Validates: Requirements 12.2**

- [x] 4. Checkpoint — Verify HueConnector enhancements
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add REST endpoints for Zigbee light search
  - [x] 5.1 Add search-lights routes to `src/api/routes/connector.routes.ts`
    - Add `POST /api/connectors/:id/search-lights` — validate connector is Hue type, call `searchForNewLights()`, return initial status
    - Add `GET /api/connectors/:id/search-lights/status` — call `getSearchStatus()`, return current progress and results
    - Handle errors: return 404 if connector not found, 400 if connector doesn't support search, 500 on bridge errors
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 5.2 Write unit tests for search-lights endpoints
    - Create tests in `src/api/routes/__tests__/connector.routes.test.ts` (or extend existing)
    - Test POST initiates search and returns 200 with status
    - Test GET returns current search state
    - Test 404 for unknown connector, 400 for non-Hue connector
    - _Requirements: 5.1, 5.5_

- [x] 6. Uplift frontend HueControlPane with capability-based controls
  - [x] 6.1 Refactor `HueControlPane.tsx` with capability-driven rendering
    - Replace the `isColorLight()` heuristic with reading `device.capabilities` array from state
    - Render controls conditionally based on capabilities:
      - Always: toggle button
      - If `"brightness"` in capabilities: brightness slider
      - If `"color-temperature"` in capabilities: ColorTempSlider component
      - If `"color"` in capabilities: color picker
    - Add type badge showing the light type (e.g., "Color", "Dimmable", "On/Off")
    - Add reachability indicator: grey out entire card when `state.reachable` is false
    - Display model info in each light card header
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 6.2 Create `ColorTempSlider` component
    - Create `frontend/src/components/panes/hue/ColorTempSlider.tsx`
    - Accept props: `deviceId`, `currentCt`, `ctMin`, `ctMax`, `disabled`
    - Render a range slider from ctMin (cool/blue) to ctMax (warm/orange) with gradient background
    - On change, call `sendAction(deviceId, "color-temp", { ct: value })`
    - Use Tailwind for styling, match existing slider patterns
    - _Requirements: 6.3, 4.1_

  - [x] 6.3 Implement `SearchLightsButton` and search progress UI
    - Create `frontend/src/components/panes/hue/SearchLightsButton.tsx`
    - Display "Search for new lights" button with Lucide `Search` icon
    - On click, POST to `/api/connectors/:id/search-lights`
    - Show progress indicator with countdown timer (~40 seconds)
    - Poll `GET /api/connectors/:id/search-lights/status` every 3 seconds
    - On completion: show names of newly discovered lights, or "No new lights found" message
    - Disable button while search is in progress
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 6.4 Implement `FirmwareUpdateBanner` component
    - Create `frontend/src/components/panes/hue/FirmwareUpdateBanner.tsx`
    - Accept props: `updatesAvailable`, `updateType`
    - When `updatesAvailable` is true, render a non-intrusive info banner:
      - "Bridge firmware update available — open the Hue app to install"
      - "Light updates available — open the Hue app to install"
      - "Bridge and light updates available — open the Hue app to install"
    - Use Lucide `AlertCircle` or `Info` icon, Tailwind amber/blue styling
    - Do not block normal operation — informational only
    - When no updates available, render nothing
    - _Requirements: 12.3, 12.4, 12.5_

  - [ ]* 6.5 Write unit tests for HueControlPane capability rendering
    - Create `frontend/src/components/panes/__tests__/HueControlPane.test.tsx`
    - Test: on/off-only device renders only toggle
    - Test: dimmable device renders toggle + brightness slider
    - Test: color-temp device renders toggle + brightness + color-temp slider
    - Test: color device renders all controls
    - Test: unreachable device is visually greyed out
    - Test: firmware banner shows/hides based on health status
    - Test: search button disabled during active search
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.5, 12.3, 12.5_

- [x] 7. Checkpoint — Verify frontend components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Setup wizard prerequisites and documentation
  - [x] 8.1 Add prerequisites panel to setup wizard discover-bridges step
    - Update `getSetupSteps()` in `hue-connector.ts` to include a prerequisites section in the discover-bridges step description
    - List what user needs: Hue bridge on same LAN, new lights powered on within Zigbee range, bridge reachable from Aeolus device
    - State what Aeolus handles: auto-discovery, link-button pairing, Zigbee search, full light control, 60s polling
    - State what Aeolus does NOT handle: factory-resetting lights paired to another bridge, firmware updates, Entertainment zones
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 8.2 Update connector metadata description
    - Update `metadata.description` in `src/connectors/hue/index.ts` to mention that lights must be on the bridge or use the built-in search feature to add new ones
    - _Requirements: 11.5_

  - [x] 8.3 Update comprehensive documentation
    - Add a "Hue Connector Prerequisites" subsection to the Hue Connector section in `docs/COMPREHENSIVE_DOCUMENTATION.md`
    - Document the full scope: what Aeolus does and does not handle for Hue
    - Document new capabilities: color control, color temperature, Zigbee search, firmware awareness
    - _Requirements: 11.4_

- [x] 9. Add connector snippets for new action types
  - [x] 9.1 Add color and color-temp snippets to `src/connectors/hue/index.ts`
    - Add a "Set Color" snippet demonstrating `devices.action("hue-light-1", "color", { hue: 21845, saturation: 254 })`
    - Add a "Set Color Temperature" snippet demonstrating `devices.action("hue-light-1", "color-temp", { ct: 300 })`
    - Add a UI snippet for color temperature slider
    - Preserve all existing snippets unchanged
    - _Requirements: 8.5_

- [x] 10. Final checkpoint — Verify full integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Optional: Light Groups support (Requirement 9)
  - [ ] 11.1 Implement group discovery and group-action execution
    - Fetch groups from `GET /api/{key}/groups` during discovery
    - Expose group membership as metadata on each light's device state
    - Implement `"group-action"` action type that applies actions to all lights in a group
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 12. Optional: Scenes support (Requirement 10)
  - [ ] 12.1 Implement scene listing and scene activation
    - Fetch scenes from `GET /api/{key}/scenes` during discovery
    - Provide list of available scenes with names and associated groups
    - Implement `"scene"` action type that activates a scene via PUT to group endpoint
    - _Requirements: 10.1, 10.2, 10.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The CapabilityMapper is a pure module ideal for property-based testing (no side effects, deterministic)
- Existing toggle/brightness behavior must remain unchanged throughout (backward compatibility)
- TypeScript, Vitest, fast-check, React, Zustand, Tailwind, and Lucide are the established stack
