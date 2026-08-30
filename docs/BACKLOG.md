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
> completion tier. **Those gates are now closed** (see "Closed — second fresh
> review release gates" below and `git log`).
>
> A third fresh review (2 Aug 2026, `docs/history/audits/aeolus-v11-fresh-review-2026-08-02.md`)
> confirmed no new core security/sandbox/MQTT flaw and verified the release-gate
> work is present in production. It found the remaining public risk had moved
> outward into the **bundled Hue and Kasa connectors**: controls advertised by
> capabilities or the UI but rejected/executed incorrectly, a Kasa discovery
> listener leak, and device IDs that did not satisfy the documented multi-instance
> guarantee. **That connector release gate has since been completed** (see the
> **`connector-correctness-release-gates`** spec in `.kiro/specs/` and `git log`);
> a follow-up also closed the interact-level device rename/delete gap. The linked
> audit is retained as historical context only.

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

### General trusted-proxy configuration beyond the public demo 🟡
The public-demo deployment deliberately configures Express to trust exactly one
proxy hop, matching its Cloudflare Tunnel topology; normal/local installs keep
Express' default `trust proxy` behaviour. If Aeolus later advertises additional
reverse-proxy topologies (Caddy/nginx/multiple hops), make that trust model an
explicit deployment setting and test client-IP/rate-limit behaviour for each
supported topology rather than enabling `trust proxy = true` globally.

---

## Product truthfulness & connector capability

### Hue `scene` / `color-loop` actions are not implemented in the connector 🟡
The contributed `hue_scene` / `hue_color_loop` action handlers now correctly
propagate the connector's `ActionResult` (so they can no longer report false
success), but `HueConnector.execute()` has no `scene` / `color_loop` cases, so
these actions currently resolve to a truthful `Unsupported action type` failure.
Either implement `scene` / `color_loop` against the Hue bridge API (scene
activation, native color-loop effect) so the actions become functional, or drop
the two contributed handlers until the connector supports them. They are not
surfaced in the dashboard UI today, so nothing depends on them yet.

### Parse Hue application-level action errors 🟡
The Hue state/rename/delete action paths check `response.ok` but do not inspect
the returned Hue API body for application-level errors, even though Hue responses
carry explicit `success`/`error` objects (the pairing flow already demonstrates
this). For command truthfulness, parse the action response and turn a Hue error
object into an execution failure rather than reporting a dispatch merely because
HTTP returned 2xx. (Review M1, 2 Aug 2026 — strongly recommended, not a launch
blocker. Companion to the `connector-correctness-release-gates` spec's Hue
catalog work.)

### Reconcile devices that disappear from connector discovery 🟡
`ConnectorManager.startPolling()` replaces the per-instance `devices` set after a
successful non-empty discovery but never removes registry devices that were in
the previous set and are absent from the new result, so a device removed outside
Aeolus can remain stale indefinitely. Not catastrophic for early alpha, but it
matters for long-running sites. Use a grace period / consecutive-miss threshold
before removing a device so one UDP miss does not turn into data loss. (Review
M2, 2 Aug 2026.)

---

## Planned — authoring safety & portability

### Per-automation MQTT publish namespace for scoped automations 📋
Scoped (non-admin) automations are currently denied raw MQTT publish by the
`AutomationScopeResolver` (a deliberate fail-closed default from the
`scoped-automation-authoring` work). Give them a safe, bounded per-automation
publish namespace (e.g. `aeolus/automations/{ruleId}/...`) so they can publish
within their own prefix instead of being denied outright. Authored HTTP/webhook
egress now has a shared public-destination policy; any future scoped-webhook
permission should build on that boundary rather than reintroducing ad-hoc egress.

### Automation deletion is unrecoverable 📋
Deleting an automation is an immediate hard delete (`DELETE FROM automation_rules`)
that also wipes its stored state and unregisters it from the engine. The UI now requires explicit confirmation before the DELETE request, and pane
removal no longer deletes the underlying automation. The remaining gap is
recoverability: the backend DELETE is still a hard delete with no archive/undo.
Add soft-delete or archive-on-delete plus retention of the rule's state until
deletion is finalised. Important for user trust before encouraging people to
build valuable applications in Aeolus.

> The most dangerous path — the *implicit* delete where removing a dashboard pane
> hard-deleted the underlying automation — has been decoupled and now removes
> only the pane (see "Closed — second fresh review release gates" above). The
> broader soft-delete/archive work below remains open so an explicit deletion is
> also recoverable.

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

- Authored `http.*` and form-rule webhooks now share one bounded public-HTTP(S)
  policy: literal/private/link-local destinations are rejected, DNS answers are
  preflighted, redirects are disabled, and request/response sizes and execution
  time are bounded. A DNS preflight -> connection TOCTOU window remains because
  Node's `fetch` may resolve the host again when connecting; close that only if a
  pinned-address transport becomes necessary for the threat model.
- Dependency posture is deliberate rather than "green at any cost": `ws` is on
  the safe 8.21.3 line, while `isolated-vm` remains on the 5.x line that the
  pinned Node 22 runtime supports. Treat an `isolated-vm` major as a runtime
  migration, not a Dependabot merge — the 6.x line (6.0.1+) supports both Node 22
  and newer, so it is the bridge to take first, while 7.x requires Node 24.
  Rationale and the migration order are recorded in
  [ADR-0009](adr/0009-pinned-node-22-runtime.md).
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
  surprising — the current per-device MQTT command profile can avoid relying on
  this fallback when an explicit command topic is configured, or the fallback
  convention should be documented more prominently.
- Optimistic `on`/`off` state is not updated immediately: `ActionRouter`
  special-cases `toggle` but `on`/`off` normally carry empty params, so local
  state is unchanged until the next real device event/poll. Mostly UX (Aeolus
  correctly does not treat optimistic state as physical observation). Consider
  setting `updatedState.on` explicitly for `on`/`off`, marked with provenance
  once provenance lands. (Review M3, 2 Aug 2026.)

---

## Testing

### Production-composition command-path integration suite 🟠
The remaining test blind spot: individual pieces are well covered, yet nothing
exercised the real `src/index.ts` dependency graph, which is why the connector
mismatches reached CI green. A production-composition integration suite that
wires dependencies the same way `src/index.ts` does — proving authorized REST
`toggle`/`brightness`/`off` reach the connector, MQTT publishes through the
injected `MqttService`, out-of-scope actions are rejected before dispatch, and a
scoped automation cannot fabricate a device id — is now owned by the
**`connector-correctness-release-gates`** spec (Requirement 7), because the
connector fixes there are the concrete example of why it is needed.

The scoped `devices.actionAll()` tests and the completion-tier partial-update
regression tests called for by the earlier release gates landed with those
now-closed gates (see `git log`).

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
