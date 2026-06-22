# Why Aeolus?

Aeolus is a local-first edge automation platform. It provides sandboxed code execution, hot-loaded React dashboards, a pluggable connector framework, MQTT-native device discovery, and optional remote access. Everything runs on your LAN by default — fast, private, no vendor dependency. Because nothing relies on external services, it also happens to be fully functional offline, which makes it deployable anywhere from a home to a research station.

Home automation is the first domain it targets — but the architecture is domain-agnostic. The same platform works for a workshop, a greenhouse, a boat, or an industrial monitoring site.

---

## How It Differs from Home Assistant

Aeolus is not a Home Assistant clone. It was built from scratch to solve a fundamentally different problem: give developers a real programming environment for event-driven automation, not a GUI wizard with YAML escape hatches.

**Home Assistant** is a configuration-driven platform. You describe what you want in YAML, configure integrations through a UI, and use templates (Jinja2) when the visual editor runs out of expressiveness. It's designed for non-programmers who want to automate their home without writing code.

**Aeolus** is a code-first platform. You write automation scripts in a Monaco editor with full IntelliSense, compose custom React dashboard components in JSX, and deploy to a Pi with `docker compose up`. It's designed for developers who want the same experience they have in their day job — types, tests, version control, and composability — applied to their physical environment.

Home Assistant optimises for accessibility. Aeolus optimises for developer experience.

Aeolus is also early. What exists today is the foundation — a well-architected core with a connector framework explicitly designed for other developers to extend. The vision is a community-driven platform where developers contribute connectors for their own hardware, share automation recipes, and build on a codebase that respects their time and skills. The simplicity of the connector interface (one TypeScript file, 5 methods) is intentional — it's meant to lower the barrier so anyone with a device and an afternoon can plug it into the ecosystem.

---

## Each Automation Is a Full-Stack Unit

This is the single biggest architectural difference. Every automation in Aeolus has two tabs: **Logic** (backend script) and **UI** (React/JSX component). They are a paired unit that communicate through a reactive state store:

```
┌─────────────────────────┐         ┌─────────────────────────┐
│   Logic tab (backend)   │         │   UI tab (React)        │
│                         │         │                         │
│  state.set("mode", "…") ├────────►│  aeolus.read("mode")    │
│                         │   WS    │                         │
│  // reads on next run   │◄────────┤  aeolus.save("…", 25)   │
│  state.get("target")    │  SQLite │                         │
│                         │         │                         │
│  // fires immediately   │◄────────┤  aeolus.fire("changed", │
│  context.state.value    │  HTTP   │    { value: 25 })       │
└─────────────────────────┘         └─────────────────────────┘
```

- **Logic → UI** (real-time): `state.set()` persists to SQLite and broadcasts via WebSocket. The UI re-renders immediately.
- **UI → Logic** (passive): `aeolus.save()` writes to SQLite. The Logic tab reads it on its next trigger.
- **UI → Logic** (immediate): `aeolus.fire(eventName, payload)` triggers the Logic tab now with `context.topic = "ui/{ruleId}/{eventName}"`.

No other home automation platform offers this paired backend/frontend model where both halves are user-authored and connected by the platform. In Home Assistant, dashboard cards and automations are completely separate concerns — cards read entity state, automations write it, but there's no direct channel between a specific automation and a specific UI component.

---

## Architectural Philosophy

| Principle | Aeolus | Home Assistant |
|-----------|--------|----------------|
| **Automation language** | JavaScript/TypeScript in a secure V8 sandbox | YAML + Jinja2 templates |
| **UI customisation** | Write JSX/TSX components, rendered live on save | Lovelace cards (YAML config) or custom card JS |
| **Device communication** | MQTT-native + pluggable connector framework | 2,500+ Python integrations |
| **Data persistence** | SQLite — single file, zero config | MariaDB/PostgreSQL/SQLite (recorder) |
| **Deployment model** | 3 Docker containers, one command | HassOS image or supervised install |
| **Extension mechanism** | Connectors implementing a TypeScript interface | Python integrations + HACS |
| **Target user** | Developers, engineers, tinkerers who code | Everyone — from beginners to advanced |

