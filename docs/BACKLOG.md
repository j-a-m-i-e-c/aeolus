# Aeolus — In Progress Backlog

## Threat model

Aeolus targets small, local-first deployments — a household, farm, or single
site with a handful of mostly-trusted users — not large multi-tenant SaaS with
thousands of untrusted accounts. The security work below is about making the
permission features Aeolus advertises (groups, tabs, roles) actually hold, and
preventing accidental cross-user data exposure and truthfulness violations
(e.g. forged acknowledgements) — not about defending a hostile public-internet
surface. Priorities follow accordingly: correctness of the advertised
authorization model first, hardening against determined insiders second.

## Status legend
- 🔴 Critical — fix before describing the system as multi-user/secure
- 🟠 High — deployment/lifecycle correctness / pre-promotion blocker
- 🟡 Medium — clarity/reproducibility/polish
- 📋 Planned — identified, not yet specced

> The original public-promotion release gate (authoring scope, read-surface
> filtering, named-trigger authorization, Data Store access control,
> connector/provisioning secret redaction, system-log gating, broker-URL
> redaction, initial-MQTT retry, Node pinning, and the docs truthfulness pass) is
> complete. A follow-up deep audit (2 Aug 2026) then found and fixed two
> authoring-composition bugs (non-admin editing/deleting an unrestricted
> automation; scope-blind device-event triggering), the Hue contributed-action
> false-success bug, and admin-password-reset refresh-token revocation.
>
> A second fresh review (2 Aug 2026) then found a further set of pre-promotion
> gates — a mis-composed unified command path, a scope-bypassing bulk sandbox
> callback, pane-removal destroying authored automations, non-admin layout edits
> the backend refuses to persist, and partial updates that erase the chosen
> completion tier. These are tracked under **Critical / High — fresh review
> release gates** below and should be closed before promoting the interactive
> application or inviting early adopters to trust it with authored work.
> Completed work is recorded in git history (see `git log`); the items below are
> what remains open.

---

## Critical / High — fresh review release gates (2 Aug 2026)

Fix these before promoting the interactive application or inviting early
adopters to trust it with authored work. They are composition/UX bugs on the
ordinary control path, not future enhancements. Require green CI on the exact
public commit once they are closed.

### Repair the unified command-source / device-action composition 🔴
The REST/dashboard/custom-UI device-action path is currently mis-composed and
can fail on the first thing a reviewer clicks. Four related problems in the same
path (`device.routes.ts`, `command-service.ts`, `automation-scope-resolver.ts`,
`connector-manager.ts`, `action-router.ts`, `capability-action-map.ts`):

- **REST source tags are treated as automation IDs.** `CommandService` runs its
  single `AutomationScopeResolver` for *every* source, so `rest:<device-id>`
  resolves to an empty fail-closed scope and a normal `toggle` is rejected — for
  admins too, because route-level admin authorization does not carry through.
- **Native device actions do not map through the generic device handler.**
  Dashboard action types (`toggle`, `brightness`, `color`, `color-temp`, `on`,
  `off`, `rename`, `delete`) have no registered handler, so REST `brightness` /
  `color` return `unsupported` before `ActionRouter` sees the device's own
  action catalog.
- **MQTT device dispatch is never wired in production.** `ActionRouter` needs
  `setMqttService()`, `ConnectorManager` exposes it, but no production call to
  `connectorManager.setMqttService(mqttService)` exists outside tests — so
  generic MQTT control can report "broker not connected" while the app-level
  `MqttService` is connected.
- **Hue brightness fallback schema disagrees.** The generic descriptor declares
  `{ level: 0..100 }` while the connector/UI use `{ brightness: 0..254 }`;
  descriptor validation runs before the connector, so a valid dashboard
  brightness action can fail validation once the path is reconnected.

Fix by making the command source explicit rather than string-prefixing
(`{ kind: "automation"|"rest"|"system" }`) and applying the scope resolver only
for automation sources; normalize REST-native actions through the generic
`device_action` handler; call `connectorManager.setMqttService(mqttService)` at
composition time; pick one canonical brightness contract and align descriptor,
UI, connector and examples. Add a production-composition integration test (see
Testing below) — this is the test blind spot that let the bug reach CI green.

