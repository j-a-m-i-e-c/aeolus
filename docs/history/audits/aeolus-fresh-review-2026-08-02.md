> **SUPERSEDED — historical audit.** The issues described below have since been
> addressed. This report is retained only for history; it does not describe the
> current state of Aeolus. See `docs/BACKLOG.md`, `docs/ROADMAP.md` and the
> `.kiro/specs/` for current status.

# Aeolus fresh pre-public review

**Archive reviewed:** `aeolus-main(10)`  
**Review date:** 2 August 2026  
**Review goal:** identify bugs or contradictions worth fixing before public promotion, while treating clearly documented early-alpha limitations as acceptable unless they undermine a headline guarantee or ordinary use.

## Executive verdict

Aeolus is in substantially better shape than the versions reviewed earlier. The previous authorization release gates are not merely checked off in the backlog; the fixes are present in the runtime composition and supporting tests. In particular, non-admin automation authority is now immutable in the important direction, device-event admission is scope-aware before user Logic sees an event, read surfaces are filtered, Data Store access is scoped/admin-gated, connector/provisioning secrets are better handled, initial MQTT connection failure recovers, and the deployment/documentation story is more coherent.

I would **publish the source repository and present Aeolus to employers as an early alpha today**, with one important distinction: I would fix the release gates below **before relying on the ordinary live application's control path in a public demo or inviting early adopters to trust it with valuable authored work**.

The remaining blockers are concentrated. They do not invalidate the architecture. They are exactly the kind of composition bugs that appear when individually good subsystems are connected together.

### Current assessment

| Area | Assessment |
|---|---:|
| Portfolio value | **9.4 / 10** |
| Architecture / engineering judgement | **9.0 / 10** |
| Testing posture | **9.1 / 10** |
| Documentation / communication | **9.2 / 10** |
| Product differentiation | **9.0 / 10** |
| Usefulness to technical early adopters after the gates below | **~8 / 10** |
| Broad product maturity today | **~6 / 10** |

The project remains unusually strong evidence for IoT, edge, backend and platform-oriented roles.

---

# Release gates found in this fresh review

## P0 — The unified command boundary is currently mis-composed for REST/dashboard/custom-UI device actions

**Severity:** Critical functional / architectural composition bug  
**Status:** Not adequately covered by the current backlog. The roadmap says the common command path still needs convergence, but this is an ordinary-path breakage rather than a future enhancement.

There are three related problems in the same path.

### 1. REST source tags are interpreted as automation IDs

`POST /api/devices/:id/action` correctly performs resource authorization first, then calls:

```ts
commandService.execute(
  { type: req.body.type, target: id, params: req.body.params ?? {} },
  `rest:${id}`,
)
```

`CommandService` has one `AutomationScopeResolver` wired globally. Its `checkScope()` calls:

```ts
scopeResolver.resolve(ruleId)
```

for **every** command source. Unknown rule IDs intentionally resolve to an empty fail-closed scoped authority.

Therefore `rest:<device-id>` is treated as an unknown automation. A normal `toggle` command is rejected because the empty scope contains no devices. This also affects admins: route-level admin authorization does not carry through to `CommandService` because the command service no longer knows that the source is REST/admin; it only sees the string `rest:<id>`.

Relevant code:

- `src/api/routes/device.routes.ts:189-206`
- `src/automations/command-service.ts:129-159`
- `src/automations/command-service.ts:352-388`
- `src/automations/automation-scope-resolver.ts:52-78`

There is a revealing contract mismatch in `CommandServiceDeps`: its comment says absence of a scope resolver covers a non-automation command source, but production has one singleton `CommandService` with the scope resolver always present.

### 2. Native device actions do not map through the generic device handler

The dashboard sends action types such as:

```text
toggle
brightness
color
color-temp
rename
delete
on
off
```

But the composition root registers only these general handlers:

```text
publish
toggle
device_action
log
delay
webhook
```

plus connector-contributed custom action types such as `hue_scene`.

So even after fixing the source-scope problem, a REST `brightness` or `color` request reaches `CommandService`, finds no handler for that action type, and returns `unsupported` before `ActionRouter` ever sees the device's own action catalog.