---

## Automation: Code vs Configuration

### The Home Assistant Way

```yaml
automation:
  - alias: "Turn on lights at sunset"
    trigger:
      - platform: sun
        event: sunset
    condition:
      - condition: state
        entity_id: binary_sensor.someone_home
        state: "on"
    action:
      - service: light.turn_on
        target:
          entity_id: light.living_room
        data:
          brightness_pct: 60
```

This works for simple rules. But what happens when you need to:
- Call an external API and branch based on the response?
- Maintain state across multiple trigger events?
- Apply different logic based on day of week, season, or a rolling average?
- Compose multiple automations into a pipeline?
- Test your automation logic in isolation?

You end up fighting Jinja2 templates, creating helper entities as state machines, and writing Python custom components that bypass the automation engine entirely.

### The Aeolus Way

```javascript
// Runs in a secure V8 isolate — 32MB memory, 5-second timeout
// Monaco editor provides autocomplete for every global: devices, mqtt, http, state, db, log
const temp = context.state.value;
const room = context.topic.split("/")[1];

// Call external APIs — async/await just works
const weather = await http.get("https://api.weather.com/current");
const forecast = JSON.parse(weather.body);

if (temp > 28 && forecast.willRain === false) {
  // Query and control devices with a real API
  const fans = devices.filter(d => d.type === "plug" && d.name.includes("fan"));
  for (const fan of fans) {
    devices.action(fan.id, "on");
  }

  // Publish to any MQTT topic
  mqtt.publish("alerts/heat", JSON.stringify({ room, temp }));

  // Push data to your custom UI component via the state store
  // This hits SQLite and broadcasts via WebSocket — the UI re-renders instantly
  state.set("fansActive", true);
  state.set("reason", `High temp: ${temp}°C, no rain expected`);
}
```

This is just code. Loops, conditionals, async/await, external API calls, persistent state — no templates, no workarounds, no escape hatches. TypeScript annotations are optional (stripped at transpile time), so you can write plain JavaScript if that's your style.

### How It Actually Works Under the Hood

Every script runs in a fresh **isolated-vm** V8 context — a separate V8 isolate with its own 32MB heap and a hard 5-second timeout. The sandbox exposes a carefully controlled API surface through host-side references:

```
┌─────────────────────────────────────────────┐
│  V8 Isolate (32MB, 5s timeout)              │
│                                             │
│  globals:                                   │
│    devices.get/list/filter/action/actionAll  │
│    mqtt.publish                             │
│    http.get/post                            │
│    log.info/warn/error                      │
│    state.get/set/getAll/delete              │
│    db.write/query/get/set/delete/collections│
│    context (frozen event data)              │
│    automation() helper                      │
│                                             │
│  blocked: require, import, process, fs,     │
│           child_process, eval (repurposed)  │
└─────────────────────────────────────────────┘
         │ ivm.Reference callbacks │
         ▼                         ▼
┌─────────────────────────────────────────────┐
│  Host Process (Node.js)                     │
│  ActionExecutor, MqttService, DeviceRegistry│
│  AutomationStateStore, DataStore            │
└─────────────────────────────────────────────┘
```

This is a genuine security boundary. A buggy or malicious script cannot:
- Access the filesystem
- Spawn processes
- Consume unlimited memory (hard 32MB cap)
- Run forever (hard 5s timeout)
- Import any module
- Crash the host process

In Home Assistant, custom integrations and template automations run in the same Python process as the core. A bad integration can crash everything.

### The Structured Helper (Optional)

For simpler automations, the `automation()` helper provides structure that generates a visual flow diagram:

```javascript
automation({
  conditions: [
    function isLowLight(ctx) { return ctx.state.value < 200; },
    function isEvening(ctx) {
      const hour = new Date(ctx.timestamp).getHours();
      return hour >= 16 && hour < 23;
    },
  ],
  actions: [
    function dimLights(ctx) {
      const lights = devices.filter(d => d.integration === "hue");
      for (const light of lights) {
        devices.action(light.id, "brightness", { brightness: 60 });
      }
      state.set("mode", "evening");
    },
  ],
});
```