### Scope `devices.actionAll()` to the injected device set 🔴
`Sandbox.setDevicesRefs()` injects only the scoped `allDevices` list into
`list()`/`get()`/`filter()`, but the `devices.actionAll()` host callback calls
`deviceRegistry.getAll()` again, so a scoped rule's predicate is evaluated
against hidden device objects and the returned `BulkActionResult` can leak hidden
device IDs, counts and state-side-channel behaviour — even though the command
boundary still blocks the out-of-scope command. This contradicts
`docs/security/permissions.md`. Fix by using the already-computed scoped
`allDevices` (or an immutable scoped copy) in the callback; never call the full
registry inside `actionAll()`. Add tests: predicate never sees a hidden device,
hidden IDs never appear in the result, only in-scope targets reach
`CommandService`, and unrestricted/admin rules keep full-inventory behaviour.

### Decouple pane removal from automation deletion 🟠
Removing an automation pane currently hard-deletes the underlying automation:
`TabLayout.tsx` sends `DELETE /api/automations/:id` before `removePane()`, and
`dashboard-store.ts`'s `removePane()` sends a *second* delete — with no
confirmation — even though `automation_tab_assignments` is many-to-many and the
same automation can be exposed by multiple tabs/panes. Removing one view can
therefore destroy hand-written Logic/UI used elsewhere, and for non-admin `write`
users the delete can succeed while the layout PUT fails, orphaning the pane.
Fix: "Remove pane" removes only the pane; deleting an automation becomes an
explicit operation from the automation editor/management screen with a
confirmation; remove the duplicate DELETE call. (This is the urgent, concrete
face of the "Automation deletion is unrecoverable" Planned item below; full
soft-delete/archive can stay on the roadmap.)

### Make layout editing truthful for non-admin `write` users 🟠
`docs/security/permissions.md` grants `write` users pane editing, but
`PUT /api/layout` is `requireAdmin`, so every non-admin layout mutation fails
after the UI has already accepted it — the failure is only logged to the browser
console and local state stays changed until reload. Choose one:

- **Small early-alpha fix (preferred for now):** make dashboard/pane layout
  editing admin-only in the frontend and update the permission wording; keep
  non-admin `write` for scoped automation authoring/editing.
- **Complete fix:** add a tab-scoped layout endpoint guarded by
  `requireTabPermission("write")` that mutates only panes in that one tab, and
  stop non-admins submitting a full-layout replacement.

### Preserve completion tiers on partial automation updates 🟠
`updateAutomationBodySchema` distinguishes omitted (`undefined`) from explicit
clear (`null`), but the route does not: `normalizeTier(undefined)` returns `null`
and the UPDATE always writes it (and the form path initialises it to `null`), so
an unrelated edit (name, trigger, Logic, paired UI) silently erases a persisted
`dispatch` / `acknowledged` / `observed` choice. Both
`AutomationPane.handleUpdate()` and `AutomationsPage.saveScript()` send partial
PUTs without `completionTier`, so this is live, not theoretical. Because truthful
command completion is a headline Aeolus idea, fix with consistent PATCH
semantics (`undefined` → preserve, `null` → clear, valid tier → replace); the
same nullish pattern also blocks explicitly clearing
`conditionType`/`conditionValue`. Add regression tests (name-only preserves tier,
`uiSource`-only preserves tier, explicit `null` clears, explicit tier replaces).

---

## High — deployment & lifecycle correctness

### Ungate dashboard-managed MQTT provisioning 🟠
Broker-side verification is implemented: after writing credentials and
triggering a reload, the backend probes the broker to confirm the new policy is
actually enforced before reporting success (`BrokerVerifier`), and the Compose
reload sidecar now watches the config directory so atomic password-file
replacements are observed. Managed Shared Password / Per-Device security remain
gated behind `MQTT_MANAGED_PROVISIONING_ENABLED=true` by default.

