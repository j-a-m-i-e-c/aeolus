# Connector architecture

Connectors adapt local products and APIs to the Aeolus device model. Hue, Kasa and Aeolus Remote are bundled.

For implementation steps, use the [connector developer guide](../../src/connectors/README.md).

## Module contract

A connector module exports:

- `metadata`
- `configSchema`
- `createConnector(config)`

It may also export:

- editor snippets;
- automation action handlers;
- condition factories;
- an action catalog.

Bundled production connectors are listed in `src/connectors/bundled.ts`, which `src/index.ts` registers and the offline `aeolus-secrets` CLI reads to know which fields are secrets. `ConnectorRegistry.discoverFromDirectory()` is available for development and testing, but adding a folder alone does not place a connector in the production bundle.

## Runtime lifecycle

```text
register module
      ↓
enable instance
      ↓
validate configuration
      ↓
createConnector()
      ↓
connect()
      ↓
discoverDevices()
      ↓
register devices and contributed automation types
      ↓
poll and execute actions
      ↓
disconnect and dispose
```

`ConnectorManager` restores enabled connector records from SQLite during startup.

Polls are chained per instance, never concurrent: the next is scheduled only when the current one settles, at the delay the connector asks for (`getPollIntervalMs()`, clamped to 5 s – 1 h) or every 60 s. Disabling an instance cancels its timer and aborts a poll in flight, and a result that arrives afterwards is discarded. A configuration change triggers a prompt poll.

Configuration is validated before anything is persisted: required fields, then the module's `validateConfig`. Password fields are encrypted at rest ([Secrets at rest](operations.md#secrets-at-rest)) and redacted to `********` in every response; posting the mask back keeps the stored secret, and the mask is refused where no secret is stored (see the developer guide).

## Device ownership

Connector devices set their `integration` field to the connector ID (the type). They also record a `connectorInstanceId` identifying the specific enabled instance that discovered them, so multiple instances of one type — two Hue bridges, two Kasa networks — stay independent:

- Action routing dispatches to the exact owning instance. If that instance is disabled, the command fails cleanly rather than being handed to a same-type sibling.
- Disabling an instance removes only that instance's devices; a sibling keeps its own.
- Type-generic contributions (action handlers, condition factories) are registered once for a type and torn down only when its last instance is disabled, so a sibling never loses functionality.

Ownership is persisted, so it survives a restart; a device discovered before ownership existed reacquires it on the next poll, falling back to type-based routing until then. Discovered devices should have stable IDs across restarts. They are normal Aeolus devices once registered, so they appear in the dashboard, emit internal state events and can trigger automations.

Device IDs must be unique across instances of the same type (namespace them by bridge/account), since the device registry is keyed by ID. The bundled connectors use immutable native IDs where available, avoiding normal cross-instance collisions, and renaming a device does not change its identity:

- Hue uses the light's `uniqueid` (its Zigbee address), e.g. `hue-00-11-22-33-44-55-66-77-0b`.
- Kasa uses the device's native id/MAC, e.g. `kasa-8006abcd1234`.

When a native identifier is missing, the connector falls back to a less stable identity (Hue to the bridge-local light index, Kasa to the host address) and logs it. These fallback IDs are not guaranteed unique across instances.

## Aeolus Remote

`src/connectors/aeolus-remote/` reads one published, granted Project API route of another Aeolus installation ([ADR-0027](../adr/0027-project-apis.md), Phase 5) and exposes it as one read-only `sensor` device, `aeolus-remote-<instance id>`, with no actions. It is not federation: there are no remote commands, events, peer discovery or shared users.

**Configuration:** base URL (origin only), endpoint path (`/api/exposed/v1/<slug>/…`, no query), API key (a `password` field), poll interval (5–3600 s, default 60), stale-after (10 s – 7 days, at least the interval, default 300), optional source-time field and "require a source time", maximum response size (1–1024 KiB, default 256), and **Allow plaintext HTTP on a trusted LAN** (default off). Several instances may be enabled.

**Transport.** Its own client (`node:http`/`node:https`); the authored-HTTP policy (ADR-0020) is untouched.

