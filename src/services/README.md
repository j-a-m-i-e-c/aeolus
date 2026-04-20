# Service Developer Guide

Build services to add non-device event sources to Aeolus. A service produces events — timers, API triggers, external data feeds — and emits them on the standard event bus using `service/{type}/{name}` topics. Automations match on these topics the same way they match on `sensor/` or `connector/` topics.

## Quick Start

```bash
# 1. Create a directory for your service
mkdir src/services/my-service

# 2. Create index.ts with the three required exports (metadata, configSchema, createService)
# 3. Register your module in index.ts: serviceRegistry.register(myServiceModule)
# 4. Restart Aeolus — your service appears in the dashboard and REST API
```

---

## Directory Structure

```
src/services/
├── README.md                    ← You are here
├── service.interface.ts         ← Core TypeScript interfaces
├── service-registry.ts          ← Manual registration and lookup
├── service-manager.ts           ← Lifecycle management
├── service-store.ts             ← SQLite persistence
├── cron/                        ← Cron Scheduler (reference: config-driven service)
│   └── index.ts
├── trigger/                     ← API Trigger (reference: stateless event emitter)
│   └── index.ts
└── system/                      ← System Events (reference: lifecycle events)
    └── index.ts
```

---

## Required Exports

Every service module (`src/services/<name>/index.ts`) must export exactly three members:

### 1. `metadata: ServiceMetadata`

Static descriptor used by the registry and dashboard.

```typescript
import type { ServiceMetadata } from "../service.interface.js";

export const metadata: ServiceMetadata = {
  id: "weather",                    // Unique ID — used as DB key and topic prefix
  displayName: "Weather Service",   // Shown in dashboard UI
  icon: "cloud-sun",               // lucide-react icon name
  description: "Fetches weather data and emits periodic updates",
  category: "integration",         // Grouping: "scheduling", "integration", "system"
};
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier. Used as `service_type` in the database and in the topic pattern `service/{id}/{name}`. Must be URL-safe. |
| `displayName` | `string` | Human-readable name for the dashboard card. |
| `icon` | `string` | A valid [lucide-react](https://lucide.dev/icons/) icon name. |
| `description` | `string` | Short description shown beneath the display name. |
| `category` | `string` | Grouping category for the dashboard (e.g. `"scheduling"`, `"integration"`, `"system"`). |

### 2. `configSchema: ServiceConfigSchema`

Defines the configuration form rendered in the dashboard. Reuses `ConfigFieldDescriptor` from the Connector framework.

```typescript
import type { ServiceConfigSchema } from "../service.interface.js";

export const configSchema: ServiceConfigSchema = [
  {
    id: "apiKey",
    label: "API Key",
    type: "password",
    required: true,
    helpText: "Your weather API key",
  },
  {
    id: "location",
    label: "Location",
    type: "text",
    required: true,
    placeholder: "Melbourne, AU",
  },
  {
    id: "intervalMinutes",
    label: "Poll Interval (minutes)",
    type: "number",
    required: false,
    default: 30,
  },
];
```

Use an empty array `[]` if your service needs no configuration (see trigger and system services).

### 3. `createService(config, deps): ServiceInstance`

Factory function that returns a new service instance.

```typescript
import type { ServiceDependencies, ServiceInstance } from "../service.interface.js";

export function createService(
  config: Record<string, unknown>,
  deps: ServiceDependencies,
): ServiceInstance {
  return new WeatherServiceInstance(config, deps);
}
```

The `config` object contains values matching your `configSchema` field ids. The `deps` object provides `{ eventBus }` for emitting events.

---

## Lifecycle Methods

The `ServiceManager` drives the lifecycle in this order:

```
┌──────────────────────────────────────────────────────┐
│  createService(config, { eventBus })                 │
│       │                                              │
│       ▼                                              │
│  start()  ──── throws? ──→  health = "stopped"       │
│       │                     (user can retry)         │
│       ▼                                              │
│  [service produces events on its own schedule]       │
│       │                                              │
│  onConfigUpdate(config)  ←── PATCH /api/services/:id │
│       │                                              │
│  stop()  ←── user disables or system shuts down      │
│       │                                              │
│       ▼                                              │
│  dispose()  ←── release all resources                │
└──────────────────────────────────────────────────────┘
```

| Method | When Called | What To Do |
|--------|-----------|------------|
| `start()` | Once on enable or restore | Set up timers, connections, listeners. Begin producing events. Throw on failure. |
| `stop()` | On disable or shutdown | Cancel timers, stop producing events. |
| `dispose()` | After stop, on permanent disable | Release all remaining resources (timers, listeners, memory). |
| `getHealthStatus()` | On API status requests | Return `{ status, lastActivity, errorMessage? }`. |
| `onConfigUpdate(config)` | On `PATCH /api/services/:id` | Apply new config without full stop/start where possible. |
| `getState()` | Sandbox queries, topics endpoint | Return a read-only snapshot of service state. Optional. |

---

## Event Emission Pattern

Services emit events through the existing `DEVICE_STATE_CHANGE` pipeline. This is the core pattern every service uses:

```typescript
import { DEVICE_STATE_CHANGE } from "../../core/event-bus.js";
import type { NormalizedEvent } from "../../core/types.js";

// Inside your service instance method:
const event: NormalizedEvent = {
  deviceId: `service-${metadata.id}`,   // e.g. "service-weather"
  deviceType: "sensor",                  // Always "sensor" for service events
  state: {                               // Your event-specific data
    temperature: 22.5,
    humidity: 65,
    fetchedAt: Date.now(),
  },
  topic: `service/${metadata.id}/update`, // Synthetic topic automations match on
  timestamp: Date.now(),
  integration: "service",                 // Always "service"
};