Before flipping the default on: exercise the verified provisioning path against a
real broker deployment (mode switch / rotation / revocation / restart), then
enable managed provisioning by default (or document it as a supported opt-in).
This is mostly an operational sign-off, with one code correction first:

- **Per-device revocation verification is misleading.** `revokeDeviceCredential()`
  deletes the credential then probes the broker with `{ username, password:
  "revoked" }`. Rejecting a deliberately-wrong password does not prove the *old
  valid* password stopped working — if the password file failed to reload, the
  old credential could still be valid and verification would falsely pass. Since
  Aeolus intentionally does not retain device plaintext, real post-delete login
  verification needs a design change (rotate-with-known-old-secret, or verify a
  config/password-file generation marker + successful reload). Until then, remove
  or rename the misleading "revoked credential rejected" assertion. (Not a
  default-path blocker — provisioning stays opt-in.)

### Explicit trusted-proxy design for rate limiting 🟡
Rate limiting keys on `req.ip`, but Express does not configure a trusted reverse
proxy. Behind Caddy/nginx/Cloudflare, users can share the proxy address and one
login/API rate-limit bucket. Do not blindly set `trust proxy = true`; add a
configurable trusted-proxy topology for the supported deployment path and test
client-IP behaviour.

---

## Product truthfulness & connector capability

### Generic MQTT devices have no config path to declare acknowledgement 🟠
The ack parser works, but `CommandService` only attaches `correlationId` /
`responseTopic` when `ConnectorManager.getAcknowledgementCapability(deviceId)`
reports support — which comes from connector instances. A plain discovered MQTT
device has no connector owner and no persisted MQTT command profile, so it
cannot opt into the documented ack flow. Preferred fix (truthful command
evidence is a core differentiator): add a persisted per-device MQTT command
profile (ack supported, response topic, QoS, optional indicator/status values).
Fallback: clarify docs that correlated acknowledgement currently requires a
connector/configuration path not exposed for generic discovered devices.

### Hue `scene` / `color-loop` actions are not implemented in the connector 🟡
The contributed `hue_scene` / `hue_color_loop` action handlers now correctly
propagate the connector's `ActionResult` (so they can no longer report false
success), but `HueConnector.execute()` has no `scene` / `color_loop` cases, so
these actions currently resolve to a truthful `Unsupported action type` failure.
Either implement `scene` / `color_loop` against the Hue bridge API (scene
activation, native color-loop effect) so the actions become functional, or drop
the two contributed handlers until the connector supports them. They are not
surfaced in the dashboard UI today, so nothing depends on them yet.

---

## Planned — authoring safety & portability

### Per-automation MQTT publish namespace for scoped automations 📋
Scoped (non-admin) automations are currently denied raw MQTT publish by the
`AutomationScopeResolver` (a deliberate fail-closed default from the
`scoped-automation-authoring` work). Give them a safe, bounded per-automation
publish namespace (e.g. `aeolus/automations/{ruleId}/...`) so they can publish
within their own prefix instead of being denied outright. Companion to the
outbound-HTTP consolidation below, after which scoped form-rule webhooks can also
be allowed.

### Automation deletion is unrecoverable 📋
Deleting an automation is an immediate hard delete (`DELETE FROM automation_rules`)
that also wipes its stored state and unregisters it from the engine. There is no
confirmation, soft-delete, or undo, so a single misclick permanently destroys
hand-written script and paired UI. Add a safety margin: soft-delete or
archive-on-delete so a removed automation can be restored; a confirmation before
destroying authored logic/UI; and retention of the rule's state until deletion is
finalised. Important for user trust before encouraging people to build valuable
applications in Aeolus.

> Urgency raised by the 2 Aug 2026 fresh review: the most dangerous path today is
> not the explicit delete but the *implicit* one — removing a dashboard pane
> hard-deletes the underlying automation. The immediate decoupling +
> confirmation fix is tracked under **Critical / High — fresh review release
> gates** (Decouple pane removal from automation deletion) and should land before
> the broader soft-delete/archive work here.

