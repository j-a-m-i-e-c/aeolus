# API and WebSocket reference

The backend serves JSON over HTTP and live updates over WebSocket.

Unless listed as public, routes require:

```http
Authorization: Bearer <access-token>
```

Exact request schemas are defined under `src/api/schemas/` and tested with the route handlers.

## Public routes

| Method | Path | Purpose |
|---|---|---|
| `GET`, `HEAD` | `/api/health` | Health check |
| `GET` | `/api/system/version` | Build and update information |
| `GET` | `/api/auth/status` | Whether first-run setup is required |
| `POST` | `/api/auth/setup` | Create the initial admin |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/refresh` | Refresh an access token using the cookie |
| `GET` | `/metrics` | Prometheus output, optionally protected by `METRICS_TOKEN` |

## Devices and MQTT

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/devices` | List devices |
| `GET` | `/api/devices/:id` | Read one device |
| `GET` | `/api/devices/:id/actions` | Read its action catalog |
| `POST` | `/api/devices/:id/action` | Execute a device action |
| `GET` | `/api/devices/:id/history` | Query state history |
| `DELETE` | `/api/devices/:id/history` | Clear one device history |
| `DELETE` | `/api/devices/history/all` | Clear all device history |
| `GET` | `/api/state` | Devices keyed by ID |
| `POST` | `/api/mqtt/publish` | Publish an MQTT message |

## Automations

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/automations` | List rules |
| `POST` | `/api/automations` | Create a rule |
| `PUT` | `/api/automations/:id` | Update a rule |
| `DELETE` | `/api/automations/:id` | Delete a rule |
| `PATCH` | `/api/automations/:id/toggle` | Enable or disable a rule |
| `POST` | `/api/automations/:id/fire` | Fire a rule manually |
| `POST` | `/api/automations/trigger/:name` | Fire a named API trigger |
| `GET` | `/api/automations/history` | Recent execution history |
| `GET` | `/api/automations/snippets` | Editor snippets |
| `GET` | `/api/automations/types` | Logic editor type declarations |
| `GET` | `/api/automations/ui-types` | Custom UI type declarations |
| `GET` | `/api/automations/:id/ui-module` | Compiled custom UI module |
| `GET` | `/api/automations/:id/state` | Read private automation state |
| `PUT` | `/api/automations/:id/state` | Save a state value |
| `DELETE` | `/api/automations/:id/state/:key` | Delete a state value |

## Connectors

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/connectors/available` | List bundled connector types |
| `GET` | `/api/connectors` | List configured instances |
| `POST` | `/api/connectors` | Create or enable an instance |
| `PATCH` | `/api/connectors/:id` | Update configuration or enabled state |
| `DELETE` | `/api/connectors/:id` | Delete an instance |
| `GET` | `/api/connectors/:id/status` | Connector health |
| `POST` | `/api/connectors/:id/retry` | Retry connection |
| `GET` | `/api/connectors/:id/setup-steps` | Read setup flow |
| `POST` | `/api/connectors/:id/setup/:stepId` | Execute a setup step |
| `POST` | `/api/connectors/:id/search-lights` | Start Hue light search |
| `GET` | `/api/connectors/:id/search-lights/status` | Read Hue search status |

## Data Store

| Method | Path | Purpose |
|---|---|---|
| `GET`, `POST` | `/api/data-store/collections` | List or create collections |
| `PATCH`, `DELETE` | `/api/data-store/collections/:name` | Update or remove a collection |
| `GET`, `POST` | `/api/data-store/collections/:name/records` | Query or write records |
| `GET` | `/api/data-store/collections/:name/export` | Export a collection |
| `GET` | `/api/data-store/buckets` | List buckets |
| `GET` | `/api/data-store/buckets/:bucket` | Read a bucket |
| `PUT`, `DELETE` | `/api/data-store/buckets/:bucket/:key` | Set or remove a key |
| `GET`, `PUT` | `/api/data-store/config` | Read or update configuration |
| `GET` | `/api/data-store/stats` | Usage statistics |
| `POST` | `/api/data-store/enable` | Enable and configure the store |
| `POST` | `/api/data-store/disable` | Disable the store |

## Platform and layout

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/system` | Host diagnostics |
| `GET` | `/api/system/logs` | Recent structured logs |
| `GET` | `/api/system/version` | Build and update information |
| `GET` | `/api/health` | Service health |
| `GET` | `/api/metrics/summary` | Dashboard metrics summary |
| `GET`, `PUT` | `/api/layout` | Read or replace dashboard layout |

## Authentication and MQTT provisioning

The auth and provisioning endpoints are documented under [Security](../security/README.md).

## WebSocket

The WebSocket server shares the HTTP server and authenticates the connection with an access token supplied by the frontend.

On connection, the server sends an initial device snapshot. Live message types include:

- `state-change`
- `mqtt-message`
- `automation-fired`
- `automation-state`
- `data-store-write`
- `data-store-collection-deleted`

The WebSocket layer maps internal event names to public message types at startup rather than hardcoding each event in the server class.

See:

```text
src/websocket/ws-server.ts
frontend/src/lib/ws-client.ts
```

## Error shape

Expected API failures use a consistent JSON shape:

```json
{
  "error": "Description",
  "details": {}
}
```

Validation errors include Zod issues in `details`. Unexpected errors are logged server-side and do not expose stack traces in production.
