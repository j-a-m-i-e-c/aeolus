# Design Document: Hue Connector Uplift

## Overview

This design uplifts the Philips Hue connector from a basic toggle/brightness controller into a capability-aware system that detects light types, exposes type-appropriate actions (color, color temperature), enables Zigbee light search, and renders capability-driven UI controls. The uplift preserves full backward compatibility with existing automations and the pairing wizard.

The key architectural change is introducing a **capability mapping layer** between the raw Hue bridge API response and the Aeolus device model. Each light's `type` string is mapped to a `CapabilitySet` that gates which actions are valid and which UI controls render.

## Architecture

```mermaid
graph TD
    subgraph "Hue Bridge (Local API v1)"
        B["/api/{key}/lights"]
        BC["/api/{key}/config"]
        BN["/api/{key}/lights/new"]
    end

    subgraph "Backend (src/connectors/hue/)"
        CM[CapabilityMapper] --> HC[HueConnector]
        HC -->|GET /lights| B
        HC -->|GET /config| BC
        HC -->|POST /lights & GET /lights/new| BN
        HC -->|PUT /lights/{id}/state| B
    end

    subgraph "REST API"
        EP1["POST /api/devices/:id/action"]
        EP2["POST /api/connectors/:id/search-lights"]
        EP3["GET /api/connectors/:id/search-lights/status"]
    end

    subgraph "Frontend"
        HCP[HueControlPane] --> LCC[LightCard]
        LCC --> TC[ToggleControl]
        LCC --> BS[BrightnessSlider]
        LCC --> CTS[ColorTempSlider]
        LCC --> CP[ColorPicker]
        HCP --> SLB[SearchLightsButton]
        HCP --> FWB[FirmwareUpdateBanner]
    end

    EP1 --> HC
    EP2 --> HC
    HCP -->|sendAction| EP1
    HCP -->|searchLights| EP2
```

### Flow Summary

1. **Discovery**: `discoverDevices()` fetches all lights, runs each through `CapabilityMapper`, and returns enriched `Device` objects with capability-specific state fields.
2. **Action Execution**: `execute(action)` validates the action type against the target device's `CapabilitySet` before forwarding to the bridge. Invalid actions are rejected with descriptive errors.
3. **Zigbee Search**: A new `searchForNewLights()` method POSTs to the bridge to start a scan, then polls `/lights/new` until complete (~40s). A new REST endpoint exposes this to the frontend.
4. **Firmware Awareness**: `connect()` and periodic polls read `swupdate2` from bridge config and surface update availability in the connector health status.
5. **Frontend**: `HueControlPane` reads each device's `capabilities` array to conditionally render controls. A search button triggers the Zigbee scan endpoint.

## Components and Interfaces

### CapabilityMapper (new module)

A pure function module at `src/connectors/hue/capability-mapper.ts` responsible for mapping Hue light types to capability sets and extracting type-appropriate state.

```typescript
// src/connectors/hue/capability-mapper.ts

export type HueCapability = "on/off" | "brightness" | "color" | "color-temperature";

export interface CapabilitySet {
  capabilities: HueCapability[];
  hasColor: boolean;
  hasColorTemp: boolean;
  hasBrightness: boolean;
}

/**
 * Maps a Hue bridge light `type` string to a CapabilitySet.
 * Unknown types default to on/off + brightness (safe fallback).
 */
export function mapTypeToCapabilities(type: string): CapabilitySet;

/**
 * Extracts capability-appropriate state fields from a raw Hue light object.
 * Only includes color/ct fields when the capability set permits.
 */
export function extractDeviceState(
  rawLight: RawHueLight,
  capabilitySet: CapabilitySet,
): Record<string, unknown>;
```

### Enhanced HueConnector class

The existing `HueConnector` class gains:

| Method | Purpose |
|--------|---------|
| `discoverDevices()` | Enhanced to use `CapabilityMapper`, include type-specific state fields |
| `execute(action)` | Extended with `"color"` and `"color-temp"` action types, validates against capabilities |
| `searchForNewLights()` | New — starts Zigbee scan, polls for results, triggers re-discovery |
| `getSearchStatus()` | New — returns current search progress/results |
| `connect()` | Enhanced to also read `swupdate2` from bridge config |
| `getHealthStatus()` | Enhanced to include `updatesAvailable` and `updateType` fields |

