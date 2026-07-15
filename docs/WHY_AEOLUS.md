# Why Aeolus?

> **New here?** For a plain-English, no-jargon introduction, start with [What Is Aeolus?](./WHAT_IS_AEOLUS.md). This document is the deep technical version.

Aeolus is a local-first platform for building applications that run physical environments. It ingests events from arbitrary hardware, runs your business logic in a secure sandbox, persists state, and renders custom interfaces you write yourself — all self-hosted on hardware you control.

The shorter version: it's the development experience you already have as a software engineer — TypeScript, React, a real editor, version control, Docker — applied to the physical world.

Home automation is the most familiar way to demonstrate it — almost everyone can picture controlling lights, sensors, and switches — but it's only one example. The architecture is domain-agnostic: the same runtime works for a greenhouse, a workshop, a boat, a solar installation, or an industrial monitoring site. Everything runs on your LAN by default — fast, private, no vendor accounts. Because nothing depends on external services, it also happens to keep working offline, which makes it deployable anywhere.

---

## Why I Built This

I live on a farm. Over time I accumulated pumps, water tanks, weather stations, solar, cameras, and a pile of ESP32 sensors — all useful, all disconnected. The platforms I tried either hid programming behind configuration screens or made anything beyond a simple rule awkward to express.

I write software for a living. I wanted the experience I already have at work — real code, types, a proper editor, Git, Docker — but pointed at the physical things on my property. When I couldn't find that, I built it.

That origin matters because it shaped every design decision. Aeolus isn't a feature list assembled top-down. It started from a concrete problem — *managing real hardware in a real place* — and the architecture grew from first principles to solve it. The fact that the same runtime now works for a research vessel or a stage-lighting rig is a consequence of solving the farm problem properly, not a marketing afterthought.

---

## The Core Idea: Each Automation Is a Full-Stack Unit

This is the single most distinctive thing about Aeolus, so it leads.

Every automation has two halves: a **Logic** tab (a backend script) and a **UI** tab (a React/JSX component). They are a paired unit — the automation *is* the deployment unit — and they communicate through a private reactive state store:

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

Most automation tools keep these concerns separate: dashboards read state, automations write it, and there's no direct channel between a specific automation and a specific piece of UI. Aeolus treats each automation as a miniature application with its own backend, its own frontend, and a dedicated reactive channel between them — both halves user-authored, the platform supplying only the runtime and the wiring.

That single abstraction is what makes the rest of the platform feel less like a home-automation tool and more like an application framework for the edge.

---

## A Real Programming Environment

The promise is simple: if you're already a software engineer, you shouldn't have to give up your tools to automate the physical world. No YAML state machines, no visual node editors, no proprietary DSL — just code.

### Automation: Code, Not Configuration

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

This is just code. Loops, conditionals, async/await, external API calls, persistent state — no templates, no helper-entity workarounds, no escape hatches. TypeScript annotations are optional (stripped at transpile time), so you can write plain JavaScript if that's your style. The point isn't TypeScript specifically — it's that you express logic in a real programming language with the full expressiveness that implies.

The moment your needs go past a simple "if sensor then action" rule — branching on an API response, maintaining state across events, applying a rolling average, composing several automations into a pipeline, unit-testing the logic in isolation — you're still just writing code instead of fighting a configuration format.

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

The sandbox is deliberate platform groundwork: if you want user-authored code to run safely — including, eventually, third-party code from other people — you need a real isolation boundary, not `eval` with good intentions.

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

### Transpilation: esbuild, Not the TypeScript Compiler

Scripts are transpiled using **esbuild** (the same tool Vite uses) — not the full TypeScript compiler. This means:
- Transpilation is near-instant (microseconds, not seconds)
- Type annotations are stripped, not checked — write `const x: number = 5` if you want, or don't
- The editor provides IntelliSense from type definitions served via API, so you get autocomplete without needing to type anything yourself
- `import`/`require` statements are explicitly rejected before transpilation — all APIs are globals, keeping the sandbox secure

---

## Custom UI: Live React Components Paired to Their Automation

