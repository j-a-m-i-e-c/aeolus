---
inclusion: auto
description: Current project context, design standards and architecture boundaries for Aeolus
---

# Aeolus project context

## Project overview

Aeolus is a self-hosted, local-first edge application platform. It joins MQTT devices, local product integrations, automation Logic, custom React UI and persistent site data in one installation.

The normal deployment is a Raspberry Pi or Linux host running:

- Eclipse Mosquitto;
- a Node.js/TypeScript backend;
- a React frontend served by nginx;
- a local SQLite database.

## Current platform characteristics

- Authentication is always active for the dashboard and API.
- Human JWT access and MQTT broker credentials are separate systems.
- The default Compose deployment does not grant the backend Mosquitto file or reload privileges; dashboard MQTT provisioning needs explicit deployment wiring.
- Persistence uses `better-sqlite3` with versioned startup migrations.
- MQTT devices and connector-backed products enter a common device/event model.
- Bundled connectors are registered explicitly in `src/index.ts`.
- Script Logic runs in fresh `isolated-vm` isolates with memory and time limits.
- Custom React UI runs inside an opaque-origin sandboxed iframe.
- Logic and its paired UI share private persistent automation state.
- The Data Store provides time-series collections and key-value buckets.
- Logs, metrics, device history, health and migration checkpoints are platform features.
- Commands can model dispatch, acknowledgement and observed outcomes where the path supports them.
- Aeolus reports update availability but does not self-update from the dashboard.

## Design and branding

For frontend work, use `docs/BRANDING.md`.

Important design principles:

- clarity over decoration;
- data first;
- strong contrast;
- restrained motion;
- useful empty and failure states;
- Tailwind theme tokens instead of scattered raw colours.

## Architecture quick reference

```text
MQTT devices and local products
              ↕
MQTT service and connector manager
              ↓
typed event bus
       ↙             ↘
device registry   automation engine
       ↘             ↙
      SQLite, REST and WebSocket
              ↕
dashboard and sandboxed custom UI
```

For the component-level diagram, see `docs/reference/architecture.md` or the detailed architecture section in `docs/WHY_AEOLUS.md`.

## Key reference documents

- `docs/README.md` - documentation map
- `docs/WHY_AEOLUS.md` - technical product argument
- `docs/reference/` - current implementation reference
- `docs/security/` - authentication, permissions and MQTT security
- `docs/production-deployment.md` - deployment and operations
- `docs/MICROCONTROLLERS.md` - MQTT device examples
- `src/connectors/README.md` - connector developer guide
- `docs/ROADMAP.md` - active and future work

`.kiro/specs/` contains historical implementation plans. Treat the code, tests and maintained reference docs as current when a completed spec differs from them.

## Technology

| Layer | Technology |
|---|---|
| Backend | Node.js 22, Express, TypeScript, `better-sqlite3`, mqtt.js, `ws`, `isolated-vm`, pino |
| Frontend | React 19, Vite, Zustand, Tailwind CSS, Monaco, `react-grid-layout` |
| Testing | Vitest, fast-check, supertest, Testing Library, Playwright |
| Infrastructure | Docker Compose, Eclipse Mosquitto, nginx, GitHub Actions |

## Source entry points

```text
src/index.ts
src/core/
src/automations/
src/connectors/
src/data-store/
src/api/routes/
src/websocket/
frontend/src/sandbox/
frontend/src/lib/
```

Last reviewed: 2026-08-02
