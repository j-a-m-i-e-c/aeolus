# 🌬️ Aeolus — Roadmap

Future development plans for the Aeolus platform, organised by category.

---

## Infrastructure

### Cloudflare Tunnel for HTTPS
Expose the Aeolus dashboard securely over the internet via a Cloudflare Tunnel, enabling HTTPS access without port forwarding or self-signed certificates. This also unlocks `crypto.randomUUID()` in the browser (requires secure context) and enables push notifications.

### Authentication & User Management
Add user accounts with login, session management, and role-based access control. Protect the API and dashboard so only authorised users can view devices, trigger actions, or modify automations. Essential before exposing Aeolus over the internet.

---

## Connectors

### More Connectors (Zigbee, Z-Wave, Tasmota, Shelly)
Expand the connector library with support for popular IoT protocols and device ecosystems. Zigbee (via zigbee2mqtt) and Z-Wave would cover a wide range of sensors and actuators. Tasmota and Shelly connectors would add support for popular DIY and off-the-shelf Wi-Fi devices.

### External Services Framework
A structured way to integrate external APIs (weather forecasts, river height data, energy prices, calendar events) as virtual devices in the Aeolus device registry. Services would poll external APIs on a schedule and emit events through the standard event bus, making external data available to automations and the dashboard.

---

## Dashboard

### Visual Flow Editor
Drag-and-drop canvas for building automations visually (Node-RED style). Nodes for triggers, conditions, and actions connected by wires. Would generate the same underlying rule structure as the form-based editor and TypeScript DSL, providing a more intuitive way to create complex multi-step automations.

### State History & Charts
Store the last N values per device in SQLite and display trend charts in the device detail modal and as a dedicated pane type. Line charts for sensor data (temperature, humidity over time), bar charts for energy usage, and event timelines for switches and motion sensors.

### Device Offline Detection
Mark devices as offline if no message is received within a configurable timeout. Show offline status in the device grid with a visual indicator, and optionally trigger automations when a device goes offline (e.g. send a notification if a critical sensor stops reporting).

---

## Platform

### Multi-Node Clustering
Run Aeolus across multiple Raspberry Pis with shared state and distributed device management. A primary node would coordinate automations and state, while secondary nodes handle local MQTT ingestion and connector communication. Useful for large homes or buildings with multiple floors.

### Mobile App
React Native companion app for quick device control, push notifications when automations fire, and at-a-glance sensor readings. Would communicate with the Aeolus backend via the existing REST API and WebSocket server.

### Plugin Marketplace
Community-contributed connectors and pane types installable from the dashboard. A registry of published plugins with one-click install, automatic dependency resolution, and version management. Would lower the barrier for extending Aeolus without writing code.
