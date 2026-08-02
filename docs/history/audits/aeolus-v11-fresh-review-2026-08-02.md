> **SUPERSEDED — historical audit.** The connector issues described below (Hue/Kasa
> action catalog, brightness units, device identity, listener leak) have since been
> addressed, and the interact-level rename/delete gap was subsequently closed. This
> report is retained only for history; it does not describe the current state of
> Aeolus. See `docs/BACKLOG.md`, `docs/ROADMAP.md` and the `.kiro/specs/` for
> current status.

# Aeolus fresh pre-public review — aeolus-main(11)

**Review date:** 2 August 2026  
**Scope:** Fresh static/composition audit of the uploaded `aeolus-main(11)` archive, with special attention to the previous release gates, public-facing truthfulness, bundled connector behaviour, permissions, command execution, persistence, deployment, and portfolio readiness.

## Executive verdict

The previous release-gate work is genuinely present in production code. The core platform is in the strongest state seen across these reviews: resource authorization, scoped automation authority, event admission, command-source typing, MQTT command wiring, pane deletion semantics, layout permissions, and PATCH-style automation updates are all materially improved.

**No new critical authentication/sandbox/MQTT-core security flaw was found in this pass.**

The main fresh release risk has moved outward into the **bundled Hue and Kasa adapters**. Several controls are advertised by device capabilities or the UI but are rejected or implemented incorrectly by the connector. These are high embarrassment-risk bugs because a reviewer can encounter them by simply clicking normal controls. There is also a real long-running Kasa listener leak and a documented multi-instance guarantee that the bundled Hue/Kasa device IDs do not currently satisfy.

### Recommendation

- **Public GitHub repository:** GO now, after updating stale backlog/roadmap text.
- **Link from CV / job applications:** GO.
- **Promote `aeolus.com.au`:** GO.
- **Simulated/restricted public demo:** GO if it does not rely on the affected Hue/Kasa paths.
- **Invite users to rely on bundled Hue/Kasa connectors:** fix the high-priority connector issues below first.
- **Claim bundled Hue/Kasa multi-instance independence:** do not make that claim until IDs are namespaced/stable, or explicitly document the current limitation.

## Previous release gates — verified closed

### 1. Explicit command source typing and REST device action composition

`CommandService` now uses a discriminated `CommandSource` rather than interpreting an arbitrary source string as an automation ID. The REST device route sends a canonical `device_action`, and automation scope resolution only applies to `kind: "automation"` sources.

This fixes the previous `rest:<device>` fail-closed regression.

### 2. MQTT command routing is wired in production

`ConnectorManager.setMqttService(mqttService)` is now called from production composition, so generic MQTT device actions can reach the live MQTT service.

### 3. Scoped `devices.actionAll()`

Bulk actions operate over the already-scoped device inventory instead of reopening the global registry. Hidden devices are no longer handed to a scoped predicate.

### 4. Pane removal no longer deletes automations

Removing a dashboard pane removes only the pane/reference. Explicit automation deletion is separate and guarded by confirmation.

### 5. Layout editing authority is consistent

Layout editing is now admin-only in both frontend behaviour and permissions documentation.

### 6. Partial automation updates preserve omitted fields

The automation update path distinguishes omitted values from explicit clears. Editing source/name no longer silently erases the completion tier.

### 7. Previous scoped-authoring release gates remain fixed

- Non-admin users cannot mutate unrestricted/admin-authored automations.
- Device events are admitted against the automation's live owning-tab scope before conditions or Logic receive the event.
- Scoped Logic retains device/Data Store restrictions and fails closed for raw MQTT.

## High-priority fresh findings

## H1 — Kasa plug power state mapping is wrong for ordinary plugs

**File:** `src/connectors/kasa/kasa-connector.ts`, lines 136–139.

Current logic:

```ts
const isOn = sysInfo?.relay_state === 1 || sysInfo?.light_state
  ? ((sysInfo.light_state as Record<string, unknown>)?.on_off === 1)
  : false;
```

Because of operator precedence, this is effectively:

```ts
(relay_state === 1 || light_state)
  ? light_state?.on_off === 1
  : false
```

For a normal plug with `relay_state: 1` and no `light_state`, Aeolus reports `on: false`.

This is particularly visible in `KasaControlPane`: a physically-on plug can appear off, and a user pressing the toggle can unexpectedly turn it off.

**Fix:** resolve plug and bulb power state explicitly, for example:

```ts
const lightState = sysInfo?.light_state as Record<string, unknown> | undefined;
const isOn = lightState
  ? lightState.on_off === 1
  : sysInfo?.relay_state === 1;
```