Named functions become labeled nodes in the flow diagram. You get visual representation *and* real code — not one or the other. The helper is entirely optional — free-form scripts have access to the exact same globals.

### Transpilation: esbuild, Not TypeScript Compiler

Scripts are transpiled using **esbuild** (the same tool Vite uses) — not the full TypeScript compiler. This means:
- Transpilation is near-instant (microseconds, not seconds)
- Type annotations are stripped, not checked — write `const x: number = 5` if you want, or don't
- The editor provides IntelliSense from type definitions served via API, so you get autocomplete without needing to type anything yourself
- `import`/`require` statements are explicitly rejected before transpilation — all APIs are globals, keeping the sandbox secure

---

## Custom UI: Live React Components vs Lovelace Cards

### Home Assistant's Dashboard

Home Assistant uses Lovelace — a YAML-configured card system. Built-in cards cover common patterns (gauges, buttons, entity lists). For anything custom, you write a JavaScript web component that follows HA's custom card API, publish it as a HACS resource, and configure it in YAML.

The feedback loop is slow: edit JS → refresh browser → check YAML config → repeat. Custom cards are disconnected from the automation logic — they can read entity state but have no direct channel to their "backend."

### Aeolus: Live React Components Paired to Their Automation

As described above, every automation has a UI tab. The feedback loop is instant — save and it renders. Custom cards in Home Assistant are disconnected from automation logic; in Aeolus, the UI component and its backend script are a single unit with a dedicated communication channel.

### What a Custom Component Looks Like

```jsx
export default function ClimateControl(aeolus) {
  const temp = aeolus.read("currentTemp");
  const mode = aeolus.read("mode");

  return (
    <div className="p-4 space-y-3">
      <div className="text-2xl font-bold">{temp}°C</div>
      <div className="text-sm opacity-70">{mode} mode</div>
      <input
        type="range" min={16} max={28} defaultValue={22}
        onChange={e => aeolus.fire("target-changed", { value: +e.target.value })}
      />
      <button onClick={() => aeolus.control("fan-1", "toggle")}>
        Toggle Fan
      </button>
    </div>
  );
}
```

Save it. It renders instantly in the dashboard pane. No rebuild. No refresh. No YAML.

### How Hot-Loading Actually Works (From the Code)

1. **Save** — the backend transpiles your JSX/TSX using esbuild with `jsx: "automatic"` and `jsxImportSource: "react"`. Output is stored in SQLite.
2. **Fetch** — the frontend requests the compiled module from `GET /api/automations/:id/ui-module`.
3. **Rewrite** — React import specifiers (`import { useState } from "react"`) are rewritten to reference `window.__AEOLUS_EXTERNALS__` — the host app's shared React instance.
4. **Load** — the rewritten code becomes a Blob URL, loaded via dynamic `import()`.
5. **Render** — the default export is passed to React's component tree inside an error boundary.

The entire round-trip is milliseconds. No Docker rebuild, no Vite recompilation, no page refresh. If the component throws, the error boundary catches it and shows a fallback — the rest of the dashboard is unaffected.

### The Component API

Every component receives an `aeolus` props object with:

| Method | Description |
|--------|-------------|
| `read(key)` | Read a value the Logic tab wrote via `state.set()` — reactive, triggers re-render |
| `save(key, value)` | Persist to SQLite, Logic tab reads on next trigger |
| `saveAndFire(key, value)` | Persist AND immediately fire the Logic tab |
| `fire(eventName, payload?)` | Fire the Logic tab script right now with a custom event |
| `control(deviceId, actionType, params?)` | Control any device directly from the UI |
| `publish(topic, payload)` | Publish to any MQTT topic |
| `devices` | Full device registry array |
| `ruleId`, `ruleName`, `enabled`, `lastFired` | Automation metadata |
| `history` | Recent execution log entries |

---

## The Event Bus: Everything Speaks the Same Language

Home Assistant's internal architecture is complex — entity registries, state machines, event buses, service calls, and device triggers all interact through different mechanisms. Adding a new integration means understanding multiple subsystems.