### New REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/connectors/:id/search-lights` | POST | Start Zigbee light search |
| `/api/connectors/:id/search-lights/status` | GET | Poll search progress and results |

### Frontend Component Hierarchy

```
HueControlPane
├── FirmwareUpdateBanner (conditional — only when updates available)
├── SearchLightsButton + SearchProgressModal
└── LightGrid
    └── LightCard (per light)
        ├── LightHeader (name, type badge, reachable indicator)
        ├── ToggleControl (all lights)
        ├── BrightnessSlider (if hasBrightness)
        ├── ColorTempSlider (if hasColorTemp)
        └── ColorPicker (if hasColor)
```

## Data Models

### Raw Hue Bridge Light (API response shape)

```typescript
/** Shape returned by GET /api/{key}/lights/{id} from the Hue bridge */
interface RawHueLight {
  state: {
    on: boolean;
    bri: number;
    hue?: number;
    sat?: number;
    ct?: number;
    colormode?: "hs" | "ct" | "xy";
    reachable: boolean;
  };
  type: string; // "Extended color light" | "Color temperature light" | "Dimmable light" | "On/Off plug-in unit" | "On/Off light"
  name: string;
  modelid: string;
  manufacturername: string;
  uniqueid: string;
  swversion: string;
  capabilities?: {
    control?: {
      ct?: { min: number; max: number };
      colorgamuttype?: "A" | "B" | "C";
    };
  };
  config?: {
    archetype?: string;
  };
}
```

### Enhanced Aeolus Device State (produced by connector)

```typescript
/** The Device.state shape produced by the uplifted HueConnector */
interface HueDeviceState {
  // Always present
  on: boolean;
  reachable: boolean;
  lightType: string;        // Raw type string from bridge
  modelId: string;
  manufacturer: string;
  archetype: string;

  // Present when hasBrightness
  brightness?: number;      // 0-254

  // Present when hasColor
  hue?: number;             // 0-65535
  saturation?: number;      // 0-254
  colorMode?: "hs" | "ct" | "xy";
  gamutType?: "A" | "B" | "C";

  // Present when hasColorTemp
  ct?: number;              // Current mirek value
  ctMin?: number;           // Minimum mirek (coldest, e.g. 153)
  ctMax?: number;           // Maximum mirek (warmest, e.g. 500)
}
```

### Capability Mapping Table

| Hue Bridge `type` | Capabilities | State Fields |
|---|---|---|
| `"Extended color light"` | on/off, brightness, color, color-temperature | All fields |
| `"Color temperature light"` | on/off, brightness, color-temperature | Base + brightness + ct fields |
| `"Dimmable light"` | on/off, brightness | Base + brightness |
| `"On/Off plug-in unit"` | on/off | Base only |
| `"On/Off light"` | on/off | Base only |
| Unknown / unrecognized | on/off, brightness | Base + brightness (safe default) |

### Action Types

```typescript
/** Extended action types supported by the uplifted connector */
type HueActionType = "toggle" | "brightness" | "color" | "color-temp";

/** Color action params */
interface ColorActionParams {
  hue: number;        // 0-65535
  saturation: number; // 0-254
}

/** Color temperature action params */
interface ColorTempActionParams {
  ct: number;         // Mirek value within light's ctMin-ctMax range
}
```

### Zigbee Search State

```typescript
interface ZigbeeSearchState {
  active: boolean;
  startedAt: number | null;
  newLights: Array<{ id: string; name: string }>;
  error: string | null;
}
```

### Connector Health Extension

