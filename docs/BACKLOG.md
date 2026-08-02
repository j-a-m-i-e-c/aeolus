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

> The public-promotion release gate (authoring scope, read-surface filtering,
> named-trigger authorization, Data Store access control, connector/provisioning
> secret redaction, system-log gating, broker-URL redaction, initial-MQTT retry,
> Node pinning, and the docs truthfulness pass) is complete. Completed work is
> recorded in git history (see `git log`).

---

## High — deployment & lifecycle correctness

### Ungate dashboard-managed MQTT provisioning 🟠
Broker-side verification is implemented: after writing credentials and
triggering a reload, the backend probes the broker to confirm the new policy is
actually enforced before reporting success (`BrokerVerifier`), and the Compose
reload sidecar now watches the config directory so atomic password-file
replacements are observed. Managed Shared Password / Per-Device security remain
gated behind `MQTT_MANAGED_PROVISIONING_ENABLED=true` by default.

The only remaining work is the deployment decision to flip the default on:
exercise the verified provisioning path against a real broker deployment, then
enable managed provisioning by default (or document it as a supported opt-in).
This is an operational sign-off, not a code gap.

### Default Compose should use `NODE_ENV=production` 🟡
The production guide tells operators to set `NODE_ENV=production`, but the
default Compose stack uses `${NODE_ENV:-development}`. Since Compose is also the
main evaluation/installation path, production should be the safe default (avoids
accidental stack-trace/error-detail exposure); local source development uses the
dev scripts explicitly.

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
- `GET /api/system/version` performs an outbound GitHub update check per request
  — cache the result to reduce external dependency/abuse potential.
- The Mosquitto reload sidecar installs `inotify-tools` via `apk add` at
  container startup — bake it into a tiny pinned sidecar image for a
  resilient/offline appliance instead of needing the Alpine repo at runtime.

---

## Testing

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
