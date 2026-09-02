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
| `GET` | `/api/devices/:id/completion-tiers` | Read the dispatch/acknowledgement/observation tiers this device can prove |
| `POST` | `/api/devices/:id/action` | Execute a device action |
| `GET` | `/api/devices/:id/history` | Query state history |
| `DELETE` | `/api/devices/:id/history` | Clear one device history |
| `DELETE` | `/api/devices/history/all` | Clear all device history |
| `GET` | `/api/devices/:id/mqtt-command-profile` | Read a generic MQTT device's command profile (requires device `read`) |
| `PUT` | `/api/devices/:id/mqtt-command-profile` | Set/clear the profile (requires device `write`; MQTT devices only) |
| `GET` | `/api/state` | Devices keyed by ID |
| `POST` | `/api/mqtt/publish` | Publish an MQTT message |

The MQTT command profile declares generic-MQTT acknowledgement capability and
optional QoS (see [Microcontrollers](../MICROCONTROLLERS.md)). The body is
validated and sanitized: QoS must be `0`/`1`/`2`, the acknowledgement response
topic must be a concrete topic (no `+`/`#`), and unknown fields are dropped. A
non-MQTT device returns `400`.

### Device action outcomes

`POST /api/devices/:id/action` returns the full command result as the body
(`success`, `lifecycleState`, `error`, `failureKind`) and maps the outcome to an
expressive HTTP status. The body is authoritative; the status lets clients that
only read status codes react correctly.

| Outcome | Status |
|---|---|
| Success (`DISPATCHED` / `ACKNOWLEDGED` / `OBSERVED`) | `200` |
| Missing/empty action type (pre-flight) | `400` |
| Not authorized for the device | `403` |
| Device not found (`failureKind: not_found`) | `404` |
| Observed state conflicts with the request (`STATE_MISMATCH`) | `409` |
| Unsupported action / invalid params (`unsupported` / `invalid_params`) | `422` |
| Connector/device errored downstream (`execution`) | `502` |
| Broker or connector unavailable (`transport`) | `503` |
| Command timed out (`TIMED_OUT`) | `504` |

There is no `202`: the route awaits the configured completion outcome within the REST action
timeout, so a dispatched-but-unconfirmed command resolves to `DISPATCHED` (200)
or `TIMED_OUT` (504).

`DISPATCHED` and `ACKNOWLEDGED` are successful completion tiers, not necessarily lifecycle-final states. While a command remains under observation, later evidence can still advance it to `ACKNOWLEDGED` or `OBSERVED`; only `OBSERVED`, `FAILED`, `TIMED_OUT` and `STATE_MISMATCH` are lifecycle-final.

## Automations

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/automations` | List rule metadata (`hasUi`, not authored UI source) |
| `POST` | `/api/automations` | Create a rule; new script rules require an Automation Project |
| `PUT` | `/api/automations/:id` | Update rule metadata/trigger; script source updates use Project data |
| `DELETE` | `/api/automations/:id` | Delete a rule |
| `PATCH` | `/api/automations/:id/toggle` | Enable or disable a rule |
| `POST` | `/api/automations/:id/fire` | Fire a rule manually |
| `POST` | `/api/automations/trigger/:name` | Fire a named API trigger |
| `GET` | `/api/automations/history` | Recent execution history |
| `GET` | `/api/automations/snippets` | Editor snippets |
| `GET` | `/api/automations/types` | Logic editor type declarations |
| `GET` | `/api/automations/ui-types` | Custom UI type declarations |
| `GET` | `/api/automations/:id/project` | Read the authored Automation Project source tree |
| `PUT` | `/api/automations/:id/project` | Compile and replace the authored Project atomically |
| `GET` | `/api/automations/:id/ui-module` | Compiled custom UI module |
| `GET` | `/api/automations/:id/state` | Read private automation state |
| `PUT` | `/api/automations/:id/state` | Save a state value |
| `DELETE` | `/api/automations/:id/state/:key` | Delete a state value |

## Command history

Durable history for every verified physical command (see
[Automations](automations.md)). Admin only, because command history can
disclose device names and behaviour.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/commands` | Bounded, newest-first list. Filters: `deviceId`, `ruleId`, `executionId`, `state`, `sourceKind`, `limit` (clamped) |
| `GET` | `/api/commands/:commandId` | One command with its chronological transition timeline |

The list never returns an unbounded result; `limit` defaults to 50 and is
clamped to a maximum of 200.

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

A record query accepts `from` (duration string such as `24h`, or epoch ms), `to`,
`limit`, `offset`, `tags`, and `aggregate` with `field`.

Record queries are always bounded. `limit` defaults to 100 and is clamped to a
maximum of 5000; a `limit` below 1 or a negative `offset` is rejected. The
response `total` still reports how many records matched the range, so a caller
can tell it received a bounded window. The export route is the deliberate
exception and returns the whole collection.

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
- `command-lifecycle` — a command lifecycle transition was durably recorded (admin-only)
- `automation-event` — an automation event was seen on the reserved namespace (admin-only)

The WebSocket layer maps internal event names to public message types at startup rather than hardcoding each event in the server class.

Broadcast visibility is fail-closed. Each mapping carries a server-derived
`BroadcastEnvelope` that decides who may observe an event; the server never
trusts a visibility hint on the payload:

- `public` — every authenticated client. Used for the raw `mqtt-message` feed,
  which is a discovery firehose (its value is seeing topics before anything
  consumes them), so scoping it to already-known devices would defeat its
  purpose. Admins can carve out sensitive topics with private topic filters (see
  below); a message matching one is downgraded to `admin`.
- `admin` — admins only. This is the default for any event without an explicit
  scope, so a new producer leaks nothing until its scope is defined. The
  `data-store-*` events are admin-only today, as is any `mqtt-message` whose
  topic matches a private topic filter.
- `tabs` — non-admins receive it only when they can access one of the listed
  tabs, using the same resolvers as REST authorization. `state-change` resolves
  to the device's exposing tabs and the `automation-*` events resolve to the
  automation's exposing tabs. An empty tab set reaches admins only.

See:

```text
src/websocket/ws-server.ts
frontend/src/lib/ws-client.ts
```

### Private topic filters

These endpoints control which raw MQTT topics are withheld from non-admins on
the live feed. A filter is a standard MQTT topic filter (`+` for one level, `#`
as the last level); a message whose topic matches any filter is broadcast to
admins only.

- `GET /api/mqtt/private-topics` — list the filters. Any authenticated user.
- `POST /api/mqtt/private-topics` — add a filter (`{ "pattern": "home/locks/#" }`).
  Any authenticated user; marking a topic private only ever hides data. The
  pattern is validated as a well-formed MQTT filter (bad `+`/`#` placement is
  rejected with 400).
- `DELETE /api/mqtt/private-topics/:id` — remove a filter (re-exposes the topic).
  Admin only, because this is the data-exposing direction.

Matching and filter validation live in `src/mqtt/topic-filter.ts` and are used
by both `src/mqtt/private-topic-store.ts` and the request schema so evaluation
and validation never diverge.

## Error shape

Expected API failures use a consistent JSON shape:

```json
{
  "error": "Description",
  "details": {}
}
```

Validation errors include Zod issues in `details`. Unexpected errors are logged server-side and do not expose stack traces in production.