Add regression assertions for both plug `relay_state=1` and bulb `light_state.on_off=1`.

## H2 — Kasa bulb toggle ignores bulb state

**File:** `src/connectors/kasa/kasa-connector.ts`, lines 198–203.

The toggle path uses only:

```ts
const currentlyOn = sysInfo?.relay_state === 1;
```

For bulbs whose state lives under `light_state.on_off`, `currentlyOn` will generally be false, so `toggle` attempts to turn the bulb on even when it is already on.

**Fix:** reuse one canonical Kasa power-state extraction helper in both discovery and execution.

## H3 — Kasa advertises actions that its connector does not implement

Kasa bulbs are registered with:

```ts
capabilities: ["on/off", "brightness"]
```

and plugs with:

```ts
capabilities: ["on/off", "energy-monitoring"]
```

The generic action catalog therefore advertises:

- `brightness` for bulbs;
- `read-energy` for energy-monitoring plugs.

But `KasaConnector.execute()` implements only `toggle`, `on`, and `off`.

`DeviceDetail` displays a brightness slider whenever a light has the `brightness` capability, so this is an ordinary click path, not just an internal API mismatch.

**Fix choices:**

1. implement brightness/read-energy actions; or
2. stop advertising unsupported capabilities/actions; or
3. preferably give Kasa an explicit `getActionCatalog()` matching what each discovered device can actually execute.

For early alpha, option 2/3 is safer than pretending support exists.

## H4 — Kasa discovery accumulates event listeners every polling cycle

**File:** `src/connectors/kasa/kasa-connector.ts`, lines 54–94.

Every call to `discoverDevices()` does:

```ts
client.on("device-new", handleDevice);
client.on("device-online", handleDevice);
```

but never removes those listeners.

`ConnectorManager` polls connectors every 60 seconds. A long-running Aeolus instance therefore continually accumulates Kasa handlers. This can lead to `MaxListenersExceededWarning`, duplicate processing, memory growth, and increasingly confusing discovery behaviour.

**Fix:** unregister the two scan-local handlers in a `finally`/completion path, or register one permanent connector-level handler and let individual scans consume its results without adding listeners.

This should have a fake-timer test proving listener count remains constant after repeated polls.

## H5 — Hue action catalog disagrees with Hue capabilities and visible UI

Hue does not implement an explicit `getActionCatalog()`, so `ActionRouter` falls back to `CAPABILITY_ACTION_MAP`.

Several mismatches result:

### Color temperature

Hue advertises the capability string:

```ts
"color-temperature"
```

but the fallback action map is keyed by:

```ts
"color-temp"
```

The Hue UI sees `color-temperature`, displays `ColorTempSlider`, then sends the `color-temp` action. ActionRouter cannot derive a `color-temp` descriptor from the device capabilities and rejects the request before `HueConnector.execute()` sees it.

### Rename / delete

`HueConnector.execute()` supports `rename` and `delete`, and `HueControlPane` visibly exposes both controls. Neither action exists in the fallback catalog, so ActionRouter rejects them as unsupported before the connector is invoked.

### `on` / `off`

The generic `on/off` capability advertises `toggle`, `on`, and `off`. Hue implements `toggle`, but not explicit `on` or `off` cases.

**Recommended fix:** Hue should provide an explicit per-device `getActionCatalog()` generated from its `HueCapabilitySet`, plus the bridge-management actions that are actually supported. That makes the connector itself the source of truth and avoids guessing richer connector behaviour from the generic fallback map.

## H6 — Hue brightness contract is still inconsistent across state, generic UI, and snippets

The command contract is now correctly defined as `brightness: 0–100`, and `HueConnector` converts that to the Hue-native 0–254 scale.

However:

- `extractDeviceState()` still stores Hue brightness in native 0–254.
- `DeviceDetail` renders a `0..254` brightness slider and sends that raw value into the `0..100` command schema.
- Hue connector snippets still describe/send 0–254 (`brightness: 128`, slider max 254).
- `ActionRouter` optimistic state uses `Object.assign(updatedState, action.params)`, so a 50% command temporarily writes `brightness: 50` into a state model that the Hue pane otherwise interprets as 0–254.

This can cause rejected generic controls and visible state jumps.

**Recommendation:** choose one platform-state brightness representation and keep it end-to-end. The cleanest Aeolus abstraction is probably 0–100 for both command and normalized state, translating only at the Hue API boundary. Update snippets/tests accordingly.

## H7 — Bundled Hue/Kasa device IDs do not satisfy the documented multi-instance guarantee

