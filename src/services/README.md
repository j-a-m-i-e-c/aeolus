# External Services

This directory contains integrations with external APIs and data sources that are **not** hardware device connectors.

## When to use `services/` vs `connectors/`

| Directory | Purpose | Examples |
|-----------|---------|---------|
| `connectors/` | Hardware device integrations that discover and control physical devices on the local network | Philips Hue, TP-Link Kasa, Zigbee, Z-Wave |
| `services/` | External API integrations that fetch data from the internet and feed it into the system | Weather APIs, river height data, fire danger ratings, air quality indexes |

## Key Differences

- **Connectors** manage devices — they register devices in the DeviceRegistry, handle on/off/brightness actions, and track device health.
- **Services** provide data — they poll external APIs on a schedule and emit events on the EventBus or store data for dashboard display.

## Creating a Service

Each service lives in its own subdirectory:

```
src/services/
├── README.md              ← You are here
├── weather/               ← Example: weather data service
│   ├── index.ts           ← Service entry point
│   └── weather-service.ts ← Implementation
└── river-height/          ← Example: river height monitoring
    ├── index.ts
    └── river-service.ts
```

Services will follow a similar pluggable pattern to connectors once the service framework is built. For now, create your service and wire it into `index.ts` manually.