this.eventBus.emit(DEVICE_STATE_CHANGE, event);
```

Key rules:
- `deviceId` must be `service-{your metadata.id}`
- `deviceType` is always `"sensor"`
- `topic` follows the pattern `service/{type}/{name}` — automations match on this
- `integration` is always `"service"`
- `state` contains whatever data your service produces

Automations can then match with `service/weather/update`, `service/+/update`, or `service/#`.

---

## Example: Minimal Service

```typescript
// src/services/heartbeat/index.ts
import { DEVICE_STATE_CHANGE } from "../../core/event-bus.js";
import type { NormalizedEvent } from "../../core/types.js";
import type {
  ServiceConfigSchema,
  ServiceDependencies,
  ServiceHealthStatus,
  ServiceInstance,
  ServiceMetadata,
  ServiceModule,
} from "../service.interface.js";

export const metadata: ServiceMetadata = {
  id: "heartbeat",
  displayName: "Heartbeat",
  icon: "heart-pulse",
  description: "Emits a periodic heartbeat event",
  category: "system",
};

export const configSchema: ServiceConfigSchema = [
  {
    id: "intervalSeconds",
    label: "Interval (seconds)",
    type: "number",
    required: false,
    default: 60,
  },
];

class HeartbeatServiceInstance implements ServiceInstance {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastBeat = 0;
  private readonly eventBus: ServiceDependencies["eventBus"];
  private intervalMs: number;

  constructor(config: Record<string, unknown>, deps: ServiceDependencies) {
    this.eventBus = deps.eventBus;
    this.intervalMs = ((config.intervalSeconds as number) ?? 60) * 1000;
  }

  async start(): Promise<void> {
    this.timer = setInterval(() => this.beat(), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  getHealthStatus(): ServiceHealthStatus {
    return { status: this.timer ? "running" : "stopped", lastActivity: this.lastBeat };
  }

  onConfigUpdate(config: Record<string, unknown>): void {
    this.intervalMs = ((config.intervalSeconds as number) ?? 60) * 1000;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.beat(), this.intervalMs);
    }
  }

  getState(): Record<string, unknown> {
    return { lastBeat: this.lastBeat, intervalMs: this.intervalMs };
  }

  private beat(): void {
    this.lastBeat = Date.now();
    const event: NormalizedEvent = {
      deviceId: "service-heartbeat",
      deviceType: "sensor",
      state: { beatAt: this.lastBeat },
      topic: "service/heartbeat/beat",
      timestamp: this.lastBeat,
      integration: "service",
    };
    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }
}

export function createService(
  config: Record<string, unknown>,
  deps: ServiceDependencies,
): ServiceInstance {
  return new HeartbeatServiceInstance(config, deps);
}

const heartbeatModule: ServiceModule = { metadata, configSchema, createService };
export default heartbeatModule;
```

Then register it in `src/index.ts`:

```typescript
import heartbeatModule from "./services/heartbeat/index.js";
serviceRegistry.register(heartbeatModule);
```

---

## Built-in Services

Three services ship with the framework:

| Service | ID | Category | Config | Topics |
|---------|----|----------|--------|--------|
| Cron Scheduler | `cron` | scheduling | `schedules: [{ name, cron }]` | `service/cron/{scheduleName}` |
| API Trigger | `trigger` | integration | none | `service/trigger/{name}` |
| System Events | `system` | system | none | `service/system/startup`, `service/system/shutdown` |

---

## REST API

All services are managed through a single generic API at `/api/services`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/services/available` | List registered service types with metadata + config schema |
| `GET` | `/api/services` | List enabled instances with health and config |
| `POST` | `/api/services` | Enable a service (`{ service_type, config }`) |
| `PATCH` | `/api/services/:id` | Update config on a running service |
| `DELETE` | `/api/services/:id` | Disable and dispose a service |
| `GET` | `/api/services/:id/status` | Get detailed health status |
| `POST` | `/api/services/:id/retry` | Retry starting a stopped service |
| `POST` | `/api/services/trigger/:name` | Fire an API trigger event |
| `GET` | `/api/services/topics` | List available service event topics |

---

## Testing

Place tests next to your service source:

```
src/services/my-service/
├── index.ts
└── index.test.ts
```

Test at minimum:
- Metadata shape matches `ServiceMetadata` interface
- `createService()` returns a valid `ServiceInstance`
- Events are emitted with correct `NormalizedEvent` shape
- `getHealthStatus()` reflects running/stopped state
- `onConfigUpdate()` applies changes correctly
- `getState()` returns expected snapshot

```bash
npx vitest --run src/services/my-service/
```

---

## Checklist

Before shipping your service:

- [ ] `index.ts` exports `metadata`, `configSchema`, and `createService`
- [ ] `metadata.id` is unique and URL-safe
- [ ] Events use topic pattern `service/{metadata.id}/{eventName}`
- [ ] Events set `deviceId` to `service-{metadata.id}` and `integration` to `"service"`
- [ ] `start()` throws a descriptive error on failure
- [ ] `stop()` cancels all timers and stops event production
- [ ] `dispose()` cleans up all resources (no leaked timers or listeners)
- [ ] `getHealthStatus()` accurately reflects operational state
- [ ] Service is registered in `src/index.ts` via `serviceRegistry.register()`