Aeolus has **one event bus** — a Node.js EventEmitter with 23 typed event constants:

```
DEVICE_STATE_CHANGE       →  automation engine evaluates rules
AUTOMATION_FIRED          →  execution log, WebSocket broadcast
AUTOMATION_STATE_CHANGE   →  WebSocket pushes to frontend
MQTT_RAW_MESSAGE          →  parsing, device registry upsert
MQTT_MESSAGE_PUBLISHED    →  metrics tracking
CONNECTOR_POLL            →  device discovery cycle
DATA_STORE_WRITE          →  collection metrics update
WS_CLIENT_CONNECT/DISCONNECT  →  connection tracking
```

Two event source layers feed the bus identically:
- **MQTT devices** (ESP32, Arduino, Tasmota, ESPHome) — messages arrive at Mosquitto, the MqttService parses them into `NormalizedEvent` objects, and emits `DEVICE_STATE_CHANGE`.
- **Connectors** (Hue, Kasa, etc.) — the ConnectorManager polls devices, normalises them into the same `Device` format, and emits `DEVICE_STATE_CHANGE` through synthetic topics like `connector/hue/{deviceId}`.

An automation script receives the same `context` object regardless of whether the event came from an ESP32 publishing raw JSON, a Hue light polled via HTTP, or a Kasa plug discovered via UDP broadcast. The script doesn't know or care about the underlying protocol.

### Topic Matching — MQTT Wildcards

The automation engine supports full MQTT wildcard matching:
- `sensor/+/temp` — matches any single-level segment (e.g. `sensor/kitchen/temp`, `sensor/bedroom/temp`)
- `sensor/#` — matches everything under a prefix (e.g. `sensor/kitchen/temp`, `sensor/garden/soil/moisture`)

Plus cron-triggered rules (`*/5 * * * *` — every 5 minutes) and manual fire (no trigger topic, execute on demand).

---

## The Connector Framework: Designed for Community Contributions

### Home Assistant Integration Authoring

Writing a HA integration means:
- A directory with `__init__.py`, `manifest.json`, `config_flow.py`, `const.py`, `sensor.py` (or `light.py`, `switch.py`...)
- Understanding HA's entity model, device registry, config entries, and update coordinators
- Setting up a development environment with the full HA core
- Following a 20+ page developer documentation guide
- Submitting to HACS or the core repo for distribution

The barrier to entry is high. Most HA integrations are written by a small number of dedicated contributors, not the average user.

### Aeolus Connector Authoring: One Afternoon, One File

The connector framework was designed with one goal: make it so easy to add hardware support that any developer with a device and an afternoon can do it.

A connector is a single TypeScript file exporting three things:

```typescript
// src/connectors/my-connector/index.ts

export const metadata: ConnectorMetadata = {
  id: "my-connector",
  displayName: "My Devices",
  icon: "radio",
  description: "Connect to my custom device ecosystem",
  supportedDeviceTypes: ["sensor", "switch"],
  requiresSetup: false,
};

export const configSchema: ConnectorConfigSchema = [
  { id: "host", label: "Device IP", type: "text", required: true, placeholder: "192.168.1.100" },
];

export function createConnector(config: Record<string, unknown>): Connector {
  return new MyConnector(config);
}
```

The `Connector` interface has 5 required methods: `connect()`, `disconnect()`, `discoverDevices()`, `execute(action)`, `getHealthStatus()`. That's it. The framework handles:
- REST API endpoints (enable, disable, config update, health check)
- Setup wizard rendering (if `requiresSetup: true`)
- Device registry upsert from `discoverDevices()` results
- Action routing (the ActionExecutor dispatches to `execute()`)
- Health polling and dashboard status indicators
- Automatic registration/unregistration of action handlers and condition factories

Connectors can optionally export `snippets` (code templates for the editor), `actionHandlers` (custom action types for the ActionExecutor), and `conditions` (reusable condition factories for the automation engine). The Hue connector, for example, exports 10+ code snippets covering both Logic and UI tabs.

