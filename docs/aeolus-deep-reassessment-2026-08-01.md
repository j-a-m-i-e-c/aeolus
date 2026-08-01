# Aeolus Deep Reassessment — 1 August 2026

## Executive verdict

Aeolus is now a very strong early-alpha edge automation platform and an exceptional portfolio project. The latest archive shows that most of the earlier architectural backlog was not merely documented away: MQTT source routing is persisted, acknowledgement parsing is fixed, connector instance ownership is enforced, broker provisioning has real verification logic, database migrations are mature, and resource-level authorization exists on the main device and automation mutation paths.

I would promote the repository publicly now as **early alpha / under active development**. For an employer-facing portfolio, the project is already more valuable than another round of feature work.

Before describing the current group/tab permission system as fully enforced for ordinary non-admin authors, however, I would fix one critical boundary issue and several high-value consistency/security issues below. These are concentrated fixes, not a platform rewrite.

### Current assessment

| Area | Score | Notes |
|---|---:|---|
| Portfolio value | **9.3 / 10** | Unusually deep individual project for a 5+ year full-stack engineer |
| Architecture | **8.8 / 10** | Coherent event, command, connector, sandbox, persistence and deployment model |
| Testing posture | **9.0 / 10** | 126 backend tests, 98 frontend tests, integration/property tests and Playwright E2E |
| Documentation | **9.0 / 10** | Excellent design rationale, security docs and honest non-goals; some drift remains |
| Product differentiation | **8.8 / 10** | Logic + UI + local state as an edge application unit is genuinely distinctive |
| Security / multi-user consistency | **6.5 / 10** | Main resource guards are good; authoring and adjacent read surfaces still escape them |
| Useful to technical early adopters today | **7.5 / 10** | Strong for custom MQTT / small-site developer use; ecosystem still small |
| Broad industry readiness today | **6.0 / 10** | Early alpha, not fleet/HA/industrial-safety software |
| Long-term industry potential | **8.5 / 10** | Credible niche if external deployments validate the model |

---

# What is clearly better in this version

## MQTT identity and routing are now substantially more correct

The device registry preserves exact MQTT state and command topics and uses a deterministic collision-safe identity when two source topics would otherwise collapse into the same slug. Migration `008-mqtt-device-source-topics.ts` persists this source metadata, and command/heartbeat/availability leaves are excluded from discovery by default.

This closes one of the most serious earlier correctness problems: a command no longer has to reconstruct a lossy MQTT topic from a display/device identifier.

## The documented acknowledgement payload is accepted

`MqttService.handleAckMessage()` and `PendingCommandTracker` now support the documented `{ correlationId, success }` shape. `success: false` is represented as a terminal failure rather than a successful acknowledgement. Integration coverage exists for the documented success and failure paths.

## Connector multi-instance ownership is real

Devices now record `connectorInstanceId`; `ActionRouter` resolves the exact owning instance and fails instead of falling through to a same-type sibling when that owner is disabled. Connector contribution registration is reference-counted and there is multi-instance integration coverage.

This is a meaningful platform maturity improvement for installations with multiple bridges/sites/controllers.

## MQTT managed provisioning is much more credible

The provisioning subsystem now has a `BrokerVerifier`, a real Mosquitto integration test, native Mosquitto password hashes, reconstruction of device credentials across restart, and directory-level sidecar watching so atomic password-file replacement is noticed.

Keeping it behind `MQTT_MANAGED_PROVISIONING_ENABLED=false` by default is a sensible early-alpha decision until deployment sign-off is complete.

## Resource authorization has improved materially

Device actions and automation fire/toggle/update/delete routes use server-derived resource ownership rather than trusting a caller-supplied tab ID. Lists/details are filtered on the main routes and unexposed resources fail closed for non-admin users. Live WebSocket events also use server-derived visibility rather than producer-supplied scope metadata.

The old “pick any permitted tabId and operate an unrelated device” vulnerability on these core routes is no longer the central problem.

## Persistence and upgrades are unusually mature for a portfolio project

The repository now has 11 versioned migrations, rollback-aware migration execution, foreign-key checks, newer-than-binary rejection, WAL-consistent pre-migration backups and extensive property tests around migration invariants.

That is the kind of detail experienced platform/edge engineers notice.

---

# Critical before claiming the non-admin authoring permission model is secure