`docs/reference/connectors.md` says two Hue bridges / two Kasa networks remain independent and correctly notes that device IDs must be unique across instances.

But the bundled connectors currently generate IDs that are not globally safe:

### Hue

```ts
const deviceId = `hue-light-${index}`;
```

Hue bridge light indexes are bridge-local. Two bridges can both expose `hue-light-1`.

### Kasa

```ts
kasa-${alias-slug}
```

Aliases are user-editable and not unique. Two devices, or devices on two connector instances, can collide. Renaming a Kasa device can also change its Aeolus identity.

The global `DeviceRegistry` is keyed only by device ID. `connectorInstanceId` does not save two devices that have already collided at the map key: one record can overwrite/absorb the other and commands may become associated with whichever instance most recently updated the device.

The multi-instance integration test uses intentionally unique mock IDs (`hue-a-light`, `hue-b-light`), so it proves ownership/routing lifecycle but not the bundled connector ID schemes.

**Fix:** create stable, globally unique IDs from a connector/native immutable identity. Good options include:

- namespace native device ID by a stable connector-instance namespace;
- use Hue bridge ID + native light ID;
- use Kasa device ID/MAC rather than alias;
- keep display name entirely separate from identity.

If migration risk makes this too large before promotion, document **bundled Hue/Kasa multi-instance device IDs as a known limitation** and remove the stronger claim until migrated safely.

## H8 — BACKLOG and ROADMAP still say the previous release gates are unfixed

This is not a runtime bug, but it is now one of the easiest ways to undermine the portfolio publicly.

`docs/BACKLOG.md` still has a top-level “Critical / High — fresh review release gates” section describing the command composition, `actionAll`, pane deletion, layout editing, and partial completion-tier bugs as open.

`docs/ROADMAP.md` also says the common command path is currently mis-composed.

Those issues are now fixed in code.

Because you have explicitly positioned the backlog as the source of truth for unfinished work, a hiring manager reading it will reasonably conclude that Aeolus still has known critical bugs that it no longer has.

**Fix before public promotion:** mark them completed/remove them from the open backlog and keep historical audit reports separate from the current backlog.

## Medium-priority fresh findings

### M1 — Hue treats every HTTP 2xx action response as success

The Hue state/rename/delete action paths check `response.ok` but do not inspect the returned Hue API result for application-level errors. The pairing flow already demonstrates that Hue responses have explicit `success`/`error` objects.

For command truthfulness, parse the action response and turn a Hue error object into an execution failure rather than reporting a dispatch merely because HTTP returned 2xx.

### M2 — Connector polling does not remove devices missing from a successful non-empty discovery

`ConnectorManager.startPolling()` replaces the per-instance `devices` set after a successful non-empty discovery, but it never removes registry devices that were in the previous set and are absent from the new result.

A device removed outside Aeolus can therefore remain stale in the registry indefinitely.

This is not catastrophic for early alpha, but it will matter for long-running sites. A sensible model is a grace period / consecutive-miss threshold before removing a device, to avoid turning one UDP miss into data loss.

### M3 — optimistic `on` / `off` state is not updated immediately

`ActionRouter` special-cases `toggle`; other actions simply merge `action.params` into state. `on` and `off` normally have empty params, so a successful explicit on/off command leaves local state unchanged until the next real device event/poll.

This is mostly UX because Aeolus correctly does not treat this optimistic state as physical observation. Consider setting `updatedState.on` explicitly for `on`/`off`, marked with provenance once provenance lands.

### M4 — production-composition command-path integration test is still valuable

The latest command composition is fixed, but the specific test proposed in the backlog is still worthwhile because several previous failures only existed where independently-correct services were wired together.

One integration test using real production composition should exercise:

- REST Hue/Kasa action;
- generic MQTT command;
- scoped automation action;
- permitted and denied resource access;
- action-catalog validation.

The new connector mismatches found in this review are a good example of why this test remains valuable.

## Documented backlog items that are acceptable for early alpha

The following do **not** need to block public promotion if the current documentation remains accurate:

- generic MQTT acknowledgement profiles;
- richer state provenance;
- pending-command reconciliation after process restart;
- managed MQTT provisioning remaining opt-in;
- proxy trust / forwarded-IP configuration;
- DNS-rebinding/redirect SSRF hardening and automation HTTP response-size limits;
- form-rule webhook egress hardening;
- metrics endpoint policy when no token is configured;
- Mosquitto reloader installing `inotify-tools` at sidecar startup;
- auth-mode-aware Mosquitto health checks;
- short-lived JWT role/group claim staleness;
- full arbitrary context overrides on manual fire;
- automation soft-delete/history;
- automation export/import;
- custom UI capability manifests / hostile third-party plugin model;
- Modbus and broader connector ecosystem;
- dedicated public-demo mode.