This is the contribution path: you buy some hardware (Shelly plugs, Zigbee sensors, a Sonos speaker), write a connector for it, and submit a PR. Everyone benefits, and the effort required is a fraction of what HA demands. The platform grows one developer at a time, each bringing their own hardware.

### The Action System: Structured Results, Not Fire-and-Forget

Every device action flows through a central `ActionExecutor` with a handler registry pattern:

```
devices.action("light-1", "setBrightness", { brightness: 80 })
    │
    ▼
ActionExecutor.execute({ type: "device_action", target: "light-1", params: {...} })
    │
    ▼
ConnectorManager.executeAction("light-1", action)
    │
    ▼
HueConnector.execute(action)  →  HTTP PUT to Hue bridge
    │
    ▼
ActionResult { success: true }  (or { success: false, error: "Bridge unreachable" })
```

Built-in action handlers: `publish` (MQTT), `toggle`, `device_action`, `log`, `delay`, `webhook`. Connectors register additional handlers when enabled (`hue_scene`, `hue_color_loop`, etc.) and unregister them when disabled. The system never throws — every action returns an `ActionResult` with success/failure.

---

## The Dashboard: Modular, Composable, Permission-Aware

### Home Assistant's Dashboard (Lovelace)

Lovelace is card-based. You add cards to views via the UI editor or YAML. Cards are independent — they read entity state but don't communicate with each other. The layout is grid-based but not drag-and-drop in the traditional sense (you reorder cards, not freely position them). Custom cards require authoring web components with HA's card lifecycle API.

### Aeolus's Dashboard

The dashboard uses **react-grid-layout** with responsive breakpoints (12/12/6/4/2 columns across breakpoints). Panes are freely draggable and resizable. The layout persists to the backend via debounced API calls (2-second debounce).

**17 built-in pane types** across 4 categories:

| Category | Panes |
|----------|-------|
| Controls | Device Grid, Hue Lights, Kasa Devices, Trigger Button |
| Automations | Automation (the full editor/status pane), Automation List |
| Monitoring | Sensor Panel, MQTT Inspector, Topic Tree, Event Log, State History, Cron Schedule Viewer, Metrics, Metrics History |
| System | System Stats, Connectors |

Custom tabs are first-class: create as many as you want, assign them to user groups with three permission levels:
- **read** — view only, all controls disabled
- **interact** — control devices, fire automations
- **write** — full control including editing automation code

The WebSocket server enforces this: messages are filtered per-connection based on the authenticated user's group memberships and tab assignments. An admin sees everything; a regular user only receives updates for tabs they have access to.

### The Pane as the Unit of Composition

In Aeolus, the **Automation Pane** isn't just a card showing status — it's the entire development environment:
- **Setup mode** — name your automation, pick a trigger (MQTT topic, cron, or none), write code
- **Editing mode** — Monaco editor with Logic/UI tabs, snippet picker, live docs panel
- **Status mode** — shows the custom UI component (if authored), flow diagram (if using `automation()` helper), or activity feed

Each pane is self-contained. You can have 5 automation panes on one tab, each running its own logic and rendering its own custom component. They don't interfere with each other because each automation has its own isolated sandbox execution, its own state store namespace, and its own UI module.

---

## The Editor Experience

### Monaco with Context-Aware IntelliSense

Both the Logic and UI editors are Monaco (the same editor engine as VS Code) with:

- **Custom Aeolus dark theme** — matches the dashboard aesthetic
- **Type definitions loaded from the backend** — `GET /api/automations/types` serves `sandbox-types.d.ts` (all Logic globals), `GET /api/automations/ui-types` serves `CustomComponentProps` and React type stubs
- **TypeScript compiler options** — ESNext target, no module system (Logic), ReactJSX mode (UI)
- **Error markers** — transpile errors appear as red squiggles with line/column precision
- **Ctrl+S to save** — triggers create (setup mode) or update (editing mode)
- **Snippet insertion API** — the snippet picker injects code at the cursor position