## 1. A write user can create an automation that executes with system-wide capabilities

**Severity: Critical for advertised multi-user permissions**  
**Portfolio/public-source blocker: No, if clearly documented as trusted/admin authoring**  
**Public shared-user blocker: Yes**

The main REST resource guards do not carry an authoring user's principal/capabilities into the automation runtime.

### Evidence

`POST /api/automations` is protected by `requireTabPermission("write")` (`src/api/routes/automation.routes.ts`, around lines 237–239). For a non-admin, the middleware trusts a `tabId` in request params/body/query (`src/auth/auth-middleware.ts`, around lines 125–164).

Once the rule is created it is immediately registered and active. There is no corresponding automation→tab assignment written during creation; ownership is rebuilt from layout panes only when an admin saves the layout.

The sandbox then injects **all devices** (`deviceRegistry.getAll()`) and exposes host callbacks that execute through the system-wide `CommandService` (`src/automations/sandbox.ts`, around lines 769–899). Script logic can also publish MQTT through the command service and access the shared Data Store. Form rules can target arbitrary action targets, including webhooks.

Therefore a user who merely has `write` permission on one tab can craft a request containing that legitimate `tabId`, create a script/form automation, and cause it to act on devices/data/topics outside that tab.

This is more important than the earlier forged-tab resource-action bug because it bypasses the boundary indirectly through authored Logic.

### The UI is inconsistent in the opposite direction

The frontend does **not** include `tabId` in its create-automation requests (`frontend/src/components/panes/AutomationPane.tsx` around lines 281–316 and `AutomationsPage.tsx` around lines 173–217). So ordinary non-admin creation from the normal UI receives 403, even though the UI displays authoring controls for `write` users.

Likewise the frontend lets `write` users add/remove/drag/resize panes (`TabLayout.tsx`), but `PUT /api/layout` is admin-only. The store catches persistence failure and logs a warning, so the UI can appear to accept a layout change that will not survive reload.

This creates a confusing state where `write` is **too weak in the intended UI** but **too powerful when used directly against the API**.

### Recommended short-term fix

For the current early-alpha threat model, the safest and simplest policy is:

- admin-only: create automation, edit Logic/source/action targets, delete automation, layout/pane editing;
- non-admin `write` can be temporarily redefined/hidden until there is a capability-scoped authoring design;
- non-admin `interact` can still fire/toggle/use exposed custom UIs and device controls as appropriate.

Then update `docs/security/permissions.md` so the levels match actual behaviour.

Longer term, carry an explicit automation capability manifest / owner scope into runtime: allowed device IDs/selectors, MQTT topic prefixes, Data Store collections and HTTP origins. The sandbox should receive only scoped device data and the host callbacks should enforce the same scope at dispatch time.

---

# High-priority fixes before a polished public promotion

## 2. Several read surfaces bypass the resource permission model

**Severity: High consistency/privacy issue**

The core `/api/devices` and `/api/automations` lists are filtered, but adjacent routes still disclose out-of-scope resources:

- `GET /api/state` returns `registry.getAll()` to every authenticated user (`src/api/routes/state.routes.ts`).
- the initial WebSocket `snapshot` sends every registered device to every authenticated client (`src/websocket/ws-server.ts`, around lines 185–191). Live updates are scoped, so this is a snapshot/live inconsistency.
- `GET /api/devices/:id/actions` does not require device read permission.
- `GET /api/devices/:id/completion-tiers` does not require device read permission.
- `GET /api/devices/:id/history` checks existence but not device read permission.
- `GET /api/automations/history` returns the global execution log or arbitrary `ruleId` history without resource filtering.
- `GET /api/layout` returns all tabs and pane configuration to every authenticated user.

This conflicts with `docs/security/permissions.md`, which says device and automation detail reads are filtered to resources reachable at `read`.

### Recommended fix

Use the same `PermissionResolver` for `/api/state` and WebSocket snapshot generation. Apply `requireDevice("read")` / automation read checks to auxiliary routes. Filter the layout to accessible tabs for non-admins or explicitly split an admin layout endpoint from a user-view endpoint.

These are mostly mechanical fixes now that the resolver exists.

---

## 3. Named triggers still use the old caller-supplied tab pattern

**Severity: High authorization inconsistency**