### Custom UI capability manifest to close the confused-deputy boundary 📋
The custom-UI iframe isolation is strong in the browser sense (opaque origin,
MessageChannel RPC, no token, no generic network bridge), but the host broker's
device-control/MQTT operations execute under the *viewer's* authenticated
authority, and the immutable `FrameGrant` carries the automation/panel identity
rather than a manifest of allowed device/topic capabilities. If untrusted users
are ever allowed to author UI that a more privileged user opens, this is a
confused-deputy risk. `docs/WHY_AEOLUS.md` already documents custom UI as
administrator-authored / explicitly-trusted code and calls out future
manifest-level permissions, so this is an acceptable documented boundary today —
**provided the custom UI sandbox is not marketed as safe third-party plugin
isolation.** Track the manifest/capability work here so the boundary is visible
outside the architecture narrative: a `FrameGrant` should eventually declare an
explicit allow-list of device/topic capabilities enforced by the host broker.

### Export and import individual automations 📋
Allow a single automation — its logic, paired UI, trigger configuration and
metadata — to be exported to a portable file and imported into another
installation or kept as an off-system backup. This is the lightweight,
per-automation companion to the roadmap's "Reusable Aeolus applications" (which
packages a curated Logic/UI pair for distribution), and it gives authored work a
durable home outside the database, complementing the deletion-recoverability item
above. One of the highest-value adoption features after the safety fixes:
applications can move between systems, live in source control and become
shareable examples without a full marketplace.

---

## Medium — authoring & data guardrails

### Named-trigger pane is visible to non-admins but the endpoint is admin-only 🟡
`POST /api/automations/trigger/:name` is correctly admin-only, but a
trigger-button pane can still be visible/clickable to a non-admin with
`interact` — it simply returns 403 when pressed. Either hide/disable the pane for
non-admins, or migrate it toward resource-bound automation firing so the button
maps to something the user is actually allowed to do.

### Manual `/fire` accepts arbitrary full context from any interact user 🟡
`POST /api/automations/:id/fire` lets any user with `interact` supply a full
`{ context: { topic, state } }` override, so an operator can drive an
admin-authored automation's Logic with synthetic topics/states its UI designer
never intended. Restrict arbitrary `context` override to admins; give ordinary
UI clients bounded primitives instead (an `eventName` + bounded payload, and a
server-generated `state-set` event) so `interact` means "operate the exposed
interface", not "fabricate arbitrary event contexts". Note the frontend
`saveAndFire` currently depends on the full-context mode, so this needs a
coordinated frontend change.

### Data Store storage accounting is approximate 🟡
`DataStore.write()` estimates storage as `recordCount * 200 bytes` rather than
actual serialized size, and ignores shared-bucket size, so large JSON records
can overshoot `maxStorageMb`. Operational guardrail, not a security blocker under
the current threat model: track real serialized size and include buckets.
(The `maxCollections` auto-create bypass is fixed — the write auto-create path
now enforces the limit like explicit `createCollection()`.)

---

## Additional hardening observations

Not promotion blockers under the documented mostly-trusted single-site threat
model, but should remain visible:

- Sandbox HTTP SSRF checks block literal private/link-local addresses, but DNS
  rebinding / hostnames resolving to private ranges and redirects to private
  targets are not validated at the network layer; response bodies have no
  explicit size cap.
- Form-rule webhook actions use host `fetch()` without the sandbox's timeout or
  SSRF policy — consolidate outbound requests (script `http` + form-rule
  webhooks) behind one bounded, SSRF-checked host HTTP service, after which
  scoped webhooks can be allowed.
- Internal automation MQTT publish bypasses the REST raw-publish namespace
  policy — acceptable for admin-authored code; scoped (non-admin) automations are
  already denied raw publish by the `AutomationScopeResolver`. A per-automation
  publish namespace (see Planned above) would let them publish safely.