Representative callers:

- `frontend/src/components/DeviceDetail.tsx`
- `frontend/src/components/panes/HueControlPane.tsx`
- `frontend/src/components/panes/hue/ColorTempSlider.tsx`
- `frontend/src/components/panes/KasaControlPane.tsx`
- the custom UI SDK `aeolus.control()` path

### 3. MQTT device dispatch has an explicit dependency setter that production never calls

`ActionRouter` requires `setMqttService()` before it can execute MQTT device actions:

```ts
if (!this.mqttService || !this.mqttService.isConnected()) {
  return { success: false, error: "MQTT broker not connected" ... };
}
```

`ConnectorManager` exposes `setMqttService(mqttService)`, and the ActionRouter tests explicitly call it. I could find no production call to `connectorManager.setMqttService(mqttService)` in `src/index.ts` or elsewhere outside tests.

Relevant code:

- `src/connectors/connector-manager.ts:135-141`
- `src/connectors/action-router.ts:298-304`
- `src/index.ts:139-185`

This means generic MQTT device control can report “broker not connected” even while the application-level `MqttService` is connected.

### 4. Hue brightness's fallback action schema disagrees with the actual connector/UI

The generic capability descriptor declares brightness as:

```ts
{ level: 0..100 }
```

while the Hue connector and dashboard use:

```ts
{ brightness: 0..254 }
```

`ActionRouter` performs descriptor validation before the connector executes. Once the command route is correctly connected, this mismatch can make a valid dashboard brightness action fail validation.

Relevant code:

- `src/connectors/capability-action-map.ts:39-52`
- `src/connectors/hue/hue-connector.ts:215-223`
- `frontend/src/components/panes/HueControlPane.tsx:85-88`

### Why CI can still be green

The current tests validate the individual pieces but not their production composition:

- the device-route test mocks `CommandService` and checks only that it receives a `rest:<id>` source tag;
- the “source-independent” `CommandService` property test constructs the service without the production scope resolver;
- MQTT `ActionRouter` tests manually call `setMqttService()`;
- the Playwright suite does not exercise a real device-action request through the production dependency graph.

This is exactly the sort of bug a composition/integration test should catch.

### Recommended fix

Do not patch this with special string-prefix checks such as `ruleId.startsWith("rest:")`. Make the source model explicit.

For example:

```ts
type CommandSource =
  | { kind: "automation"; ruleId: string }
  | { kind: "rest"; label?: string }
  | { kind: "system"; label: string };
```

Apply `AutomationScopeResolver` **only** when `source.kind === "automation"`. REST resource authorization has already happened at the route boundary.

Normalize REST-native device actions through the generic physical-device handler:

```ts
commandService.execute(
  {
    type: "device_action",
    target: id,
    params: {
      actionType: req.body.type,
      ...(req.body.params ?? {}),
    },
  },
  { kind: "rest" },
)
```

Then:

1. call `connectorManager.setMqttService(mqttService)` at composition time;
2. choose one canonical brightness contract and make the descriptor, UI, connector and examples agree;
3. add a production-composition integration test covering at least:
   - admin/user permitted Kasa toggle;
   - Hue brightness;
   - explicit Kasa `off`;
   - MQTT command publishing;
   - denied out-of-scope REST action;
   - scoped automation still denied when it fabricates another device id.

**I would fix this before filming the live product or promoting the interactive demo.** It affects one of the first things a reviewer is likely to click.

---

## P0 — `devices.actionAll()` bypasses the sandbox's scoped device inventory

**Severity:** Critical authorization-information leak under the advertised group model  
**Status:** Not in the backlog and contradicts the current permissions documentation.

`Sandbox.setDevicesRefs()` correctly computes a scoped `allDevices` list and injects only that list into:

```ts
devices.list()
devices.get()
devices.filter()
```

But the host callback for `devices.actionAll()` discards that scoped list and does:

```ts
const all = deviceRegistry.getAll();
matched = all.filter(filter);
```

before dispatching each matched device through `CommandService`.