`POST /api/automations/trigger/:name` uses `requireTabPermission("interact")`, then emits a global `service/trigger/{name}` event. The supplied tab ID is not tied to the automations that subscribe to that trigger.

A user can therefore present any tab on which they have interact permission and fire a globally named trigger used by an automation outside that tab.

### Recommended fix

For now, make generic named triggers admin-only, or replace the endpoint with resource-bound automation firing. A later version can persist trigger→automation/tab ownership and authorize server-side.

---

## 4. Data Store REST access is global for every authenticated user

**Severity: High if tab permissions are expected to partition data**

`createDataStoreRoutes()` has no admin or collection permission guards. Any authenticated user can currently create/delete collections, write/export records, modify buckets, change quotas and enable/disable the Data Store.

You already have `collection_tab_assignments` for WebSocket event visibility, so the conceptual resource mapping exists, but it is not applied to REST access.

### Recommended short-term fix

Admin-gate Data Store management and mutations. If non-admin Data Store viewing is required, filter read routes by collection→tab assignment. Treat shared key/value buckets as admin/trusted until a clearer ownership model exists.

Alternatively, explicitly document that the Data Store is installation-global and only trusted operator accounts should receive ordinary login access. Do not let the UI imply otherwise.

---

## 5. Connector status can leak raw connector secrets

**Severity: High, easy fix**

`GET /api/connectors` correctly redacts fields whose config schema type is `password`. However `GET /api/connectors/:id/status` returns `ConnectorManager.getStatus(id)` directly to any authenticated user.

`getStatus()` includes the instance's raw config. For a Hue connector that can include the bridge API key. The search-lights start/status endpoints are also not admin-gated even though connector setup/management otherwise is.

### Recommended fix

Either make connector status/setup/discovery endpoints admin-only or apply the same config-schema redaction to status output. `search-lights` should be admin-only.

---

## 6. MQTT provisioning status can expose the shared broker password to any authenticated user

**Severity: High when managed provisioning is enabled, easy fix**

`GET /api/mqtt/provisioning/status` is intentionally available to any authenticated user. `MqttProvisioningService.getStatus()` includes `sharedCredential: { username, password }` whenever the security level is `shared_password`.

That means a normal user can retrieve the broker-wide shared password once this feature is enabled.

### Recommended fix

Return a redacted status to non-admins (level, connected, provisioning-enabled), and expose the credential only through an admin-only endpoint if it truly must be retrievable. Prefer one-time display on creation/regeneration rather than persistent plaintext display.

---

## 7. System diagnostics and application logs are available to every authenticated user

**Severity: Medium-high; compounds other leaks**

`GET /api/system` exposes hostname, network addresses, CPU/memory/disk information and runtime details. `GET /api/system/logs` exposes the application's recent logs. Neither route requires admin.

This becomes more significant because operational logs may contain connector/API URLs and, currently, the MQTT broker URL.

### Recommended fix

Admin-gate `/api/system` and `/api/system/logs`; leave a minimal version/health endpoint available as needed.

---

## 8. MQTT broker credentials can be logged in plaintext

**Severity: High, easy fix**

Production documentation supports URLs such as `mqtt://user:password@host:1883`. `MqttService` logs `this.config.brokerUrl` on connection and reconnection (`src/mqtt/mqtt-service.ts`, around lines 154–156 and 200–204).

If credentials are embedded in the URL, the password is written to logs. Combined with non-admin log access, this is a concrete credential disclosure path.

### Recommended fix

Create a URL-redaction helper that strips userinfo before every log call. Prefer separate `MQTT_USERNAME` / `MQTT_PASSWORD` configuration fields so the URL never contains credentials in the first place.

---

## 9. An initial MQTT connection failure does not start the retry loop

**Severity: High reliability issue for an IoT platform**

`MqttService.connect()` calls `attemptConnection()` once. The indefinite reconnection loop starts only from the established client's `close` handler. If the first connection attempt fails, `src/index.ts` catches the error and logs “running without MQTT”, but no retry is scheduled.

This can happen in a normal boot race where the backend starts before Mosquitto is ready. Compose only waits for `service_started`, and the broker has no healthcheck dependency.

The result can be a healthy-looking Aeolus backend that remains MQTT-disconnected until someone restarts it.

### Recommended fix

