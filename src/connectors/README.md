# Connector Developer Guide

Build connectors to integrate external device ecosystems into Aeolus. A connector bridges the gap between a third-party protocol (Hue, Kasa, Zigbee, Z-Wave, etc.) and the Aeolus device model — no backend core file changes required. Connector devices automatically appear in the Device Grid and can be targeted by automations. For connector-specific controls (colour pickers, energy stats, etc.), you can optionally add a frontend pane component — see the [Frontend Control Pane](#frontend-control-pane-optional-but-recommended) section.

## Quick Start

```bash
# 1. Copy the template
cp -r src/connectors/_template src/connectors/my-connector

# 2. Edit the metadata and config schema in index.ts
# 3. Implement the Connector interface in connector.ts
# 4. Restart Aeolus — the registry auto-discovers your connector
```

That's it. The `ConnectorRegistry` scans `src/connectors/` at startup, finds your folder, validates the exports, and registers your connector. It appears in the dashboard and REST API automatically.

---

## Directory Structure

```
src/connectors/
├── README.md                    ← You are here
├── _template/                   ← Copy this to start a new connector
│   ├── index.ts                 ← Module exports (metadata, configSchema, createConnector)
│   └── connector.ts             ← Connector class implementation
├── connector.interface.ts       ← Core TypeScript interfaces
├── connector-registry.ts        ← Auto-discovery service
├── connector-manager.ts         ← Lifecycle management
├── connector-store.ts           ← SQLite persistence
├── hue/                         ← Philips Hue (reference implementation with setup flow)
│   ├── index.ts
│   └── hue-connector.ts
└── kasa/                        ← TP-Link Kasa (reference implementation without setup flow)
    ├── index.ts
    └── kasa-connector.ts
```

Each connector lives in its own subdirectory. The registry skips `_template`, files starting with `connector`, and `README.md` during discovery.

---

## Required Exports

Every connector module (`src/connectors/<name>/index.ts`) must export exactly three members:

### 1. `metadata: ConnectorMetadata`

Static descriptor used by the registry and dashboard.

```typescript
export const metadata: ConnectorMetadata = {
  id: "zigbee",                        // Unique ID — used as DB key and device.integration
  displayName: "Zigbee",               // Shown in dashboard UI
  icon: "radio",                       // lucide-react icon name
  description: "Zigbee devices via local coordinator",
  supportedDeviceTypes: ["light", "sensor", "switch"],
  requiresSetup: true,                 // true → dashboard shows setup wizard
};
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier. Used as `connector_type` in the database and `integration` field on discovered devices. Must be URL-safe. |
| `displayName` | `string` | Human-readable name for the dashboard card. |
| `icon` | `string` | A valid [lucide-react](https://lucide.dev/icons/) icon name. |
| `description` | `string` | Short description shown beneath the display name. |
| `supportedDeviceTypes` | `DeviceType[]` | Device categories this connector produces: `"light"`, `"sensor"`, `"switch"`, `"climate"`, `"plug"`. |
| `requiresSetup` | `boolean` | When `true`, the connector must implement `getSetupSteps()` and `executeSetupStep()`. |

### 2. `configSchema: ConnectorConfigSchema`

Defines the configuration form rendered in the dashboard.

```typescript
export const configSchema: ConnectorConfigSchema = [
  {
    id: "coordinatorPort",
    label: "Coordinator Port",
    type: "text",
    required: true,
    placeholder: "/dev/ttyUSB0",
    helpText: "Serial port of the Zigbee coordinator",
  },
  {
    id: "channel",
    label: "Channel",
    type: "number",
    required: false,
    default: 11,
    helpText: "Zigbee channel (11-26)",
  },
];
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Config key — becomes a key in the `config` object passed to `createConnector()`. |
| `label` | `string` | Form label shown to the user. |
| `type` | `"text" \| "number" \| "password" \| "boolean" \| "select"` | Input type. `"password"` fields are redacted in API responses. |
| `required` | `boolean` | If `true`, the REST API rejects enable requests missing this field (400). |
| `default` | `string \| number \| boolean` | Applied when the user doesn't provide a value. |
| `placeholder` | `string` | Placeholder text inside the input. |
| `helpText` | `string` | Guidance shown below the input. |
| `options` | `Array<{ label, value }>` | Choices for `"select"` type fields. |

### 3. `createConnector(config): Connector`

Factory function that returns a new connector instance.

```typescript
export function createConnector(config: Record<string, unknown>): Connector {
  return new ZigbeeConnector(config);
}
```

The `config` object contains values matching your `configSchema` field ids, with defaults applied for optional fields the user did not provide.

### 4. `snippets: SnippetDescriptor[]` (optional but recommended)

Code snippets for the automation editor. These appear grouped under your connector's display name in the snippet picker, helping users write automations for your devices.

Connectors should provide **both logic and UI snippets**:
- **Logic snippets** (`mode: "logic"` or omitted) — shown in the Logic tab. Use sandbox globals (`devices`, `mqtt`, `log`, `state`, etc.) to control devices and react to events.
- **UI snippets** (`mode: "ui"`) — shown in the UI tab. Use `props.*` to render connector-specific controls (toggles, sliders, status displays) in the custom component.

```typescript
export const snippets: SnippetDescriptor[] = [
  // Logic snippet (mode defaults to "logic" when omitted)
  {
    id: "toggle-device",
    name: "Toggle Zigbee Device",
    description: "Toggle a Zigbee device on or off",
    code: `function toggleZigbeeDevice(ctx) {\n  devices.action("zigbee-device-1", "toggle");\n  log.info("Toggled Zigbee device");\n}`,
  },
  {
    id: "check-battery",
    name: "Condition: Low Battery",
    description: "Check if a Zigbee sensor has low battery",
    code: `function isLowBattery(ctx) {\n  const sensor = devices.get("zigbee-sensor-1");\n  return (sensor?.state?.battery as number) < 20;\n}`,
  },
  // UI snippet — shown in the UI tab
  {
    id: "ui-device-card",
    name: "Device Status Card",
    description: "Card showing Zigbee device state with toggle",
    mode: "ui",
    code: `const zigbeeDevices = props.devices.filter(d => d.integration === "zigbee");\n// In JSX:\n// {zigbeeDevices.map(d => (\n//   <div key={d.id}>{d.name}: {d.state.on ? "On" : "Off"}</div>\n// ))}`,
  },
];
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique snippet identifier scoped to your connector (e.g. `"toggle-device"`). |
| `name` | `string` | Short display name shown in the snippet picker. |
| `description` | `string` | One-line description of what the snippet does. |
| `code` | `string` | TypeScript code inserted at the cursor position. Use named functions so they work as `automation()` condition/action blocks. |
| `mode` | `"logic" \| "ui"` | Which editor tab this snippet appears in. Defaults to `"logic"` if omitted. |

