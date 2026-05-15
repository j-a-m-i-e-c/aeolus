---
inclusion: auto
description: Core project context, design standards, and architecture reference for Aeolus
---

# Aeolus Project Context

## Project Overview

Aeolus is a self-hosted, local-first IoT platform running on Raspberry Pi. It bridges custom microcontrollers (ESP32/Arduino via MQTT), commercial smart devices (Philips Hue, TP-Link Kasa via pluggable connectors), and external APIs into one unified system with code-driven automations and a React dashboard.

**Key characteristics:**
- Single-user, local network deployment (no auth needed for MVP)
- Three Docker services: Mosquitto MQTT broker, Express.js backend, React frontend (nginx)
- SQLite (sql.js) for all persistence — no external database
- MQTT 5.0 protocol with message expiry on published commands
- Automation scripts run in isolated-vm V8 sandboxes (32MB memory, 5s timeout)
- Custom React UI components transpiled at runtime, loaded via dynamic import

## Current Feature Set

- **MQTT-first device communication** — bidirectional, any topic accepted
- **Pluggable connector framework** — Hue (color/CT/Zigbee search/firmware awareness), Kasa (auto-discovery)
- **Services framework** — Cron schedules, API triggers, system events
- **Code-driven automations** — Monaco editor with IntelliSense, flow diagrams, custom React UI components
- **Data Store** — persistent time-series collections + key-value buckets (disabled by default, setup wizard)
- **Modular dashboard** — 3 pinned tabs (System, Connectors, Data) + custom tabs with drag-and-drop panes
- **State history** — per-device SVG trend charts with time range filtering
- **Self-update** — one-click update from the dashboard via Docker rebuild

## Design & Branding

When designing or modifying any frontend UI, always reference `docs/BRANDING.md` for:

- Color palette: Aeolus Blue `#3BA4FF`, Wind Cyan `#5CE1E6`, Deep Void `#0B0F14`, Graphite `#121821`, Slate `#1A2330`
- Feedback colors: Emerald `#22C55E` (success), Amber `#F59E0B` (warning), Soft Red `#EF4444` (error)
- Text hierarchy: Primary `#E6EDF3`, Secondary `#9AA6B2`, Muted `#6B7785`, Border `#2A3441`
- Typography: Inter (primary), JetBrains Mono (code/MQTT topics)
- Design pillars: clarity over decoration, bold contrast, subtle motion, data-first UI, airy spacing
- Motion: 150-250ms ease-in-out transitions, no bouncing — "feels like airflow"
- Components: cards with `#121821` bg and 12-16px border radius, thin stroke Lucide icons
- Signature gradient: `linear-gradient(135deg, #3BA4FF, #5CE1E6)` — used sparingly for hero elements

Use Tailwind theme tokens (background, surface, primary, accent) rather than raw hex values.

## Architecture Quick Reference

```
Event Sources (MQTT devices, Connectors, Services)
        ↓
Internal Event Bus (DEVICE_STATE_CHANGE, AUTOMATION_STATE_CHANGE, etc.)
        ↓
Device Registry (SQLite) + Automation Engine (V8 Sandbox)
        ↓
Actions (MQTT publish, device actions, HTTP webhooks, logging)
        ↓
WebSocket Server → React Dashboard (real-time updates)
        ↓
Data Store (time-series collections, key-value buckets)
```

## Key Reference Documents

- `docs/COMPREHENSIVE_DOCUMENTATION.md` — Full technical docs (MUST be updated with every significant change)
- `docs/BRANDING.md` — Design system, color palette, typography, component styles
- `docs/ROADMAP.md` — Future plans and opportunities
- `docs/production-deployment.md` — MQTT auth, HTTPS, firewall, backups, monitoring
- `docs/MICROCONTROLLERS.md` — ESP32/Arduino MQTT templates
- `src/connectors/README.md` — Connector developer guide

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 22, Express, TypeScript (strict), sql.js, mqtt.js (MQTT 5.0), isolated-vm, pino |
| Frontend | React 19, Vite, Zustand, Tailwind CSS, Monaco Editor, Lucide, Framer Motion |
| Testing | Vitest, fast-check (property-based testing), supertest |
| Infra | Docker Compose, Eclipse Mosquitto 2, GitHub Actions CI/CD |
| Quality | ESLint (flat config), Zod validation, express-rate-limit, structured error responses |

---

**Last Updated**: 2026-05-15