The Logic editor provides autocomplete for `devices.action()`, `mqtt.publish()`, `http.get()`, `state.set()`, `db.write()`, and every other sandbox global — with JSDoc hover documentation explaining each method's parameters and return values.

The UI editor provides autocomplete for `aeolus.read()`, `aeolus.fire()`, `aeolus.control()`, plus React hooks (`useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`) and full JSX IntrinsicElements support.

### Snippet Library

Both connectors and the platform contribute code snippets:

- **Platform snippets** — common patterns for both Logic (`state.set`, device filtering, MQTT publish) and UI (state display, device control button, slider input)
- **Connector snippets** — the Hue connector alone contributes 10+ snippets for both tabs (toggle specific lights, set colour, scene activation, colour picker component, brightness slider component)

Snippets are mode-aware — Logic snippets only show in the Logic tab, UI snippets only in the UI tab. One click inserts at cursor.

### Inline Docs Panel

A collapsible docs panel sits beside the editor showing context-appropriate API documentation:
- In Logic mode: `context`, `devices`, `mqtt`, `http`, `state`, `db`, `log`, `automation()` with all their methods
- In UI mode: `aeolus.read()`, `aeolus.save()`, `aeolus.fire()`, `aeolus.control()`, `aeolus.publish()`, plus available devices and execution history

No switching to browser tabs to look up the API.

---

## The Data Store: A Time-Series Database in the Sandbox

Home Assistant has a "Recorder" that stores entity state history and a "Statistics" system for long-term aggregates. Both are opaque to automations — you can read current state but can't accumulate custom data over time from within an automation.

Aeolus has a purpose-built **Data Store** accessible directly from automation scripts via the `db` global:

```javascript
// Write a timestamped record to a collection
db.write("energy-daily", { kwh: 14.2, source: "solar" }, {
  tags: { zone: "roof" }
});

// Query with time range and aggregation
const avg = db.query("energy-daily", {
  from: "30d",
  aggregate: "avg",
  field: "kwh"
});
log.info(`30-day average: ${avg.value} kWh`);

// Key-value buckets for cross-automation shared state
db.set("computed", "monthlyAvg", avg.value);
// Another automation reads it:
const target = db.get("computed", "monthlyAvg");
```

Under the hood: SQLite-backed with per-collection FIFO eviction, configurable `maxRecordsPerCollection`, retention policies (days), tag-based filtering, and 5 aggregation functions (sum, avg, min, max, count). Duration strings like `"7d"`, `"24h"`, `"30m"` are parsed into epoch-relative timestamps.

The Data Store is disabled by default (to avoid accidental SD card fill on Pi) — a setup wizard guides you through configuring storage limits before it activates.

---

## MQTT: First-Class, Not One Integration Among Thousands

In Home Assistant, MQTT is an integration you install and configure. Devices need to follow the MQTT Discovery protocol (specific JSON payloads on `homeassistant/` topics) or you manually configure them in YAML.

In Aeolus, **MQTT is the foundation**. Any device that publishes any message to any topic appears in the device registry automatically:

1. ESP32 publishes `sensor/garden/moisture` with `{"value": 45}`
2. Mosquitto delivers it to the backend's wildcard subscription
3. MqttService parses the topic structure → derives a device ID
4. NormalizedEvent is created with `{ topic, deviceId, state, timestamp }`
5. DeviceRegistry upserts the device (creates if new, updates state if existing)
6. `DEVICE_STATE_CHANGE` event fires on the bus
7. Automation engine evaluates all rules whose topic pattern matches
8. WebSocket broadcasts the state change to all connected dashboards

Zero configuration. No discovery protocol. No YAML. Plug in a device, it appears. The topic structure (`sensor/garden/moisture`) becomes the device's identity.

For commands back to devices, automations call `mqtt.publish("valve/irrigation/command", JSON.stringify({ action: "open" }))` — the ESP32 subscribes to its command topic and acts.

---

## Observability: Built-In, Not Bolt-On

### Home Assistant
- Logbook (human-readable event log)
- History (entity state over time, stored via Recorder)
- Statistics (long-term aggregates for energy)
- Prometheus integration available via community add-on
- No built-in metrics dashboard — you need Grafana