Include snippets for:

**Logic tab:**
- Common device actions (toggle, set brightness, set temperature, etc.)
- Useful conditions (device online, threshold checks, state comparisons)
- Multi-device patterns (filter by integration, loop and control)

**UI tab:**
- Device status cards (show state, name, type for your connector's devices)
- Control buttons (toggle, sliders, colour pickers using `aeolus.control`)
- Data displays (energy stats, sensor readings, battery levels)

### 5. `actionHandlers: Record<string, ActionHandler>` (optional)

Custom action handlers that extend the automation system. These are registered with the `ActionExecutor` when your connector is enabled and unregistered when it's disabled. They become available as action types in form-based and script-based automations.

```typescript
import type { ActionHandler } from "../../automations/action-executor.js";

export const actionHandlers: Record<string, ActionHandler> = {
  zigbee_group_action: async (action, ruleId, deps) => {
    deps.logger.info({ ruleId, group: action.params.group }, "Executing Zigbee group action");
    await deps.connectorManager.executeAction(action.target, {
      type: "group",
      deviceId: action.target,
      params: action.params,
    });
  },
};
```

Prefix handler names with your connector ID to avoid collisions (e.g. `zigbee_group_action`, not just `group_action`).

### 6. `conditions: Record<string, ConditionFactory>` (optional)

Custom condition factories that extend the form-based automation builder. These are registered with the `ConditionRegistry` when your connector is enabled and unregistered when it's disabled.

```typescript
import type { ConditionFactory } from "../../automations/condition-registry.js";

export const conditions: Record<string, ConditionFactory> = {
  zigbee_battery_below: (conditionValue: string) => {
    const threshold = Number(conditionValue);
    return (ctx) => Number(ctx.state.battery) < threshold;
  },
};
```

Each factory receives the `conditionValue` string from the rule config and returns a predicate function `(ctx: EventContext) => boolean`.

---

## Connector Lifecycle

The `ConnectorManager` drives the lifecycle in this order:

```
┌─────────────────────────────────────────────────────────┐
│  createConnector(config)                                │
│       │                                                 │
│       ▼                                                 │
│  connect()  ──── throws? ──→  health = "disconnected"   │
│       │                       (user can retry)          │
│       ▼                                                 │
│  discoverDevices()  ←──── polling loop (every 60s) ───┐ │
│       │                                               │ │
│       ▼                                               │ │
│  execute(action)  ←── routed by device.integration    │ │
│       │                                               │ │
│       └───────────────────────────────────────────────┘ │
│                                                         │
│  disconnect()  ←── user disables or system shuts down   │
│       │                                                 │
│       ▼                                                 │
│  dispose()  ←── release all resources                   │
└─────────────────────────────────────────────────────────┘
```

### Method Reference

| Method | When Called | What To Do |
|--------|-----------|------------|
| `connect()` | Once on enable or restore | Initialize SDK, authenticate, verify reachability. Throw on failure. |
| `disconnect()` | On disable or shutdown | Close connections, stop listeners. |
| `discoverDevices()` | After connect, then every poll cycle | Query external system, return `Device[]` with `integration` matching your `metadata.id`. |
| `execute(action)` | When user triggers a device action | Route the action to the correct device. Throw if device unknown or action fails. |
| `getHealthStatus()` | On API status requests | Return `{ status, lastSeen, errorMessage? }`. Return a copy, not a reference. |
| `onConfigUpdate(config)` | On `PATCH /api/connectors/:id` | Apply new config without full reconnect where possible. |
| `dispose()` | After disconnect, on permanent disable | Clear caches, timers, event listeners, allocated memory. |
| `getSetupSteps()` | Dashboard renders wizard | Return `SetupStepDescriptor[]` defining the flow. Only needed when `requiresSetup: true`. |
| `executeSetupStep(stepId, params)` | User advances wizard | Run step logic, return `SetupStepResult`. Set `complete: true` on the final step. |

---

## Setup Flow Pattern

For connectors that require multi-step pairing (e.g. button-press, OAuth):

1. Set `requiresSetup: true` in metadata
2. Implement `getSetupSteps()` returning step descriptors
3. Implement `executeSetupStep(stepId, params)` with step logic
4. The dashboard renders steps as a guided wizard
5. Each step is executed via `POST /api/connectors/:id/setup/:stepId`
6. Return `{ complete: true }` from the final step to close the wizard

See `src/connectors/hue/hue-connector.ts` for a complete example with bridge discovery and button-press pairing.

---

## Device Mapping

When returning devices from `discoverDevices()`, each device must conform to the Aeolus `Device` interface:

```typescript
{
  id: "my-connector-living-room-light",  // Stable, unique ID (prefix with connector name)
  name: "Living Room Light",              // Human-readable display name
  type: "light",                          // DeviceType: light | sensor | switch | climate | plug
  capabilities: ["on/off", "brightness"], // What the device can do
  state: { on: true, brightness: 200 },   // Current state as key-value pairs
  integration: "my-connector",            // MUST match metadata.id
  lastSeen: Date.now(),                   // Unix timestamp in ms
}
```

The `integration` field is critical — it's how the `ConnectorManager` routes actions to the correct connector. It must exactly match your `metadata.id`.

---

## REST API Endpoints

All connectors are managed through a single generic API. No custom routes needed.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/connectors/available` | List all discovered connector types |
| `GET` | `/api/connectors` | List enabled instances with health and device count |
| `POST` | `/api/connectors` | Enable a connector (`{ connectorType, config }`) |
| `PATCH` | `/api/connectors/:id` | Update config on a running connector |
| `DELETE` | `/api/connectors/:id` | Disable and dispose a connector |
| `GET` | `/api/connectors/:id/status` | Get detailed health status |
| `POST` | `/api/connectors/:id/setup/:stepId` | Execute a setup wizard step |
| `POST` | `/api/connectors/:id/retry` | Retry connection for disconnected connectors |

---

## Testing

### Unit Tests

Place tests next to your connector source files:

```
src/connectors/my-connector/
├── index.ts
├── connector.ts
└── connector.test.ts        ← Unit tests
```

Test the following at minimum:
- Metadata shape matches `ConnectorMetadata` interface
- Config schema has correct required/optional fields
- `createConnector()` returns a valid `Connector` instance
- `discoverDevices()` maps external devices to correct Aeolus `Device` format
- `execute()` routes actions to the correct device
- `getHealthStatus()` returns correct status based on connectivity
- Error handling: unreachable devices, invalid actions, malformed responses

### Running Tests

```bash
# Run all connector tests
npx vitest --run src/connectors/

# Run tests for a specific connector
npx vitest --run src/connectors/my-connector/

# Run with coverage
npx vitest --run --coverage src/connectors/
```

The project uses [Vitest](https://vitest.dev/) as the test runner and [fast-check](https://fast-check.dev/) with `@fast-check/vitest` for property-based tests.

---

## Examples

### Simple Connector (no setup flow)

See `src/connectors/kasa/` — auto-discovers devices via UDP broadcast, no pairing required.

### Connector with Setup Flow

See `src/connectors/hue/` — requires bridge discovery and button-press pairing before connecting.

---

## Frontend Control Pane (optional but recommended)

The backend connector framework handles everything automatically — your devices appear in the Device Grid pane, the Connectors page shows enable/disable/config UI, and automations can target your devices. No frontend changes are required for a working connector.

However, the built-in connectors each ship a dedicated control pane with connector-specific UI:

- `HueControlPane.tsx` — brightness slider, colour picker with swatches, per-light toggle
- `KasaControlPane.tsx` — toggle, device type badge, energy monitoring stats (voltage, current, power, kWh)

If your connector has device-specific controls that don't fit the generic Device Grid (colour pickers, energy stats, thermostat setpoints, camera feeds, etc.), you should build a pane component.

### How to add a control pane

1. Create `frontend/src/components/panes/MyConnectorPane.tsx`
2. Filter devices from the store by `integration === "my-connector"`
3. Render connector-specific controls (use `HueControlPane.tsx` or `KasaControlPane.tsx` as reference)
4. Register it in `frontend/src/lib/pane-registry.ts`:

```typescript
import { MyConnectorPane } from "../components/panes/MyConnectorPane";

// Add to the PANE_REGISTRY object:
"my-connector-control": {
  component: MyConnectorPane,
  displayName: "My Connector",
  defaultIcon: "radio",           // lucide-react icon name
  defaultConfig: {},
  defaultSize: { w: 12, h: 6 },
  category: "controls",
},
```

5. The pane now appears in the Add Pane picker under the Controls category

### Pane component pattern

```tsx
import type { PaneConfig } from "../../types/dashboard";
import { useDeviceStore } from "../../store/device-store";
import { sendAction } from "../../lib/api-client";

interface Props {
  config: PaneConfig;
}

export function MyConnectorPane({ config }: Props) {
  const devices = useDeviceStore((s) => s.devices);

  // Filter to only your connector's devices
  const myDevices = Object.values(devices).filter(
    (d) => d.integration === "my-connector",
  );

  if (myDevices.length === 0) {
    return <div>No devices found. Enable the connector on the Connectors page.</div>;
  }

  return (
    <div>
      {myDevices.map((device) => (
        <div key={device.id}>
          <span>{device.name}</span>
          <button onClick={() => sendAction(device.id, "toggle")}>
            Toggle
          </button>
          {/* Add connector-specific controls here */}
        </div>
      ))}
    </div>
  );
}
```

Key points:
- Use `useDeviceStore` to get live device state (updated via WebSocket)
- Use `sendAction(deviceId, actionType, params?)` from `lib/api-client.ts` to trigger actions
- The store updates optimistically — update local state before the API call, revert on failure
- Empty state should direct users to the Connectors page to enable your connector

---

## Checklist

Before shipping your connector:

**Backend (required):**
- [ ] `index.ts` exports `metadata`, `configSchema`, and `createConnector`
- [ ] `index.ts` exports `snippets` array with logic snippets (device actions, conditions) and UI snippets (component controls, status displays)
- [ ] `index.ts` exports `actionHandlers` with connector-specific action types (optional but recommended)
- [ ] `index.ts` exports `conditions` with connector-specific condition factories (optional but recommended)
- [ ] `metadata.id` is unique and URL-safe
- [ ] `metadata.id` matches the `integration` field on all discovered devices
- [ ] Required config fields are validated (the REST API handles this via your schema)
- [ ] `connect()` throws a descriptive error on failure
- [ ] `discoverDevices()` returns stable device IDs across restarts
- [ ] `execute()` handles all action types your devices support
- [ ] `getHealthStatus()` accurately reflects connectivity
- [ ] `dispose()` cleans up all resources (no leaked timers or listeners)
- [ ] Unit tests cover core functionality and error paths

**Frontend (optional but recommended):**
- [ ] Control pane component in `frontend/src/components/panes/`
- [ ] Registered in `frontend/src/lib/pane-registry.ts` under the `"controls"` category
- [ ] Filters devices by `integration === "your-connector-id"`
- [ ] Empty state directs users to enable the connector
- [ ] Uses optimistic UI updates for toggle/action controls