Every automation has a UI tab, and the feedback loop is instant — save and it renders. The UI component and its backend script are a single unit with a dedicated communication channel, not a dashboard card that happens to read some shared state.

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

An automation script receives the same `context` object regardless of whether the event came from an ESP32 publishing raw JSON, a Hue light polled via HTTP, or a Kasa plug discovered via UDP broadcast. The script doesn't know or care about the underlying protocol. Reducing every input — sensor, commercial device, weather API — to one event model is the abstraction that lets the platform scale to new hardware without growing new subsystems.

### Topic Matching — MQTT Wildcards

The automation engine supports full MQTT wildcard matching:
- `sensor/+/temp` — matches any single-level segment (e.g. `sensor/kitchen/temp`, `sensor/bedroom/temp`)
- `sensor/#` — matches everything under a prefix (e.g. `sensor/kitchen/temp`, `sensor/garden/soil/moisture`)

Plus cron-triggered rules (`*/5 * * * *` — every 5 minutes) and manual fire (no trigger topic, execute on demand).

---

## The Connector Framework: Designed for Community Contributions

This is the part with the highest leverage. Platforms win on ecosystems, not features — so the connector framework was designed with one goal: make it so easy to add hardware support that any developer with a device and an afternoon can do it.

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

This is the contribution path: you buy some hardware (Shelly plugs, Zigbee sensors, a Sonos speaker, an industrial PLC), write a connector for it, and submit a PR. The platform grows one developer at a time, each bringing their own hardware. The person building a custom ocean-sensor buoy doesn't care how many integrations exist elsewhere — they care that they can support *their* device in an afternoon.

### The Action System: Verified Execution, Not Fire-and-Forget

Every device action flows through a central `ActionExecutor` with a handler registry pattern and a **three-tier verification lifecycle**:

```
devices.action("pump-1", "start", { speed: 80 }, {
  condition: (state) => state.running === true,
  timeoutMs: 10000
})
    │
    ▼ REQUESTED
ActionExecutor.execute(...)
    │
    ▼ DISPATCHED (broker/hub accepted the command)
PendingCommandTracker.register(correlationId, timeout)
    │
    ├─── Device publishes ack → ACKNOWLEDGED
    │
    ├─── Observed state satisfies predicate → OBSERVED ✓ (success: true)
    │
    ├─── Timeout elapses → TIMED_OUT ✗ (success: false)
    │
    └─── Observed state contradicts → STATE_MISMATCH ✗ (success: false)
```

**Three truthful tiers, degrading by device capability:**

1. **Dispatch (universal)** — the broker or hub accepted the command. Every device supports this. `DISPATCHED` is the honest terminal state for simple devices.
2. **Acknowledged (capability-gated)** — the device itself confirms receipt. Only available when a connector declares an acknowledgement capability. Uses MQTT 5 Correlation Data and Response Topic properties for precise command-to-reply matching.
3. **Observed (opt-in via `confirm`)** — a sensor or state reading confirms the physical effect. Works regardless of whether the actuator can acknowledge — you just need something that reports the resulting state.

Built-in action handlers: `publish` (MQTT), `toggle`, `device_action`, `log`, `delay`, `webhook`. Connectors register additional handlers when enabled (`hue_scene`, `hue_color_loop`, etc.) and unregister them when disabled. The system never throws — every action returns an `ActionResult` with `success`, `lifecycleState`, and optional `error`, so your logic can branch on whether a command was sent, acknowledged, or physically confirmed.

The same truthfulness extends to script execution: the sandbox reports whether a script actually ran to completion (vs. throwing, timing out at 5s, or exhausting 32MB), so the execution log, metrics, and downstream events reflect reality rather than assuming success.

---

## The Dashboard: Modular, Composable, Permission-Aware

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

The **Automation Pane** isn't just a card showing status — it's the entire development environment:
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

Automations don't just react to events — they can accumulate data over time and query it back. The **Data Store** is accessible directly from automation scripts via the `db` global:

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

The Data Store is disabled by default (to avoid accidental SD card fill on a Pi) — a setup wizard guides you through configuring storage limits before it activates.

---

## MQTT: First-Class, Not One Integration Among Many