### Aeolus (Built Into the Platform)

**Prometheus `/metrics` endpoint** — 19+ metrics in Prometheus text exposition format:
- MQTT: messages received/published, connection state, processing duration
- Devices: active count by type, state changes per second
- Automations: execution count, duration histogram, error rate
- Connectors: health status, action latency
- HTTP: request rate, duration, status codes
- WebSocket: active connections, messages sent
- System: Node.js memory, event loop lag, CPU usage

**Two-tier metrics history** (no Grafana required):
- **Tier 1** — samples every 30 seconds, 10-minute retention, powers live sparkline charts
- **Tier 2** — 5-minute aggregates (avg, peak, spike detection), kept permanently, powers 6h/24h/7d/30d trend charts

Storage footprint: ~70MB/year for the permanent tier.

**Device state history** — per-device time-series stored in SQLite with:
- Configurable recording interval (throttled to prevent SD card wear)
- Auto-pruning after N records
- Pure SVG charts with Catmull-Rom spline interpolation
- Multi-series support, hover tooltips, time range picker (15m/1h/6h/24h)
- Per-device or global history clearing

**Automation execution log** — every rule execution records:
- Which rule fired, what topic triggered it
- Each action attempted, whether it succeeded or failed (with error message)
- Total execution duration in milliseconds
- Timestamp

All visible from the dashboard with dedicated panes — no external tooling needed.

---

## Deployment and Infrastructure

| Aspect | Aeolus | Home Assistant |
|--------|--------|----------------|
| **Install** | `docker compose up` | Flash HassOS to SD card, or supervised install on Debian |
| **Containers** | 3 (Mosquitto, backend, frontend/nginx) | 1 monolith + add-on containers |
| **Database** | SQLite (single `.db` file, portable) | Recorder (SQLite/MariaDB/PostgreSQL) |
| **Updates** | `git pull && docker compose up -d --build` | One-click from UI (HassOS) or manual |
| **Backup** | Copy one `.db` file | Snapshot system (full or partial) |
| **RAM usage** | ~150MB | ~500MB–1GB+ depending on integrations |
| **Production hardening** | Read-only system routes, no Docker socket mount, no git/build tools in image | Depends on install type |

The entire platform state is one SQLite file. Copy it to a USB stick, put it on another Pi, `docker compose up` — you're running.

### Security Hardening (From the Actual Image)

- **Read-only system router** — no shutdown, reboot, or Docker prune endpoints. System control is SSH-only.
- **No Docker socket mount** — the backend cannot control the host's Docker daemon.
- **Minimal production image** — no git, docker-cli, or build tools in the final layer.
- **Version baked at build time** — git commit hash embedded during Docker build, no runtime git needed.
- **MQTT security** — three configurable levels (Open, Shared Password, Per-Device credentials). Switching levels regenerates the Mosquitto password file and reloads the broker automatically.
- **Auth stack** — bcrypt (cost 12), short-lived JWTs (15min), httpOnly refresh cookies (7 days), rate-limited login (5 attempts/min per IP), WebSocket auth via query param token.

---

## What Home Assistant Does Better

Being honest about where HA wins:

1. **Integration count** — 2,500+ vs a handful. If you need Sonos, Roomba, Ring, Nest, and 20 other ecosystems, HA supports them today.
2. **Community size** — Massive forums, Discord, Reddit, YouTube tutorials, HACS marketplace. Aeolus is a single-developer project.
3. **Voice assistants** — Native Alexa/Google Home integration and the Assist pipeline for local voice control.
4. **Mobile app** — Polished companion apps for iOS and Android with location tracking, notifications, and device sensors.
5. **Non-developer accessibility** — The UI-first approach means anyone can set up basic automations without writing code.
6. **Maturity** — 10+ years of development, battle-tested by hundreds of thousands of users.
7. **Add-on ecosystem** — Grafana, Node-RED, VS Code, ESPHome, zigbee2mqtt — all installable as supervised containers from the UI.

---

## What Aeolus Does Better

