# Dashboard reference

The dashboard is a React 19 application built with Vite, Zustand, Tailwind CSS, Monaco and `react-grid-layout`.

## Main areas

### System

The System area shows:

- backend, broker and automation health;
- host CPU, memory, disk, temperature and uptime;
- current devices and recent activity;
- logs;
- metrics and sparklines;
- MQTT traffic inspection;
- version and update availability.

### Connectors

The Connectors area lists available and configured connector instances. It provides setup flows, status, retry, configuration and integration-specific actions such as Hue light search.

### Data

The Data area manages Data Store setup, collections, records, buckets, usage and export.

### Automations

Automation authoring is code-only. One panel creates and edits an automation, covering:

- trigger selection;
- free-form Logic editor;
- optional custom UI editor;
- snippets and type declarations;
- execution history;
- manual fire and enable controls.

There is no automation-level acknowledgement setting. A single automation may command many devices with different acknowledgement capabilities, so one level spanning the whole automation could only ever be an aspiration that the command boundary clamped per device. The required level is stated per command in Logic — `devices.action(id, type, params, { tier })` — or omitted, in which case each device independently resolves to the strongest level it can actually prove. See [Automations](automations.md) for the command result model.

Form rules are runtime-only. Existing `rule_type = 'form'` automations continue to load, run, toggle and delete, but the dashboard no longer authors them; the Logic editor is the single authoring surface.

### Users and MQTT security

Admin pages manage:

- users;
- groups and tab assignments;
- broker security level controls;
- shared credentials;
- per-device MQTT credentials.

Applying those controls to Mosquitto requires managed provisioning to be enabled. The default Compose stack already provides the shared Mosquitto files and reload sidecar without a Docker socket, but `MQTT_MANAGED_PROVISIONING_ENABLED` defaults to `false`, so broker security remains operator-managed until that feature is deliberately enabled. See [MQTT security](../security/mqtt.md).

## Modular dashboard

Custom tabs contain draggable and resizable panes. Layout is persisted through `/api/layout`.

Common pane types include:

- device and sensor views;
- automation;
- trigger button;
- activity and event feeds;
- state history;
- metrics;
- data collection (a live view of one Data Store collection);
- connector-specific controls;
- custom automation UI.

Pinned platform pages are separate from user-created tabs.

## Live event visibility

Live WebSocket events are scoped server-side to the tabs that surface each
resource, so a non-admin receives only the events for resources on tabs their
group can reach. Devices resolve their exposing tabs live from the purposeful
device panes that match them; automations and Data Store collections resolve
theirs from an explicit pane reference — a data-collection pane's
`config.collection` records which tabs surface a collection, exactly as an
automation pane's `config.ruleId` does for automations. A resource no pane
surfaces is admin-only (fail-closed).

## Frontend state

Zustand stores manage:

- authenticated user and token lifecycle;
- devices;
- dashboard layout;
- automation state;
- Data Store information;
- toasts and UI state.

REST calls provide snapshots and mutations. WebSocket messages update live device, automation and Data Store state.

## Custom automation UI

Custom UI is not imported into the dashboard JavaScript realm.

The host creates a sandboxed iframe, establishes a `MessageChannel` and provides a restricted SDK through `SdkBroker`.

Key source files:

```text
frontend/src/sandbox/SandboxHost.tsx
frontend/src/sandbox/useSandboxedComponent.ts
frontend/src/sandbox/sdk-broker.ts
frontend/src/sandbox/runtime/
```

The sandbox pool limits the number of live iframe runtimes to avoid unbounded browser and Raspberry Pi memory use.

## Pane registration

Normal pane types are registered in:

```text
frontend/src/lib/pane-registry.ts
```

Connector-specific panes are frontend code and must be registered separately from the backend connector module.

## Design system

Use [BRANDING.md](../BRANDING.md) for the current colour, typography, spacing and motion rules.