MQTT is the foundation, not a plugin. Any device that publishes any message to any topic appears in the device registry automatically:

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

## Deployment, Infrastructure, and Security

The entire platform state is one SQLite file. Copy it to a USB stick, put it on another Pi, `docker compose up` — you're running.

- **Install** — `docker compose up`. Three containers: Mosquitto (MQTT broker), the Express backend (API + automation engine + WebSocket), and the React/nginx frontend.
- **Updates** — `git pull && docker compose up -d --build`. Schema migrations run automatically on startup — the database upgrades itself to the version the new binary expects, transactionally, with a pre-migration backup. No manual SQL, no downtime.
- **Backup** — copy one `.db` file. (The migration system also creates automatic `.pre-migration.*.bak` snapshots before each upgrade.)
- **Footprint** — ~150MB RAM, comfortable on a Raspberry Pi 4/5.
- **Downgrade safety** — if you accidentally run an older binary against a newer database, Aeolus refuses to start rather than silently corrupting data.

### Security Hardening (From the Actual Image)

- **Read-only system router** — no shutdown, reboot, or Docker prune endpoints. System control is SSH-only.
- **No Docker socket mount** — the backend cannot control the host's Docker daemon.
- **Minimal production image** — no git, docker-cli, or build tools in the final layer.
- **Version baked at build time** — git commit hash embedded during Docker build, no runtime git needed.
- **MQTT security** — three configurable levels (Open, Shared Password, Per-Device credentials). Switching levels regenerates the Mosquitto password file and reloads the broker automatically.
- **Auth stack** — bcrypt (cost 12), short-lived JWTs (15min), httpOnly refresh cookies (7 days), rate-limited login (5 attempts/min per IP), WebSocket auth via query param token.

---

## How It Compares to Home Assistant

Home Assistant is the obvious reference point in this space, so it's worth being precise about the difference — and honest about the tradeoffs.

Home Assistant is configuration-driven: you describe automations in YAML, configure integrations through a UI, and reach for Jinja2 templates when the visual editor runs out of expressiveness. It's built so that non-programmers can automate their homes without writing code, and it does that extremely well, backed by 2,500+ integrations and a huge community.

Aeolus makes the opposite bet. It assumes you *are* a programmer and gives you a real programming environment — real code, a real editor, real composition — rather than a configuration layer. That's a deliberate narrowing: it's not trying to serve everyone.

| Principle | Aeolus | Home Assistant |
|-----------|--------|----------------|
| **Automation language** | JavaScript/TypeScript in a secure V8 sandbox | YAML + Jinja2 templates |
| **UI customisation** | Write JSX/TSX components, rendered live on save | Lovelace cards (YAML config) or custom card JS |
| **Device communication** | MQTT-native + pluggable connector framework | 2,500+ Python integrations |
| **Data persistence** | SQLite — single file, zero config | MariaDB/PostgreSQL/SQLite (recorder) |
| **Deployment model** | 3 Docker containers, one command | HassOS image or supervised install |
| **Extension mechanism** | Connectors implementing a TypeScript interface | Python integrations + HACS |
| **Sandboxing** | User code in isolated V8 (32MB, 5s, no fs) | Custom integrations share the core Python process |
| **Target user** | Developers, engineers, tinkerers who code | Everyone — from beginners to advanced |

### Where Home Assistant Wins

Being honest about this matters more than a feature checklist:

- **Breadth** — 2,500+ integrations. If you want to connect 50 commercial devices with minimal effort, HA is the pragmatic choice.
- **Voice assistants** — Alexa, Google, Siri integration is mature.
- **No code required** — a non-programmer can build a working smart home. Aeolus expects you to write code.
- **Community and marketplace** — vastly larger today, with HACS, forums, and blueprints.

### Who Should Use What

| If you... | Use |
|-----------|-----|
| Want to connect many commercial devices with minimal effort | Home Assistant |
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

## On-Device AI: Vision at the Edge

The connector and event-bus design has a natural extension that's worth calling out on its own, because it lines up with where edge hardware is heading: **on-device machine vision**.