These are reasonable roadmap items for an explicitly early-alpha platform.

## Security / trust-boundary conclusion

This fresh pass did **not** uncover a new issue equivalent to the earlier resource-authorization or scoped-authoring escapes.

The major trust boundaries now look coherent:

- resource routes derive authorization server-side;
- read surfaces and WebSocket snapshots are filtered;
- automation authority is immutable and protected;
- event admission respects runtime automation scope;
- scoped device/Data Store access fails closed;
- REST commands no longer masquerade as automation sources;
- raw MQTT access is constrained according to the documented model;
- connector credentials/system diagnostics are gated/redacted.

The remaining custom-UI trust assumptions are explicitly documented and are reasonable for early alpha as long as Aeolus is not advertised as a safe marketplace for arbitrary hostile plugins.

## Portfolio assessment

### Current portfolio quality: **about 9.4/10**

The latest release-gate work improves the project as a hiring artifact because it demonstrates not only implementation volume, but architectural response to real failure modes:

- uncertain physical command outcomes;
- capability/action validation;
- resource authorization;
- runtime authority propagation;
- event-scope admission;
- isolated Logic/UI execution;
- MQTT identity/routing;
- connector ownership;
- versioned migrations and backups;
- startup retry / operational resilience;
- test architecture across unit/property/integration/E2E layers.

The new connector issues do not undermine that assessment. In fact, they are typical of a maturing integration platform: the core abstractions have become stricter than some older adapters that need to catch up.

What would be embarrassing is not that these bugs existed, but publicly advertising those connector capabilities after they are known. Fixing or documenting them is enough.

## Real-world usefulness

### Technical early adopters: **around 8/10 once the connector click-path issues are fixed**

Aeolus now has a credible niche for developers/integrators building software around unusual physical places:

- farms and rural water systems;
- workshops;
- greenhouses;
- escape rooms;
- stage/show installations;
- research rigs and instrumentation;
- custom energy systems;
- mixed MQTT + commercial-device environments.

The central platform is increasingly not the adoption bottleneck. The main barriers are now connector breadth, connector polish, onboarding, portable applications, and external field history.

That is a much healthier product-stage problem than fundamental architecture.

## Practical pre-promotion list

### Fix before relying on Hue/Kasa in a demo or inviting early adopters

1. Fix Kasa plug/bulb state extraction and bulb toggle.
2. Remove or implement Kasa's advertised brightness/read-energy actions.
3. Stop Kasa discovery listener accumulation.
4. Give Hue a truthful explicit action catalog (color-temp, rename/delete, on/off semantics).
5. Normalize Hue brightness state/action/snippet units.
6. Fix or document bundled Hue/Kasa multi-instance device identity.
7. Update BACKLOG/ROADMAP so resolved critical issues are no longer listed as open.

### Strongly recommended but not launch blockers

8. Parse Hue API application-level action errors.
9. Reconcile devices that disappear from successful connector discovery.
10. Add a production-composition command-path integration suite.

## Release matrix

| Surface | Recommendation |
|---|---|
| Public source repository | **GO** after stale backlog cleanup |
| Website promotion | **GO** |
| CV/job applications | **GO** |
| Technical overview / architecture docs | **GO** |
| Seeded/simulated screenshots | **GO** |
| Restricted simulated live demo | **GO**, assuming it does not depend on broken Hue/Kasa controls |
| Demo centred on real Hue/Kasa controls | **Fix H1–H6 first** |
| Encourage technical users to self-host | **After H1–H7** |
| Claim general production readiness | **No — continue calling it early alpha / in development** |

## Execution caveat

A clean dependency/test run could not be completed inside the review environment. The repository correctly requires Node 22.22.1, while the sandbox provides Node 22.16.0, and the sandbox's internal npm mirror returned a 404 for a locked package during `npm ci`.

This is not evidence of a repository failure. A **green GitHub Actions run on the exact commit/tag promoted publicly** should remain the authoritative execution gate.

## Bottom line

Aeolus has reached a point where another broad security redesign is **not** the thing standing between it and public promotion.

The previous release-gate architecture is in place. The fresh issues are mostly the result of older Hue/Kasa integrations not fully conforming to the newer, stricter Action Catalog and multi-instance contracts.

Fix those visible adapter problems, clean the stale backlog, require green CI, and then promote it. The next highest-value feedback will increasingly come from real external users rather than repeated internal architecture reviews.
