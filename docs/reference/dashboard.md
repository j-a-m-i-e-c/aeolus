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

Automation authoring includes:

- trigger selection;
- form rules;
- free-form Logic editor;
- optional custom UI editor;
- snippets and type declarations;
- execution history;
- manual fire and enable controls.

### Users and MQTT security

Admin pages manage:

- users;
- groups and tab assignments;
- broker security level controls;
- shared credentials;
- per-device MQTT credentials.

Applying those controls to Mosquitto requires a provisioning-enabled deployment. The default Compose deployment uses manual broker configuration; see [MQTT security](../security/mqtt.md).

## Modular dashboard

Custom tabs contain draggable and resizable panes. Layout is persisted through `/api/layout`.

Common pane types include:

- device and sensor views;
- automation;
- trigger button;
- activity and event feeds;
- state history;
- metrics;
- connector-specific controls;
- custom automation UI.

Pinned platform pages are separate from user-created tabs.

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