- `/metrics` is deliberately open when `METRICS_TOKEN` is unset — fine on
  LAN-only installs; remotely reachable deployments should set a token or fail
  closed in production.
- The Mosquitto reload sidecar installs `inotify-tools` via `apk add` at
  container startup — bake it into a tiny pinned sidecar image for a
  resilient/offline appliance instead of needing the Alpine repo at runtime.
- The Mosquitto healthcheck probes anonymously, so it reports the broker
  unhealthy once managed provisioning switches it to `allow_anonymous false`.
  It is observability-only (the backend does not gate startup on it), but the
  probe strategy should adapt (authenticated probe, or a config-marker check)
  when managed provisioning is enabled by default.
- Access-token role/group claims can remain stale for up to 15 minutes. Password
  resets revoke refresh tokens and WebSockets close when their access token
  expires, but existing JWT access tokens still carry the old `role`/`groupId`
  until the 15-minute expiry. Acceptable stateless-JWT tradeoff for the stated
  threat model; if immediate admin demotion/revocation ever matters, add a token
  version or a live-user lookup for privileged operations.
- Single-segment MQTT state topics derive an unexpected command topic: the
  fallback replaces the final segment with `set`, so a topic with no `/` (e.g.
  `pump`) yields `set` rather than `pump/set`. Deterministic and tested, but
  surprising — the future per-device MQTT command profile makes the fallback less
  important, or the convention should be documented explicitly.

---

## Testing

### Production-composition command-path integration suite 🟠
The 2 Aug 2026 fresh review showed the remaining test blind spot: individual
pieces are well covered (route mock asserts a `rest:<id>` source tag, the
"source-independent" `CommandService` property test omits the production scope
resolver, `ActionRouter` tests hand-call `setMqttService()`), yet the real
dependency graph is wrong. Add one integration suite that wires dependencies the
same way `src/index.ts` does and proves, through the production composition:

1. an authorized REST `toggle` reaches the connector (admin and permitted user);
2. Hue/native `brightness` reaches the connector with the correct params;
3. an explicit Kasa `off` reaches the connector;
4. an MQTT device publishes through the live/stub `MqttService` injected at
   composition;
5. an out-of-scope REST action is rejected before dispatch;
6. a scoped automation still cannot escape its device set (e.g. by fabricating
   another device id).

Also add the scoped `devices.actionAll()` tests and the completion-tier
partial-update regression tests described in the release-gate items above.

### Adversarial end-to-end tests with a real non-admin user 📋
Resource-level authorization, read-surface filtering, named-trigger
authorization, and Data Store access control are shipped with unit and
integration coverage (see the `__integration__` suites). A full Playwright
end-to-end pass with a real non-admin user is still worth adding: prove that a
non-admin attempting to act on or read a device/automation/collection outside
their tab scope is rejected (403) through the actual UI, while legitimate
in-scope actions succeed.

---

## Acceptable to leave as documented early-alpha limitations

These can ship as documented early-alpha limitations:

- State provenance and observation 📋 — generic DeviceStateObservation envelope
  across all connectors; origin = device | optimistic | synthetic; only
  device-origin satisfies physical confirmation. The connector path still emits
  optimistic/synthetic state after a successful execute.
- Pending commands lost on restart — in-memory tracker cannot reconcile commands
  interrupted by a process restart (documented limitation).
- Managed MQTT provisioning remaining opt-in.
- Limited connector catalogue (Hue, Kasa, MQTT); a Modbus TCP/RTU connector is
  the strategically useful next one for edge/industrial credibility.
- No HA/fleet/industrial-safety guarantees.

---

## Optional enhancements (not from review)

- Live lifecycle progress streaming: per-transition WebSocket events so the UI
  can animate REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED in real time
  (cosmetic, not blocking).

---

## Before an anonymous / shared public demo

Do not expose an ordinary Aeolus account to strangers. Use a dedicated demo mode
/ fail-closed allowlist, simulated devices, an isolated database and broker, no
real credentials, bounded state/fire operations and periodic reset.

---

_Completed work is recorded in git history (see `git log`)._