```typescript
/** Extended health status with firmware update awareness */
interface HueHealthStatus extends ConnectorHealthStatus {
  updatesAvailable?: boolean;
  updateType?: "bridge" | "lights" | "both";
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Capability mapping always produces a valid result with on/off

*For any* string passed to `mapTypeToCapabilities`, the returned `CapabilitySet` SHALL always contain `"on/off"` in its capabilities array, and the array SHALL never be empty. For any string not in the set of known Hue light types, the result SHALL be exactly `["on/off", "brightness"]`.

**Validates: Requirements 1.1, 1.6**

### Property 2: Color state fields present if and only if color capability

*For any* `RawHueLight` object and its derived `CapabilitySet`, the output of `extractDeviceState` SHALL include `hue`, `saturation`, `colorMode`, and `gamutType` fields if and only if the capability set includes `"color"`. When the capability set does not include `"color"`, those fields SHALL be absent from the output.

**Validates: Requirements 2.2, 2.4**

### Property 3: Color temperature state fields present if and only if color-temperature capability

*For any* `RawHueLight` object and its derived `CapabilitySet`, the output of `extractDeviceState` SHALL include `ct`, `ctMin`, and `ctMax` fields if and only if the capability set includes `"color-temperature"`. When the capability set does not include `"color-temperature"`, those fields SHALL be absent from the output.

**Validates: Requirements 2.3, 2.5**

### Property 4: Action acceptance is gated by capability

*For any* device and action type pair, the connector SHALL accept the action if and only if the device's capability set includes the required capability for that action type. Specifically: `"toggle"` requires `"on/off"` (always present), `"brightness"` requires `"brightness"`, `"color"` requires `"color"`, and `"color-temp"` requires `"color-temperature"`. Actions for unsupported capabilities SHALL be rejected with a descriptive error.

**Validates: Requirements 3.1, 3.2, 4.1, 4.2, 8.1, 8.2**

### Property 5: Color values are clamped to valid range

*For any* integer values of hue and saturation (including negative and values exceeding the maximum), after clamping, the hue value SHALL be in the range [0, 65535] and the saturation value SHALL be in the range [0, 254]. The clamped value SHALL equal `max(0, min(value, maxValue))`.

**Validates: Requirements 3.4**

### Property 6: Color temperature values are clamped to light's supported range

*For any* integer ct value and any light with a defined ctMin and ctMax range, after clamping, the ct value SHALL be in the range [ctMin, ctMax]. The clamped value SHALL equal `max(ctMin, min(ct, ctMax))`.

**Validates: Requirements 4.4**

### Property 7: Device ID format is preserved across discovery

*For any* light index returned by the Hue bridge, the generated device ID SHALL always follow the format `hue-light-{index}` where `{index}` is the exact string key from the bridge's lights object.

**Validates: Requirements 8.4**

### Property 8: Firmware update status correctly derived from swupdate2

*For any* `swupdate2` object from the bridge config, when `state` is `"anyreadytoinstall"` or `"allreadytoinstall"`, the connector health SHALL report `updatesAvailable: true`. The `updateType` SHALL be `"bridge"` when only `swupdate2.bridge.state` indicates readiness, `"lights"` when only device updates are pending, and `"both"` when both are ready. When no updates are available, `updatesAvailable` SHALL be `false` or absent.

**Validates: Requirements 12.2**

## Error Handling

| Scenario | Error Source | Handling Strategy | User-Facing Message |
|----------|-------------|-------------------|---------------------|
| Bridge unreachable during connect | Network / fetch | Set health to `"disconnected"`, throw to ConnectorManager | "Hue bridge unreachable at {ip}" |
| Bridge unreachable during poll | Network / fetch | Set health to `"disconnected"`, log warning, skip cycle | Health indicator turns red |
| Color action on non-color light | Capability validation | Reject with Error, do not call bridge | "Light '{name}' does not support color (type: {type})" |
| Color-temp action on non-ct light | Capability validation | Reject with Error, do not call bridge | "Light '{name}' does not support color temperature (type: {type})" |
| Brightness action on on/off-only light | Capability validation | Reject with Error, do not call bridge | "Light '{name}' does not support brightness (type: {type})" |
| Unknown action type | Action dispatch | Reject with Error | "Unsupported action type: {type}" |
| Unknown device ID | Device map lookup | Reject with Error | "Unknown Hue device: {deviceId}" |
| Hue/sat values out of range | Input validation | Clamp silently, log debug | No user message (auto-corrected) |
| CT value out of range | Input validation | Clamp silently, log debug | No user message (auto-corrected) |
| Zigbee search POST fails | Bridge API | Return error result | "Could not start light search: {reason}" |
| Zigbee search poll fails | Bridge API | Log warning, retry next interval | Search continues, error logged |
| Bridge returns non-JSON | Response parsing | Set health to `"degraded"`, log error | "Unexpected response from Hue bridge" |
| swupdate2 field missing from config | Bridge API version | Treat as no updates available | No banner shown |
| Light unreachable (reachable: false) | Bridge reports | Include in device state, UI greys out | "offline" badge on light card |

## Testing Strategy

### Property-Based Tests (Vitest + fast-check)

The project uses Vitest (`vitest.config.ts` exists at root). Property-based tests will use `fast-check` with Vitest.

Each property test runs a minimum of **100 iterations** and is tagged with a comment referencing the design property.

| Property | Test File | What's Generated |
|----------|-----------|-----------------|
| P1: Capability mapping validity | `src/connectors/hue/__tests__/capability-mapper.property.test.ts` | Random strings (known types + arbitrary) |
| P2: Color state field inclusion | `src/connectors/hue/__tests__/capability-mapper.property.test.ts` | Random RawHueLight objects with varying types |
| P3: CT state field inclusion | `src/connectors/hue/__tests__/capability-mapper.property.test.ts` | Random RawHueLight objects with varying types |
| P4: Action acceptance gating | `src/connectors/hue/__tests__/hue-connector.property.test.ts` | Random (device capability, action type) pairs |
| P5: Color value clamping | `src/connectors/hue/__tests__/capability-mapper.property.test.ts` | Random integers (including negatives, large values) |
| P6: CT value clamping | `src/connectors/hue/__tests__/capability-mapper.property.test.ts` | Random integers + random ctMin/ctMax ranges |
| P7: Device ID format | `src/connectors/hue/__tests__/hue-connector.property.test.ts` | Random string indices |
| P8: Firmware update derivation | `src/connectors/hue/__tests__/hue-connector.property.test.ts` | Random swupdate2 state objects |

**Configuration:**
- Library: `fast-check` (well-maintained, TypeScript-native)
- Iterations: `{ numRuns: 100 }` minimum per property
- Tag format: `// Feature: hue-connector-uplift, Property {N}: {title}`

