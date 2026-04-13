# Connector Developer Guide

Build connectors to integrate external device ecosystems into Aeolus. A connector bridges the gap between a third-party protocol (Hue, Kasa, Zigbee, Z-Wave, etc.) and the Aeolus device model — no core file changes required.

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

## Checklist

Before shipping your connector:

- [ ] `index.ts` exports `metadata`, `configSchema`, and `createConnector`
- [ ] `metadata.id` is unique and URL-safe
- [ ] `metadata.id` matches the `integration` field on all discovered devices
- [ ] Required config fields are validated (the REST API handles this via your schema)
- [ ] `connect()` throws a descriptive error on failure
- [ ] `discoverDevices()` returns stable device IDs across restarts
- [ ] `execute()` handles all action types your devices support
- [ ] `getHealthStatus()` accurately reflects connectivity
- [ ] `dispose()` cleans up all resources (no leaked timers or listeners)
- [ ] Unit tests cover core functionality and error paths