The command boundary prevents the actual out-of-scope command from succeeding, which is good, but the damage has already happened:

- the user-supplied predicate can be evaluated against hidden device objects;
- the returned `BulkActionResult` can contain hidden device IDs and failure entries;
- counts and state-dependent predicate behaviour become an information side channel.

This directly conflicts with `docs/security/permissions.md`, which says the sandbox injects only the in-scope device inventory.

Relevant code:

- correct scoped inventory: `src/automations/sandbox.ts:798-805`
- scope-bypassing bulk path: `src/automations/sandbox.ts:862-930`

### Recommended fix

Use the already-computed scoped `allDevices` in the host callback:

```ts
matched = allDevices.filter(filter);
```

or make an immutable scoped copy specifically for the action callbacks. Do **not** call the full registry again inside `actionAll()`.

Add tests proving that for a scoped rule:

- the predicate is never invoked with a hidden device;
- hidden IDs never appear in `BulkActionResult`;
- only in-scope targets reach `CommandService`;
- unrestricted/admin-authored rules retain full-inventory behaviour.

This is a small fix with high value.

---

## P0 / High — Removing an automation pane can permanently delete the automation itself

**Severity:** High destructive UX; I would treat it as a pre-early-adopter gate  
**Status:** The backlog correctly says automation deletion is unrecoverable, but it understates the current coupling between *removing a view* and *deleting authored logic*.

The dashboard model explicitly supports an automation being exposed by multiple tabs/panes. `automation_tab_assignments` is many-to-many, and the permission resolver unions those exposing tabs.

However, removing an automation pane currently deletes the underlying automation immediately:

- `frontend/src/components/TabLayout.tsx` sends `DELETE /api/automations/:id` before calling `removePane()`;
- `frontend/src/store/dashboard-store.ts`'s `removePane()` sends **another** delete request for the same automation;
- the backend DELETE is a hard delete and also removes stored state.

There is no confirmation here. Removing one dashboard view can therefore destroy hand-written Logic/UI used elsewhere.

This becomes worse for non-admin `write` users because of the layout issue below: their automation DELETE may succeed while the layout PUT fails, leaving the persisted pane pointing at an automation that no longer exists.

Relevant code:

- `frontend/src/components/TabLayout.tsx:96-109`
- `frontend/src/store/dashboard-store.ts:207-220`
- `src/api/routes/automation.routes.ts:488+`

### Recommended fix before real users author valuable applications

**Decouple pane lifetime from automation lifetime.**

- X / “Remove pane” should remove only the pane.
- Delete Automation should be an explicit operation from the automation editor/management screen.
- Add confirmation before the hard delete now; soft-delete/archive can remain on the roadmap.
- Remove the duplicate DELETE call.

If you later want “delete rule when removing the last pane”, it should be an explicit second choice after checking all references, not an implicit side effect.

This is more urgent than implementing full soft-delete because it prevents accidental destruction through an action that looks like presentation/layout management.

---

## High — `write` permission still advertises layout editing that the backend refuses to persist

**Severity:** High permission/UX contradiction; not a security escape  
**Status:** Not listed in the backlog; documentation currently promises behaviour the UI/backend combination does not deliver.

`docs/security/permissions.md` defines `write` as:

> Edit panes, automation configuration and other writable content.

The frontend follows that contract. A `write` user can:

- drag/resize panes;
- add panes;
- open pane settings;
- remove panes;
- create a new automation pane.

Those operations update the dashboard store and eventually call `PUT /api/layout`.

But the backend layout mutation route is:

```ts
router.put("/", requireAdmin, ...)
```

So every non-admin write user's layout mutation fails after the UI has already accepted it. The failure is only logged to the browser console and the local state remains changed until reload.

Relevant code:

- `docs/security/permissions.md:11-17`
- `src/api/routes/layout.routes.ts:91-100`
- `frontend/src/components/TabLayout.tsx:31-32`, `114+`
- `frontend/src/store/dashboard-store.ts:241-247`

### Two legitimate fixes