1. **Automation expressiveness** — Real JavaScript/TypeScript with full language features vs YAML + Jinja2 templates. No ceiling on complexity. async/await, loops, API calls, state machines — just code.
2. **Custom UI** — Write JSX components that render instantly on save vs configuring Lovelace cards in YAML or authoring web components with HA's custom card lifecycle.
3. **The paired model** — Each automation is a backend script + frontend component connected by a reactive state store over WebSocket. No other platform does this.
4. **Sandbox security** — User code runs in isolated V8 contexts (32MB, 5s timeout). A buggy script can't access the filesystem, consume unlimited memory, or crash the host. HA custom integrations share the Python process with core.
5. **Developer experience** — Monaco editor with IntelliSense, inline docs, snippet library, flow diagrams, activity feeds. The experience you'd expect from an IDE, not a home automation tool.
6. **Simplicity** — Three Docker containers, one SQLite file, 23 event types on one bus. The entire architecture fits in your head. HA's codebase is hundreds of thousands of lines across thousands of integrations.
7. **Resource efficiency** — ~150MB RAM on a Raspberry Pi. HA with a dozen integrations easily consumes 1GB+.
8. **MQTT as foundation** — Zero-config device discovery for any MQTT device. Publish a message, device appears. HA requires either MQTT Discovery protocol payloads or manual YAML configuration.
9. **Connector authoring** — Implement a TypeScript interface (5 methods), export metadata and a factory function. No manifest files, config flows, entity platforms, or Python packaging.
10. **Data Store** — Automations can accumulate time-series data, query with aggregation, and share computed state across rules. HA automations can't write to a persistent data layer.
11. **Hot-loading** — UI components transpile and render in milliseconds on save. No container restart, no build step, no page refresh.
12. **Action results** — Every device action returns `{ success, error? }`. HA service calls are fire-and-forget — you don't know if they worked unless you poll entity state afterward.

---

## Who Should Use What

| If you... | Use |
|-----------|-----|
| Want to connect 50 different commercial devices with minimal effort | Home Assistant |
| Need voice assistant integration (Alexa, Google, Siri) | Home Assistant |
| Don't want to write code | Home Assistant |
| Want a massive community and marketplace | Home Assistant |
| Are a developer who wants real code automations with IntelliSense | **Aeolus** |
| Build custom hardware (ESP32, Arduino) and want zero-friction MQTT | **Aeolus** |
| Want to write custom React dashboard components that render on save | **Aeolus** |
| Need a system that operates fully offline on constrained hardware | **Aeolus** |
| Need sandboxed execution where user code can't crash the system | **Aeolus** |
| Have unusual hardware and want to write a connector in an afternoon | **Aeolus** |
| Need automations to accumulate data and query it over time | **Aeolus** |
| Are deploying to a disconnected environment (farm, boat, research station) | **Aeolus** |

---

## Summary

Home Assistant answers: *"How do I automate my home without being a programmer?"*

Aeolus answers: *"How do I automate my environment **as** a programmer?"*

The core abstractions — event bus, sandboxed execution, pluggable connectors, local state, custom UI, offline operation — are edge-computing concepts. IoT and home automation happen to be the first use case, but if you removed the Hue and Kasa connectors tomorrow, the platform would still make sense deployed on a research station, a greenhouse, a boat, or a remote solar installation.

### Where It's Going

What exists today is the core — a solid runtime, a handful of connectors, and a developer experience that proves the model works. But Aeolus is designed to grow through contributions:

- **The connector framework exists specifically to be extended.** One TypeScript file, 5 methods, and your hardware is part of the ecosystem. The guy building a custom ocean sensor buoy doesn't care that another platform supports 2,500 integrations — he cares that he can write support for his device in an afternoon.
- **Automation recipes and custom UI components are portable code** — shareable, version-controllable, domain-agnostic.
- **The architecture is intentionally simple** — 3 containers, 1 event bus, clear separation of concerns. A new contributor can understand the full system in an afternoon.

The bet is that developers who deploy Aeolus for their own environments will naturally contribute back the connectors and automations they build. The framework makes that contribution path as frictionless as possible.