Recent Raspberry Pis accept a small AI accelerator over PCIe or USB — the Raspberry Pi AI Kit / AI HAT+ (a Hailo-8/8L NPU), or a Google Coral Edge TPU. A module roughly the size of a stick of gum runs a vision model — object detection, classification, pose — directly on the device at real-time frame rates. No GPU server, no cloud inference API, no footage leaving the box.

The important part, architecturally, is that this needs **no new subsystem in Aeolus**. A detection is just another event. A small process on the Pi runs the model against a camera feed and publishes results to MQTT exactly like any other sensor:

```
camera/trailcam-01/detection  →  { "species": "fox", "confidence": 0.94, "box": [x,y,w,h], "ts": 1751932800 }
```

From there it flows through the pipeline already described: MqttService normalises it into a `NormalizedEvent`, the device registry upserts a `camera` device, `DEVICE_STATE_CHANGE` fires, and the automation engine evaluates rules against it. An automation reacts to a detection the same way it reacts to a tank level or a door sensor — there is no special "AI path":

```javascript
// Trigger topic: camera/+/detection
const { species, confidence } = context.state;
if (confidence < 0.7) return;

state.set("lastSpecies", species);
db.write("wildlife-sightings", { species, confidence }, { tags: { camera: context.deviceId } });

const PREDATORS = ["fox", "feral-cat", "wild-dog"];
if (PREDATORS.includes(species)) {
  devices.action("deterrent-01", "on");           // ultrasonic / strobe
  mqtt.publish("alerts/predator", JSON.stringify({ species, when: Date.now() }));
}
```

The inference is the specialised part, and it lives where it belongs — on the accelerator, behind an MQTT topic. Aeolus treats the *output* of the model as data, which is exactly the abstraction it was built around. Wire the camera to a connector instead of raw MQTT (see the *Smart Camera Integration* roadmap item) and the same events arrive through the connector framework instead — the automation code doesn't change.

This matters most where connectivity and privacy are constraints rather than conveniences: **wildlife monitoring and conservation**. Point a camera at a nest, a burrow, or a game trail; the on-site brain distinguishes a native species from an introduced predator; a detection becomes a logged sighting, a nest-temperature alert, or an instant deterrent trigger — all computed locally. Nothing about an endangered species' location is streamed to a third-party cloud, and the whole rig runs on solar with no cell signal for months. "Runs entirely on-site and keeps your data" stops being a feature bullet and becomes the reason the deployment is possible at all. The plain-English [What Is Aeolus?](./WHAT_IS_AEOLUS.md) doc frames this use case for a general audience, and the seed ships a **Wildlife & Conservation** demo tab that simulates the whole loop — trail-cam detections, a nest monitor, a predator deterrent, and a biodiversity log.

---

## Summary

Home Assistant answers: *"How do I automate my home without being a programmer?"*

Aeolus answers: *"How do I automate my environment **as** a programmer?"*

The core abstractions — event bus, sandboxed execution, pluggable connectors, local state, paired Logic/UI applications, offline operation — are edge-computing concepts. Home automation is just the most familiar way to demonstrate them, but if you removed the Hue and Kasa connectors tomorrow, the platform would still make sense on a research station, a greenhouse, a boat, or a remote solar installation.

None of the individual pieces — React, Monaco, isolated-vm, MQTT, Docker, WebSockets — are new. What's unusual is the combination, and the consistent philosophy behind it: bring the modern software-development experience to the physical world, and treat every automation as a full-stack application rather than a configuration entry.

### Where It's Going

What exists today is the core — a solid runtime, a handful of connectors, and a developer experience that proves the model works. Aeolus is designed to grow through contributions:

- **The connector framework exists specifically to be extended.** One TypeScript file, 5 methods, and your hardware is part of the ecosystem.
- **Automation recipes and custom UI components are portable code** — shareable, version-controllable, domain-agnostic.
- **The architecture is intentionally simple** — 3 containers, 1 event bus, clear separation of concerns. A new contributor can understand the full system in an afternoon.

The bet is that developers who deploy Aeolus for their own environments will naturally contribute back the connectors and automations they build. The framework makes that contribution path as frictionless as possible.