**Small early-alpha fix:** make dashboard/pane layout editing admin-only in the frontend and update the permission wording. Keep non-admin `write` for scoped automation authoring/editing.

**More complete fix:** create a tab-scoped layout mutation endpoint guarded by `requireTabPermission("write")`, and have the server accept/mutate only panes belonging to that one tab. Do not let a non-admin submit a full-layout replacement.

I would choose the small fix before promotion unless non-admin dashboard composition is a feature you actively want to demonstrate now.

---

## High — Partial automation updates silently clear the chosen completion tier

**Severity:** High product-truthfulness / data-integrity bug  
**Status:** Not in the backlog.

`updateAutomationBodySchema` correctly distinguishes `undefined` (omitted) from `null` (explicit clear), but the route does not preserve that distinction.

For script updates:

```ts
const completionTierValue = normalizeTier(completionTier);
```

`normalizeTier(undefined)` returns `null`, and the UPDATE always writes that value.

For form updates, `completionTierValue` is initialized to `null` and remains null when the field is omitted.

Therefore an unrelated update can erase a persisted `dispatch`, `acknowledged`, or `observed` choice.

This is not theoretical: both `AutomationPane.handleUpdate()` and `AutomationsPage.saveScript()` send partial PUTs without `completionTier`, so editing the name, trigger, Logic or paired UI can silently reset the rule to “highest available / no explicit tier”.

Relevant code:

- `src/api/routes/automation.routes.ts:415-432`
- `src/api/routes/automation.routes.ts:449-472`
- `frontend/src/components/panes/AutomationPane.tsx:328-344`
- `frontend/src/components/AutomationsPage.tsx:225+`

The same nullish-coalescing pattern means an explicit `null` cannot currently clear `conditionType` / `conditionValue`, although that is less consequential.

### Recommended fix

Use PATCH semantics consistently:

```text
undefined -> preserve existing value
null      -> explicitly clear
valid tier -> replace
```

Add regression tests for:

- update name only -> tier preserved;
- update `uiSource` only -> tier preserved;
- `completionTier: null` -> tier cleared;
- explicit valid tier -> replaced.

Because truthful command completion is a headline Aeolus idea, I would fix this before public promotion even though the implementation change is small.

---

# Important observations that are already acceptably documented

I do **not** consider the following reasons to delay an early-alpha public launch because the repository now states the boundary honestly.

## Generic MQTT acknowledgement configuration

The parser and correlation machinery exist, but generic discovered MQTT devices still lack a persisted profile that declares acknowledgement support. This is explicitly tracked in `docs/BACKLOG.md`. Keep it visible because acknowledgement is a major differentiator, but it is no longer a hidden contradiction.

## Managed MQTT provisioning remains opt-in

Keeping it behind `MQTT_MANAGED_PROVISIONING_ENABLED=true` is the right release posture. The known revocation-verification limitation and broker health-check mismatch are documented. I would not hold the release for completing this subsystem.

## Trusted reverse proxy / rate limit topology

Documented and reasonable to defer. The default local/LAN model remains understandable.

## Outbound HTTP / SSRF consolidation

The remaining DNS-rebinding/redirect concerns and form-webhook difference are explicitly documented. Under the stated mostly-trusted small-site model, this is legitimate hardening backlog rather than a release blocker.

## Pending commands are lost on process restart

Documented limitation. This is important for future industrial-adjacent use but acceptable in early alpha if you do not claim restart-safe in-flight command reconciliation.

## State provenance across connectors

The code deliberately does **not** confuse optimistic connector updates with physical observation. A generic provenance envelope is on the roadmap. That is a good, truthful interim state.

## Limited connector catalogue / no Modbus yet

Product maturity, not a defect. Modbus remains one of the best next integrations for the market you are targeting.

## Custom UI capability grants remain a trusted-code boundary

The iframe isolation is strong in the browser sense: opaque origin, MessageChannel RPC, no token, no generic network bridge. However, the host broker's device-control/MQTT operations ultimately execute under the **viewer's** authenticated authority, and the immutable `FrameGrant` contains the automation/panel identity rather than a manifest of allowed device/topic capabilities.

