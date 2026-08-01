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

## Sources
- Deep reassessment, 1 August 2026: `docs/aeolus-deep-reassessment-2026-08-01.md`
  (numbers below such as "R1", "R8" map to that document's numbered items).

---

## Release gate — fix before public repository / portfolio promotion

The reassessment identifies a concentrated set of fixes that are either easy or
directly contradict Aeolus's public multi-user/permission claims. These are the
items most likely to create an embarrassing demo or security-review moment.
Work them roughly in this order.

### 1. Non-admin authored Logic executes with system-wide authority ✅ (R1) — DONE
**Resolved by the `scoped-automation-authoring` spec** (see
`.kiro/specs/scoped-automation-authoring/`). Every automation now carries a
persisted authorization scope (`automation_rules.authored_unrestricted` +
`owner_tab_id`, migration 011). Admin-authored automations stay unrestricted;
non-admin-authored automations are bound at creation to a single owning tab the
author holds `write` on and run confined to that tab's exposed devices and
surfaced Data Store collections — no raw MQTT publish, no shared buckets,
form-rule webhooks refused, HTTP limited to the SSRF policy.

Enforcement is defense in depth via a new `AutomationScopeResolver` injected
into both the sandbox (injects only in-scope devices; gates `db.*`) and the
`CommandService` (re-checks every dispatch; out-of-scope device actions and all
scoped publishes/webhooks return a terminal `unauthorized` failure). The owning
tab also exposes its automations, so a scoped author can view/fire/edit their
own work without admin layout edits. Scope is bound from the server-side role
(never the body) and is immutable across non-admin updates; a deleted owning tab
fails closed to an empty scope. `docs/security/permissions.md` documents the
model. The companion `admin-user-management` spec adds create/promote/demote of
admin users with last-admin protection.

The old UI inconsistency is resolved too: the authoring UI now sends the owning
`tabId` for non-admins (and hides authoring when the user has no writable tab).

Deferred follow-ups (own backlog entries below):
- per-automation MQTT publish namespaces (e.g. `aeolus/automations/{ruleId}/...`)
  so scoped automations can publish safely instead of being denied;
- consolidating outbound HTTP (script `http` + form-rule webhooks) behind one
  bounded, SSRF-checked host service, after which scoped webhooks can be allowed.

### 2. Read surfaces bypass the resource permission model 🟠 (R2)
Core `/api/devices` and `/api/automations` lists are filtered, but adjacent
routes still disclose out-of-scope resources:
- `GET /api/state` returns `registry.getAll()` to every authenticated user;
- the initial WebSocket `snapshot` sends every registered device to every
  client (live updates are scoped — a snapshot/live inconsistency);
- `GET /api/devices/:id/actions` — no device read permission check;
- `GET /api/devices/:id/completion-tiers` — no device read permission check;
- `GET /api/devices/:id/history` — checks existence but not read permission;
- `GET /api/automations/history` — global execution log / arbitrary `ruleId`
  history without resource filtering;
- `GET /api/layout` — returns all tabs and pane config to every user.

Fix: reuse `PermissionResolver` for `/api/state` and WebSocket snapshot
generation; apply `requireDevice("read")` / automation read checks to auxiliary
routes; filter layout to accessible tabs (or split admin vs user-view layout
endpoints). Mostly mechanical now the resolver exists.

### 3. Named triggers use the old caller-supplied tab pattern 🟠 (R3)
`POST /api/automations/trigger/:name` uses `requireTabPermission("interact")`
then emits a global `service/trigger/{name}` event not tied to the automations
that subscribe to it, so any interact-permitted tab can fire a globally named
trigger used by an automation elsewhere. Short-term: make generic named
triggers admin-only, or replace with resource-bound automation firing. Later:
persist trigger→automation/tab ownership and authorize server-side.

### 4. Data Store REST access is global for every authenticated user 🟠 (R4)
`createDataStoreRoutes()` has no admin/collection guards — any authenticated
user can create/delete collections, write/export records, modify buckets,
change quotas and enable/disable the Data Store. `collection_tab_assignments`
already exists for WebSocket visibility but is not applied to REST. Short-term:
admin-gate Data Store management and mutations; filter reads by collection→tab
assignment if non-admin viewing is needed; treat shared buckets as admin/trusted.
Alternatively document the Data Store as installation-global and ensure the UI
does not imply otherwise.

### 5. Connector status can leak raw connector secrets 🟠 (R5)
`GET /api/connectors` redacts `password`-typed config, but
`GET /api/connectors/:id/status` returns `ConnectorManager.getStatus(id)`
directly, including the instance's raw config (e.g. a Hue bridge API key).
`search-lights` start/status endpoints are also not admin-gated. Fix: admin-gate
connector status/setup/discovery, or apply the same schema redaction to status
output; make `search-lights` admin-only.

### 6. MQTT provisioning status exposes the shared broker password 🟠 (R6)
`GET /api/mqtt/provisioning/status` is available to any authenticated user and
`getStatus()` includes `sharedCredential: { username, password }` at security
level `shared_password`. Fix: return a redacted status to non-admins (level,
connected, provisioning-enabled); expose the credential only via an admin-only
endpoint if it must be retrievable at all — prefer one-time display on
create/regenerate. (Relevant once managed provisioning is enabled.)

### 7. System diagnostics and logs available to every authenticated user 🟠 (R7)
`GET /api/system` (hostname, network addresses, CPU/memory/disk, runtime) and
`GET /api/system/logs` (recent app logs) require no admin. Compounds other leaks
because logs may contain connector/API URLs and the MQTT broker URL. Fix:
admin-gate both; leave a minimal version/health endpoint open as needed.

### 8. MQTT broker credentials can be logged in plaintext 🟠 (R8)
`MqttService` logs `this.config.brokerUrl` on connect/reconnect; with
`mqtt://user:password@host:1883` URLs the password is written to logs. Combined
with non-admin log access this is a concrete disclosure path. Fix: add a
URL-redaction helper that strips userinfo before every log call; prefer separate
`MQTT_USERNAME`/`MQTT_PASSWORD` config so the URL never carries credentials.

### 9. Initial MQTT connection failure does not start the retry loop 🟠 (R9)
`connect()` calls `attemptConnection()` once; the indefinite reconnection loop
only starts from an established client's `close` handler. If the first attempt
fails, `src/index.ts` logs "running without MQTT" and no retry is scheduled — a
healthy-looking backend can stay MQTT-disconnected until restarted (common in a
boot race where the backend starts before Mosquitto). Fix: enter the same
backoff loop on initial failure without blocking startup; add a Mosquitto
healthcheck and, where useful, a broker-health startup dependency. Keep
reconnect resilient for external brokers too.

### 10. Pin Node ≥ 22.22.1 consistently 🟡 (R12)
`.nvmrc`, package engines and the backend Dockerfile pin 22.20.0 / `>=22.20.0`,
but locked `lint-staged@17.0.7` requires Node `>=22.22.1`. Frontend Dockerfile
and seed service use floating `node:22`. Fix: pin one tested patch release
(≥ 22.22.1) everywhere — `.nvmrc`, engines, backend/frontend Dockerfiles, seed
image and CI — so the CI environment matches the lockfile.

### 11. Documentation truthfulness pass 🟡 (R11)
`docker-compose.yml` now mounts `./mosquitto` into the backend and includes a
`mosquitto-reloader` sidecar (a fourth long-running service). `README.md`,
`docs/production-deployment.md` and `docs/reference/operations.md` still say the
default Compose deliberately does not mount Mosquitto config, that dashboard
broker reconfiguration is not wired, and that Aeolus runs as three containers.
Fix these before a marketing push (see documentation-update rules for which file
owns each claim).

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

### Default Compose should use `NODE_ENV=production` 🟡 (R13)
The production guide tells operators to set `NODE_ENV=production`, but the
default Compose stack uses `${NODE_ENV:-development}`. Since Compose is also the
main evaluation/installation path, production should be the safe default (avoids
accidental stack-trace/error-detail exposure); local source development uses the
dev scripts explicitly.

### Explicit trusted-proxy design for rate limiting 🟡 (R14)
Rate limiting keys on `req.ip`, but Express does not configure a trusted reverse
proxy. Behind Caddy/nginx/Cloudflare, users can share the proxy address and one
login/API rate-limit bucket. Do not blindly set `trust proxy = true`; add a
configurable trusted-proxy topology for the supported deployment path and test
client-IP behaviour.

---

## Product truthfulness & connector capability

### Generic MQTT devices have no config path to declare acknowledgement 🟠 (R10)
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

### Automation deletion is unrecoverable 📋
Deleting an automation is an immediate hard delete (`DELETE FROM automation_rules`)
that also wipes its stored state and unregisters it from the engine. There is no
confirmation, soft-delete, or undo, so a single misclick permanently destroys
hand-written script and paired UI. Add a safety margin: soft-delete or
archive-on-delete so a removed automation can be restored; a confirmation before
destroying authored logic/UI; and retention of the rule's state until deletion is
finalised. (Reassessment flags this as important for user trust before
encouraging people to build valuable applications in Aeolus.)

### Export and import individual automations 📋
Allow a single automation — its logic, paired UI, trigger configuration and
metadata — to be exported to a portable file and imported into another
installation or kept as an off-system backup. This is the lightweight,
per-automation companion to the roadmap's "Reusable Aeolus applications" (which
packages a curated Logic/UI pair for distribution), and it gives authored work a
durable home outside the database, complementing the deletion-recoverability item
above. The reassessment rates this one of the highest-value adoption features
after the safety fixes: applications can move between systems, live in source
control and become shareable examples without a full marketplace.

---

## Additional hardening observations

Not promotion blockers under the documented mostly-trusted single-site threat
model, but should remain visible:

- Sandbox HTTP SSRF checks block literal private/link-local addresses, but DNS
  rebinding / hostnames resolving to private ranges and redirects to private
  targets are not validated at the network layer; response bodies have no
  explicit size cap.
- Form-rule webhook actions use host `fetch()` without the sandbox's timeout or
  SSRF policy — consolidate outbound requests behind one bounded host HTTP
  service.
- Internal automation MQTT publish bypasses the REST raw-publish namespace
  policy — acceptable for admin-authored code, not if non-admin script authoring
  remains enabled (ties to release-gate item 1).
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
Prove the resource-authorization model holds: a non-admin attempts to act on a
device/automation outside their tab scope and is rejected (403); legitimate
in-scope actions succeed. Resource-level authorization is shipped; these tests
can now be written. Extend coverage to the release-gate items above once fixed —
authored-Logic scope enforcement (item 1), auxiliary read filtering (item 2),
named-trigger authorization (item 3) and Data Store access (item 4).

---

## Acceptable to leave as documented early-alpha limitations

The reassessment agrees these can ship as documented limitations:

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