On initial failure, enter the same backoff loop without blocking application startup. Add a Mosquitto healthcheck and, where useful, have backend startup depend on broker health. Keep reconnect logic resilient even without Compose because external brokers can be temporarily unavailable too.

---

# Important product-truthfulness / polish items

## 10. Generic MQTT devices still have no configuration path to declare acknowledgement capability

**Severity: Medium-high product truthfulness issue**

The acknowledgement parser now works, but `CommandService` only attaches `correlationId` and `responseTopic` when `ConnectorManager.getAcknowledgementCapability(deviceId)` reports support. That capability comes from connector instances. A plain discovered MQTT device has no connector owner and no persisted MQTT command profile declaring acknowledgement support.

So the firmware guide's acknowledgement flow exists in the protocol, but a generic MQTT device does not currently have a normal configuration path to opt into it.

### Recommended fix

Either:

1. add a persisted MQTT command profile per device (ack supported, response topic, QoS, optional indicator/status values); or
2. clarify the docs that correlated acknowledgement currently requires a connector/configuration path not yet exposed for generic discovered MQTT devices.

Because truthful command evidence is one of Aeolus's strongest differentiators, I would prefer implementation rather than merely documentation.

---

## 11. Documentation is behind the Compose implementation

**Severity: Medium; highly visible to reviewers**

The current `docker-compose.yml` mounts `./mosquitto` into the backend and includes a `mosquitto-reloader` sidecar. Yet `README.md`, `docs/production-deployment.md` and `docs/reference/operations.md` still contain text saying the default Compose deployment deliberately does not mount Mosquitto configuration into the backend and that dashboard broker reconfiguration is not wired there.

`production-deployment.md` also says Aeolus runs as three containers, while the standard stack now includes the Mosquitto reload sidecar as a fourth long-running service.

This is not a runtime flaw; it is exactly the backlog's “documentation truthfulness pass”. A senior reviewer can spot it quickly, so fix it before a marketing push.

---

## 12. The pinned Node version is inconsistent with the lockfile

**Severity: Medium/easy**

`.nvmrc`, package engines and the backend Dockerfile pin Node 22.20.0 / `>=22.20.0`, while locked `lint-staged@17.0.7` requires Node `>=22.22.1`.

The frontend Dockerfile and seed service also use floating `node:22` tags.

### Recommended fix

Pin one tested Node 22 patch release (at least 22.22.1) everywhere: `.nvmrc`, package engines, backend/frontend Dockerfiles, seed image and CI.

---

## 13. Default Compose uses `NODE_ENV=development`

**Severity: Medium/easy**

The production guide correctly tells operators to set `NODE_ENV=production`, but the default Compose stack uses `${NODE_ENV:-development}`. Since the Docker Compose path is also the main evaluation/installation path, production should probably be the safe default; local source development can use the development scripts explicitly.

This avoids accidental stack-trace/error-detail exposure and makes the default container behaviour match what a reviewer expects.

---

## 14. Reverse-proxy rate limiting needs an explicit trust-proxy design

**Severity: Medium for remote/public use**

Aeolus rate-limits by `req.ip`, but Express does not appear to configure a trusted reverse proxy. Behind Caddy/nginx/Cloudflare, users may share the proxy's address and therefore one login/API rate-limit bucket.

Do not blindly set `trust proxy = true`. Add an explicit configurable trusted-proxy topology appropriate to the supported deployment path and test the client-IP behaviour.

---

# Known backlog items that are reasonable to leave for early alpha

## State provenance / physical observation

The connector path still emits immediate synthetic/optimistic state after successful execute (`src/connectors/action-router.ts`). The backlog correctly calls for a first-class observation envelope such as `device | optimistic | synthetic`, with only genuine device-origin observations satisfying physical confirmation.

This is worth doing because “truthful command outcomes” is core to Aeolus, but the limitation is already understood and can be documented for an early alpha.

## Pending commands are in memory

A process restart loses unresolved pending command correlation. That is a real operational limitation, but not a reason to hold back a developer-focused alpha if clearly documented.

## Automation deletion is destructive

This is more important for user trust than it may initially seem because Logic/UI can contain substantial authored work. Add confirm + archive/soft-delete/export before encouraging people to build valuable applications directly in Aeolus.

## Individual automation export/import

This is one of the highest-value adoption features after safety fixes because it lets applications move between systems, live in source control, and become shareable examples without requiring a full marketplace architecture.