That creates a potential confused-deputy problem if untrusted users are ever allowed to author UI that a more privileged user then opens. Importantly, `docs/WHY_AEOLUS.md` already says custom UI should be treated as administrator-authored or explicitly trusted code and explicitly calls out future manifest-level permissions. Under the current threat model that is an acceptable documented boundary, **provided you do not market the custom UI sandbox as safe third-party plugin isolation**.

I would add the manifest/capability work to the formal backlog eventually so this important boundary is visible somewhere other than the architecture narrative.

---

# Smaller fresh findings / polish

These are worth tracking but not public-promotion gates.

### Native named-trigger pane vs admin-only endpoint

`POST /api/automations/trigger/:name` is now correctly admin-only, but a trigger-button pane can still be visible/clickable to a non-admin with `interact`; it will simply receive a 403. Either hide/disable this pane for non-admins or migrate it toward resource-bound automation firing.

### Access-token role/group claims can remain stale for up to 15 minutes

Password resets revoke refresh tokens, and WebSockets are closed when their access token expires. Existing JWT access tokens still carry the old `role`/`groupId` until their 15-minute expiry. This is a normal stateless-JWT tradeoff for the stated threat model, not a release blocker. If immediate admin demotion/revocation ever matters, add a token version or live-user lookup for privileged operations.

### Single-segment MQTT state topics derive `set`

The current fallback command-topic derivation replaces the final topic segment with `set`. For a topic containing no `/`, e.g. `pump`, that yields `set`, not `pump/set`. This is deterministic and tested, so it is not accidental in code, but it is surprising. The future per-device MQTT command profile makes the fallback less important; alternatively define/document the convention explicitly.

---

# What the latest release-gate work successfully fixed

The following previous concerns were rechecked and are materially improved in this archive:

- non-admins cannot edit, delete or toggle an unrestricted/admin-authored automation and inherit its authority;
- device-triggered scoped automations reject out-of-scope events **before** conditions/Logic can see state;
- `/api/state` and the initial WebSocket snapshot follow server-derived resource visibility;
- device action catalogs/history and automation history are permission-filtered;
- layout reads are filtered to accessible tabs;
- Data Store reads are collection-scoped while mutation/config/buckets are admin-only;
- generic named triggers are admin-gated;
- system/log routes are admin-only;
- connector password fields are redacted from connector status responses;
- MQTT provisioning status hides the shared plaintext credential from ordinary users;
- admin password resets revoke refresh tokens;
- Hue contributed handlers now propagate the actual connector dispatch result rather than manufacturing success;
- Data Store auto-create respects `maxCollections`;
- initial MQTT broker failure enters indefinite background retry;
- broker URLs are redacted in MQTT logs;
- Node is consistently pinned to `22.22.1` across `.nvmrc`, engines, Docker and CI;
- Compose defaults the backend to production mode;
- the frontend image uses `npm ci`;
- production/deployment documentation is much closer to the actual Compose topology.

This is a substantial improvement over the earlier builds.

---

# Testing assessment

The testing architecture is excellent for a personal/open-source early platform:

- ~134 backend test files;
- ~98 frontend test files;
- unit + property + integration coverage;
- 90% general coverage thresholds;
- explicit resource-authorization integration suites;
- sandbox broker/property tests;
- daily/manual Playwright E2E;
- Docker image builds gated behind CI on `main`.

The fresh command-path finding demonstrates the remaining test blind spot: **production composition**.

A route mock, a service unit test and an ActionRouter unit test can all be correct while the real dependency graph is wrong.

I would add one small “real composition command path” integration suite that uses the same dependency wiring strategy as `src/index.ts` and proves:

1. authorized REST `toggle` reaches the connector;
2. Hue/native brightness reaches the connector with the correct params;
3. an explicit `off` reaches Kasa;
4. an MQTT device publishes through the live/stub MqttService injected at composition;
5. unauthorized REST is rejected before dispatch;
6. a scoped automation still cannot escape its device set.

Also add a scoped `actionAll()` test and the completion-tier partial-update regression tests described above.

### Execution caveat for this review