- Only the configured origin. No redirect is followed: any 3xx is an error, `Location` is never read, so the key cannot follow one.
- HTTPS by default with Node's certificate verification, checked against the configured host name; there is no option to disable it. Plain HTTP only with the flag, which shows a warning on the connector card and logs one once per origin.
- Every DNS answer is checked at connection time, in the `lookup` hook that `net.connect` dials from, and one refused answer refuses the name. Unspecified, link-local (including 169.254.169.254), multicast and reserved addresses are always refused; loopback only when the admin typed a loopback IP literal. Private, CGNAT (Tailscale) and IPv6 ULA addresses are allowed for the configured host.
- Per request, not process-wide: `autoSelectFamily` with 2.5 s per address attempt (Node's 250 ms default can miss a distant dual-stack host), a 5 s connection deadline including the TLS handshake, a 10 s request deadline, a fresh socket per poll, no compression, and the size cap on both `Content-Length` and the streamed body.

**Observation** (the device state; every key is always present):

| Field | Meaning |
|---|---|
| `data` | The current JSON reading, or `null` when there is none or access was refused |
| `sourceTime`, `sourceTimeBasis` | When the remote says the reading was observed, from the configured payload field only (Unix ms, or ISO 8601 with a zone); `payload` or `unavailable` |
| `sourceTimeProblem`, `sourceAgeMs` | `not-configured`, `missing`, `invalid` or `ahead`; and `fetchedAt − sourceTime` |
| `responseDate` | The remote's HTTP `Date` header: response metadata, never the observation time |
| `fetchedAt`, `lastAttemptAt`, `lastSuccessAt` | When this installation received and validated the reading; the last attempt; the last success |
| `stale`, `staleReason`, `error`, `httpStatus` | Freshness, a fixed reason category, a safe description, the last HTTP status |
| `lastKnown` | The last good reading, for diagnostics only |

A reading is stale when the source time is older than stale-after (even if the fetch succeeded), when the source clock is more than two minutes ahead (a clock problem, not a future observation), when a source time is required but unusable, or when the last poll failed.

| Remote answer | Effect |
|---|---|
| 2xx JSON | New reading |
| 401 | Fail closed: key missing, invalid, expired or revoked, or client disabled |
| 403 | Fail closed: possibly `EXPOSED_API_REQUIRE_HTTPS` against a plain-HTTP connection |
| 404 | Fail closed: unknown or unpublished API, missing route, or not granted; the remote does not say which |
| other 4xx, 3xx, refused address | Fail closed |
| 429 | Keep data, stale; wait for `Retry-After` (at most 15 min) |
| 5xx, timeout, network, DNS, TLS, oversized or invalid body | Keep data, stale; back off up to four intervals (at most 15 min) |

Failing closed sets `data`, `sourceTime` and `fetchedAt` to `null`; the reading survives only in `lastKnown`. The device keeps its id throughout. Health follows the last poll: `connected`, `degraded` (succeeded but stale) or `disconnected`. The key never appears in device state, health, logs or API responses. On restart the observation starts again from no reading; nothing restored is presented as fresh.

## Action catalogs

A connector can describe supported actions and parameter schemas. The manager checks the catalog before execution.

The fallback capability map provides common actions for standard capabilities. Connector-specific catalogs should be used where the external system supports richer operations. The bundled Hue and Kasa connectors provide explicit catalogs so they advertise exactly the actions they implement — Hue exposes on/off, brightness, colour, colour-temperature and bridge rename/delete per light capability; Kasa exposes on/off only. Brightness is a canonical percentage (0–100) across the command contract and normalised device state; a connector translates to its device-native scale (Hue 0–254) only at the API boundary.

## Setup flows

Connectors that require pairing can expose setup steps. Hue uses this for bridge discovery and link-button pairing. Hue local API traffic uses HTTPS. Current bridges validate against the Signify Hue Bridge CA and, when discovery supplied one, the certificate bridge ID must match. Older Bridge V2 firmware that still presents a self-signed Hue certificate uses a TLS-only identity probe before any API request is sent, then that exact certificate is pinned for the connector session. Hue API `error` objects returned inside HTTP 2xx responses are treated as command failures rather than successful dispatches.

The dashboard asks the connector for step descriptors, submits each step through the connector API and closes the flow when the connector reports completion.

## Frontend panes

A connector can provide a normal generic device experience without frontend code.

A specialised pane is useful when the integration needs controls such as:

- colour and colour-temperature pickers;
- power and energy information;
- scene selection;
- connector-specific health or pairing state.

Frontend panes are registered separately in `frontend/src/lib/pane-registry.ts`.

## Contributed automation features

While an instance is enabled, a connector module may add:

- Logic and UI snippets to the Automation Project editor;
- named condition factories to `ConditionRegistry` for retained form rules;
- advanced connector-specific command handlers to `CommandService`.

Normal code automations should use `devices.action()` against connector-owned devices. A contributed command handler is for genuinely connector-specific command types, and every contribution explicitly declares `physical: true|false` so physical-command IDs/history are not created for reporting-only helpers. The manager removes contributions when the connector is disabled.

## Main source files

```text
src/connectors/connector.interface.ts
src/connectors/connector-registry.ts
src/connectors/connector-manager.ts
src/connectors/connector-store.ts
src/connectors/action-router.ts
src/connectors/capability-action-map.ts
src/connectors/connector-config.ts
src/connectors/hue/
src/connectors/kasa/
src/connectors/aeolus-remote/
```