---

# Additional hardening observations

These are not current promotion blockers under the documented mostly-trusted single-site threat model, but should remain visible:

- Sandbox HTTP SSRF checks block literal private/link-local addresses, but DNS rebinding/hostnames that resolve private and redirects to private targets are not resolved/validated at the network layer. Response bodies also have no explicit size cap.
- Form-rule webhook actions use host `fetch()` without the sandbox's timeout or SSRF policy. Consolidate outbound requests behind one bounded host HTTP service.
- Internal automation MQTT publish bypasses the REST raw-publish namespace policy. That is acceptable for administrator-authored code, but not if non-admin script authoring remains enabled.
- `/metrics` is deliberately open when `METRICS_TOKEN` is unset. Fine on LAN-only installs; remotely reachable deployments should set a token or fail closed in production.
- `/api/system/version` performs an outbound GitHub update check per request. Caching the result would reduce unnecessary external dependency/abuse potential.
- The Mosquitto reload sidecar installs `inotify-tools` with `apk add` at container startup. For a resilient/offline appliance, bake this into a tiny pinned sidecar image instead of needing the Alpine package repository at runtime.

---

# Testing and repository quality

The testing footprint is excellent for an individual project:

- 126 backend unit/property test files;
- 98 frontend unit/component test files;
- 8 backend integration test files;
- Playwright E2E specs and a scheduled/manual E2E workflow;
- 90% frontend coverage thresholds;
- lint/typecheck/test gates on pull request and main;
- Docker image build after green main CI;
- Dependabot for npm, Docker and GitHub Actions;
- issue templates, pull-request template and CODEOWNERS;
- migration property tests and real Mosquitto provisioning integration tests.

I also found no committed real private keys, `.env` files or obvious production tokens in the archive. The password literals found by a simple pattern scan are test fixtures.

### Execution caveat for this review

I could not complete a clean `npm ci` in the review container because its package-registry mirror returned a missing-package/registry error, and the environment's Node runtime is also below the repository's current declared/pinned version. Therefore this report does **not** claim that the supplied archive's tests/build pass in this environment.

Require a green GitHub Actions run on the exact commit/tag that you promote. The Node pin mismatch above should be fixed first so the CI environment matches the lockfile requirement.

---

# Portfolio assessment

## Why this is a standout portfolio project

Aeolus demonstrates substantially more engineering range than a conventional full-stack portfolio:

- asynchronous physical-device semantics rather than simple CRUD;
- MQTT 5, correlation IDs, acknowledgement and observation models;
- uncertain command outcomes represented explicitly instead of hidden behind HTTP 200;
- connector discovery/lifecycle and multi-instance ownership;
- local-first/offline operation;
- isolated V8 Logic execution;
- opaque-origin iframe UI sandboxing and RPC capability brokerage;
- WebSocket visibility and authenticated lifecycle;
- SQLite schema evolution, rollback and backup design;
- Docker/Raspberry Pi deployment and host-network trade-offs;
- operational metrics/logging/health checks;
- security threat-model documentation and adversarial architecture review;
- a coherent product point of view rather than a collection of technologies.

For a developer with five-plus years of full-stack experience, this is plausibly a **top 1–3% personal portfolio project** when assessed for IoT/edge/platform roles. The strongest signal is not the feature count. It is that the repository repeatedly confronts the uncomfortable parts of physical systems: identity, ownership, uncertainty, retries, failure evidence, upgrades and local operations.

## What an experienced interviewer is likely to probe

Expect questions such as:

1. Why Aeolus rather than Home Assistant or Node-RED?
2. Where is the trust boundary between user Logic and the host?
3. How do you know a command really happened?
4. What happens when MQTT is down at startup or halfway through a command?
5. How do connector instances own devices?
6. How are schema upgrades made safe on a field-deployed Pi?
7. What exactly do `read/interact/write` permissions guarantee?
8. What is the difference between an optimistic state update and a physical observation?
9. What would you change for 1,000 sites instead of one site?

Aeolus gives you unusually substantive answers to most of those questions. Fixing the authoring permission inconsistency makes the answer to #7 much stronger.

---

# Industry usefulness

## Where Aeolus is already genuinely useful

The current platform can reasonably help technically capable developers/integrators building a single physical site around:

- custom MQTT sensors/controllers;
- rural water, tanks, pumps and energy systems;
- workshops/greenhouses/small farms;
- escape rooms and immersive installations;
- stage/show controls;
- research rigs and scientific instrumentation;
- custom dashboards where generic entity cards are not enough.

The strongest product idea remains the pairing of **Logic + UI + local state** as one application-like unit. That bridges a real gap between a giant generic home-automation dashboard and writing an entire bespoke Node/Python/React stack for each site.

## Where it is not ready to compete

Aeolus is not yet a replacement for:

- Home Assistant's integration ecosystem;
- Node-RED's onboarding/community ecosystem;
- PLC/SCADA for certified deterministic/safety-critical control;
- cloud fleet-management products;
- mature HA/failover infrastructure;
- large time-series/analytics platforms.

The docs are commendably honest about this.

## Biggest adoption blockers now

The next barriers are increasingly ecosystem/product issues rather than core architecture:

1. only two first-party commercial connectors (Hue and Kasa) plus MQTT;
2. no portable automation/application package format yet;
3. destructive automation deletion;
4. developer-oriented installation and onboarding;
5. no Modbus/industrial-adjacent connector yet;
6. limited evidence from external installations run by someone other than the author;
7. no durable pending-command reconciliation after restart;
8. permissions need the authoring/read consistency fixes described above.

## Highest-value next validation

After the release-boundary fixes, the most valuable milestone is **not another large internal feature**. It is one external person using Aeolus for a strange real installation and being able to install it, build an application, operate it for a few weeks and report back.

That proves the central thesis far better than another simulated tab.

A Modbus TCP/RTU connector would then be strategically useful for IoT/edge job credibility, because it expands the story from consumer integrations + MQTT into industrial-adjacent equipment without pretending Aeolus is a PLC.

---

# Practical release recommendation

## Before public repository/portfolio promotion

I would fix these first because they are either easy or directly contradict public claims:

1. Decide and enforce the non-admin authoring policy. Simplest: admin-only Logic/layout authoring for now.
2. Filter `/api/state` and the initial WebSocket snapshot.
3. Resource-filter device auxiliary reads and automation history; filter layout reads.
4. Fix/admin-gate the generic named trigger endpoint.
5. Admin-gate or resource-scope Data Store mutations/reads.
6. Redact/admin-gate connector status and Hue light-search endpoints.
7. Redact MQTT provisioning status for non-admins.
8. Admin-gate system diagnostics/logs and redact broker URLs in logs.
9. Start MQTT retry after an initial connection failure.
10. Pin Node >=22.22.1 consistently.
11. Run the documentation truthfulness pass, especially Compose/MQTT provisioning wording.

Items 1–9 are the ones most likely to create an embarrassing demonstration or security-review moment. Most are small now because the core permission and command abstractions already exist.

## Before an anonymous/shared public demo

Do **not** simply expose an ordinary Aeolus account to strangers. Use the previously discussed dedicated demo mode / fail-closed allowlist, simulated devices, isolated database and broker, no real credentials, bounded state/fire operations and periodic reset.

## Acceptable to leave as documented early-alpha limitations

- pending command recovery after process restart;
- state provenance unification;
- automation archive/undo, if you add a prominent confirmation before broader user testing;
- app export/import;
- managed MQTT provisioning remaining opt-in;
- limited connector catalogue;
- no HA/fleet/industrial-safety guarantees.

---

# Bottom line

Aeolus has improved from “an unusually ambitious solo project” into a **credible early edge-application platform with a defensible architectural thesis**.

The latest backlog work materially changed the quality of the project. MQTT routing and connector ownership are no longer obvious architecture weaknesses, broker provisioning is being treated as a verified operational state rather than a configuration checkbox, and database evolution/testing are stronger than many production internal tools.

The main remaining architectural inconsistency is the permission model around **authoring**: resource authorization is enforced when a user directly presses a device/action endpoint, but authored Logic still executes with platform-wide authority. Solve that, close the adjacent read/credential leaks, and the multi-user story becomes much more coherent.

For employment purposes, you should already be proud to put Aeolus front and centre when applying for IoT, edge, backend/platform or automation roles. The project demonstrates exactly the kind of transition from conventional full-stack work into software that interacts with the physical world: protocols, failure modes, devices, deployment constraints and operational truth all matter at once.