I could not complete a clean dependency/test run in the supplied review environment. The runtime available here is older than the repository's now-correct Node `22.22.1` pin, and dependency installation through the available package environment failed. A retry against the public registry also failed at the container-tool level. I therefore **do not claim this archive's test suite passed in my environment**.

Use a green GitHub Actions run on the exact commit/tag you promote as the authoritative execution check.

---

# Portfolio assessment

Aeolus remains an exceptional portfolio project.

The important part is no longer repository size. It demonstrates genuine reasoning in areas that ordinary full-stack portfolios rarely touch:

- unreliable physical outcomes rather than HTTP-success semantics;
- MQTT 5 correlation and command evidence;
- capability-driven device abstraction;
- local edge operation and broker recovery;
- sandboxed user Logic and custom UI boundaries;
- layered authorization and server-derived resource exposure;
- connector instance ownership/lifecycle;
- SQLite schema evolution, backups and rollback;
- failure-aware execution gating;
- observability, history and retention;
- Docker/Raspberry Pi operations;
- systematic response to architectural review.

For a hiring manager evaluating a full-stack engineer moving toward IoT/edge, Aeolus is powerful evidence that the transition is already underway rather than aspirational.

The current bugs do not make the project embarrassing as source code. In fact, the architectural story around discovering and fixing composition errors is useful interview material. The distinction is that a **live demo should not visibly fail on its primary control path**, and an early adopter should not be able to delete valuable Logic by clicking what looks like “remove this pane”.

---

# Industry / real-user usefulness

The niche remains credible:

> a reusable local platform for developers and small integrators building custom software around a physical place.

The strongest real users are still things like:

- rural water / energy / shed systems;
- greenhouses and workshops;
- escape rooms and immersive installations;
- stage/show control;
- research rigs and scientific instrumentation;
- mixed MQTT + commercial-device installations;
- bespoke local operator interfaces.

The biggest barriers to broader adoption after the release gates are now ecosystem and product operations, not a weak central architecture:

- external user validation;
- automation portability/recovery;
- connector breadth;
- Modbus;
- onboarding;
- real field history;
- stronger state provenance;
- restart-safe in-flight command reconciliation for stricter environments.

That is a healthy place for an early platform to be.

---

# Recommended release cutoff

## Fix before promoting the interactive application

1. **Repair the unified command-source/device-action composition.**
   - explicit command source type;
   - REST-native action normalization;
   - wire MQTT into `ConnectorManager`/`ActionRouter`;
   - align brightness contract;
   - add production-composition tests.
2. **Scope `devices.actionAll()` to the injected device set.**
3. **Stop pane removal from implicitly deleting the underlying automation.**
4. **Make layout editing semantics truthful for non-admin `write` users** (either support tab-scoped writes or hide/admin-gate layout editing for now).
5. **Preserve completion tiers on partial automation updates.**
6. Require green CI on the exact public commit.

## Acceptable to leave documented

Everything presently listed in `docs/BACKLOG.md` under the stated early-alpha threat/product model can remain open, with the caveat that the automation deletion item should be raised in urgency because of the pane-removal coupling described above.

## Public-demo boundary

Continue with the separate restricted/simulated demo plan rather than handing anonymous visitors an ordinary Aeolus account. The current backlog is right on this point.

---

# Final judgement

The latest work **did close the important security release gates from the previous audit**. I no longer see the earlier pattern where the advertised resource permission system simply falls apart at adjacent REST/WS surfaces.

The fresh problems are narrower:

- a command-source abstraction added before automation scoping was later reused in a way that makes the two concepts collide;
- one bulk sandbox callback accidentally reaches past the carefully scoped inventory;
- presentation/layout lifetime is coupled too aggressively to authored automation lifetime;
- one partial-update path loses a command-evidence setting.

Those are significant enough to fix, but they are not signs that Aeolus needs another architectural rewrite.

After those items, I would be comfortable describing the repository publicly as a **credible early-alpha local edge application platform**, directing IoT/edge employers to it, and inviting technically capable early adopters to experiment with it under the documented limitations.