### Unit Tests (Example-Based)

| Area | Test File | Coverage |
|------|-----------|----------|
| Known type mappings (1.2–1.5) | `src/connectors/hue/__tests__/capability-mapper.test.ts` | Each known type → exact capability set |
| Action execution (toggle, brightness) | `src/connectors/hue/__tests__/hue-connector.test.ts` | Backward compat with mocked fetch |
| Zigbee search flow | `src/connectors/hue/__tests__/hue-connector.test.ts` | POST/poll/complete cycle with mocked fetch |
| Setup wizard steps | `src/connectors/hue/__tests__/hue-connector.test.ts` | Discover + pair flows |
| Error scenarios | `src/connectors/hue/__tests__/hue-connector.test.ts` | Each row in error handling table |

### Frontend Component Tests

| Component | Test File | Coverage |
|-----------|-----------|----------|
| Capability-based rendering (6.1–6.4) | `frontend/src/components/panes/__tests__/HueControlPane.test.tsx` | Each capability level renders correct controls |
| Search UI states (7.1–7.5) | `frontend/src/components/panes/__tests__/HueControlPane.test.tsx` | Button, progress, results, empty state |
| Firmware banner (12.3–12.5) | `frontend/src/components/panes/__tests__/HueControlPane.test.tsx` | Banner presence/absence based on health |

### Integration Tests

| Scenario | Approach |
|----------|----------|
| Full discovery → device registry | Mock Hue bridge HTTP, verify Device objects in registry |
| Zigbee search end-to-end | Mock Hue bridge HTTP, verify timing and re-discovery |
| Setup wizard pairing | Mock bridge + meethue discovery, verify config stored |
