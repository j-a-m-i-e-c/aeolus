# 🌬️ Aeolus — Developer-First IoT Automation Platform

## Overview

**Aeolus** is a local-first, developer-centric IoT automation platform designed to unify communication between microcontrollers, smart home devices, and external APIs through a clean, extensible architecture.

It replaces visual automation tools with a **code-first approach**, enabling engineers to define automations using TypeScript or Kotlin while maintaining full control over integrations, events, and system behavior.

> “All devices communicate through the wind.” — Aeolus

---

## Core Philosophy

### 1. Local-First

* Runs on a Raspberry Pi or local server
* No cloud dependency required
* Low latency, high reliability
* Privacy-focused

### 2. Developer Experience First

* Automations written in real code (TypeScript/Kotlin)
* Git-based workflows
* Testable logic
* Strong typing and IDE support

### 3. Event-Driven Architecture

* MQTT acts as the central event bus
* Everything is a publish/subscribe event
* Decoupled, scalable system

### 4. Extensible Integration System

* Clean plugin SDK
* Supports APIs, MQTT devices, and future protocols
* Community-driven ecosystem

---

## High-Level Architecture

```
[ External APIs (Hue, TP-Link, etc.) ]
                ↓
        [ Integration Layer ]
                ↓
        [ Core Engine (Aeolus) ]
                ↓
            [ MQTT Bus ]
                ↓
    [ Microcontrollers / Sensors ]
                
        [ REST/WebSocket API ]
                ↕
        [ React Dashboard ]
```

---

## Core Components

### 1. Core Engine

Runs on the Raspberry Pi. This is the brain of Aeolus.

#### Responsibilities:

* Device registry
* State management
* Automation execution
* Event routing
* Integration lifecycle management

#### Key Modules:

```
/core
  /devices
  /events
  /automations
  /integrations
  /state
```

---

### 2. MQTT Event Bus

Central communication layer for all microcontrollers.

#### Example Topics:

```
sensor/living-room/temp → 22.5
motion/kitchen → true
switch/desk → OFF
```

#### Responsibilities:

* Subscribe to all device topics
* Normalize incoming messages
* Emit internal events

---

### 3. Integration Layer

Handles communication with external systems (APIs, hubs, etc.)

#### Design Principles:

* Each integration is isolated
* Follows a standard interface
* Can be dynamically loaded

#### Integration Interface:

```ts
interface Integration {
  name: string
  connect(): Promise<void>
  discoverDevices(): Promise<Device[]>
  execute(action: Action): Promise<void>
  dispose(): Promise<void>
}
```

#### Example Integrations:

* Philips Hue (local bridge API)
* TP-Link smart plugs
* Future: Zigbee, BLE, cloud APIs

---

### 4. Device Abstraction Model

All devices are normalized into a unified format.

```ts
interface Device {
  id: string
  name: string
  type: "light" | "sensor" | "switch" | "climate"
  capabilities: Capability[]
  state: Record<string, any>
  integration?: string
}
```

#### Example:

```json
{
  "id": "light.living_room",
  "type": "light",
  "capabilities": ["on/off", "brightness"],
  "state": { "on": true, "brightness": 80 }
}
```

---

### 5. Automation Engine (Core Feature)

Replaces Node-RED-style flows with code.

#### Example DSL:

```ts
when("motion/living-room")
  .if(ctx => ctx.time.isNight())
  .then(() => devices.light("living-room").on())
```

#### Features:

* Strongly typed triggers
* Conditional logic
* Async actions
* Composable rules

#### Internals:

* Event listeners
* Rule registry
* Execution engine

---

### 6. API Layer

Provides access to system state and control.

#### REST Endpoints:

```
GET /devices
POST /devices/:id/action
GET /state
```

#### WebSocket:

* Real-time state updates
* Event streaming

---

### 7. Frontend Dashboard

React-based UI for monitoring and control.

#### Features:

* Device list & control
* Live sensor data
* Automation editor (future)
* System health

#### Stack:

* React + Vite
* Zustand or Redux Toolkit
* WebSocket client

---

## Event Flow Example

### Scenario: Motion → Light On

```
[ PIR Sensor ]
   ↓ MQTT publish
motion/living-room = true
   ↓
[ Aeolus MQTT Listener ]
   ↓
[ Event Engine ]
   ↓
[ Automation Triggered ]
   ↓
[ Integration Layer (Hue) ]
   ↓
[ Light Turns On ]
```

---

## Plugin System (Critical for Scale)

### Goals:

* Allow third-party integrations
* Avoid maintaining all APIs yourself

### Plugin Structure:

```
/plugins
  /hue
    index.ts
    manifest.json
```

### Example:

```ts
export default createIntegration({
  name: "hue",
  setup(ctx) {
    const lights = discoverHueLights()

    return {
      devices: lights,
      execute(action) {
        // call Hue API
      }
    }
  }
})
```

---

## Raspberry Pi Deployment

### Runtime:

* Node.js (TypeScript backend)
* MQTT broker (Mosquitto or embedded)
* Optional Docker container

### Responsibilities:

* Run core engine
* Maintain device connections
* Serve API + frontend

---

## MVP Scope (Phase 1)

### Core Features:

* MQTT ingestion
* Device registry
* Basic automation engine
* REST API

### UI:

* Device list
* Toggle controls
* Sensor display

### Integration:

* Philips Hue (single reference implementation)

---

## Future Enhancements

### Phase 2:

* Plugin marketplace
* Advanced automation editor
* Remote access (secure tunneling)

### Phase 3:

* OTA updates for microcontrollers
* Mobile app
* Multi-node clustering

---

## Key Challenges

### 1. Device Pairing UX

* Discovery (mDNS, IP scanning)
* Authentication flows (e.g., Hue button press)

### 2. State Synchronization

* Devices changing state externally
* Polling vs subscriptions

### 3. Reliability

* Network instability
* Offline devices
* Retry mechanisms

---

## Suggested Tech Stack

### Backend:

* TypeScript
* Node.js
* Fastify

### Frontend:

* React
* Zustand

### Messaging:

* MQTT (mqtt.js)

### Deployment:

* Docker (optional)
* Raspberry Pi native runtime

---

## Project Structure

```
/aeolus
  /core
  /api
  /mqtt
  /integrations
  /automations
  /frontend
  /plugins
  /scripts
```

---

## Positioning

### Not:

* Another Home Assistant clone
* A visual automation tool

### Instead:

> A developer-first IoT platform with code-driven automation and a clean architecture.

---

## Vision

Aeolus aims to become:

* The **backend framework for IoT systems**
* The **developer alternative to drag-and-drop automation tools**
* A **platform for building custom smart environments**

---

## Tagline Ideas

* “Control your world through the wind.”
* “Code your home.”
* “Where devices speak through air.”

---

## Final Notes

Aeolus is not about reinventing everything — it’s about:

* Creating **clean abstractions**
* Enabling **developer control**
* Building a **system that scales with complexity**

Start small. Build the core. Expand through plugins.

---

END OF DOCUMENT
