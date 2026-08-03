# Requirements Document

## Introduction

Aeolus should offer a public, shared demo at `demo.aeolus.com.au` that lets a
stranger explore the real platform — the real frontend, backend, automation
engine, sandboxed Logic/UI, WebSocket updates, Data Store reads and internal
MQTT — against seeded simulated environments, without exposing real devices,
credentials, authoring, administration, arbitrary MQTT/HTTP, host services or
durable public state.

The demo is **not a fork**. It is the same Aeolus, activated by explicit
configuration and, when active, constrained by an **additive, fail-closed
capability envelope** layered on top of the existing authentication, resource
authorization, automation-scope and Data Store controls. Those controls are not
weakened; demo mode only ever removes capability.

This is grounded in the current architecture (verified): a single global
`authenticate` middleware runs before every route in `src/index.ts`; resource
access is already gated by fail-closed `requireDevicePermission` /
`requireAutomationPermission` resolvers; and the custom-UI helpers `aeolus.save`
and `aeolus.fire` map to `PUT /api/automations/:id/state` and
`POST /api/automations/:id/fire`. Demo mode inserts one guard after
`authenticate`, adds one token claim, bounds two mutating routes, and seeds a
restricted identity — nothing more invasive.

The feature is delivered in two phases:

- **Phase A — Application demo mode** (the security boundary): configuration,
  demo session token, fail-closed guard, bounded state/fire, rate/payload
  limits, seeded demo identity, and frontend demo behaviour. Independently
  testable and the source of all safety guarantees.
- **Phase B — Deployment & operations**: dedicated Compose stack, golden/active
  database split, nightly and manual reset, Cloudflare-Tunnel ingress, resource
  limits, deploy workflow and observability.

## Glossary

- **Public_Demo_Mode**: The backend operating state where `AEOLUS_PUBLIC_DEMO`
  is true. Off by default; never inferred from hostname or `NODE_ENV`.
- **Demo_Session**: An authenticated session whose access token carries
  `sessionType: "public-demo"`.
- **Normal_Session**: Any session without that claim (`sessionType` absent or
  `"normal"`) — every existing session is a Normal_Session and is unaffected.
- **Demo_User / Demo_Group**: The single seeded `demo` user and `Public Demo`
  group holding only `read`/`interact` on seeded demo tabs.
- **Public_Demo_Guard**: The single Express middleware, inserted after
  `authenticate`, that constrains Demo_Sessions to an allowlist.
- **Demo_Policy**: The ordered allowlist of `(method, path-pattern[, validator])`
  entries the guard consults. Anything not matched is denied.
- **Demo_Rule_Access**: Optional per-automation metadata declaring which state
  keys are writable and which fire event names are accepted for Demo_Sessions,
  e.g. `{ writableStateKeys: [...], fireEvents: [...] }`.
- **Seeded_Logic**: Trusted automation Logic/UI authored by the Aeolus project
  and seeded into the demo. Visitors never author or edit it.
- **Golden_Database**: The immutable known-good SQLite snapshot the demo resets
  from. **Active_Database**: the disposable database the running app uses.
- **Bounded_Interaction**: A visitor input drawn from a finite/validated set
  (toggle, slider, timer, scene, declared event) rather than free-form code,
  identifiers, topics, URLs or unbounded text.

## Requirements

### Requirement 1: Explicit, fail-closed demo activation

**User Story:** As an operator, I want demo mode off unless I deliberately turn
it on, so a normal Aeolus install can never accidentally behave as a public
demo.

#### Acceptance Criteria

1. THE backend SHALL read `AEOLUS_PUBLIC_DEMO` (boolean) and expose it as
   `config.publicDemo.enabled`, defaulting to **false**.
2. THE backend SHALL read `DEMO_SESSION_MINUTES` (default 120) and
   `DEMO_RESET_TIME` (default `03:30`) into config.
3. THE frontend SHALL read `VITE_PUBLIC_DEMO` (default false) to enable demo UI
   behaviour.
4. Public_Demo_Mode SHALL NOT be activated implicitly from hostname, origin or
   `NODE_ENV`; only the explicit flag activates it.
5. WHEN `AEOLUS_PUBLIC_DEMO` is false, THE demo session endpoint and the
   Public_Demo_Guard SHALL be inert (the guard is a pass-through and the
   endpoint responds 404/unavailable).

### Requirement 2: Demo session authentication

**User Story:** As a visitor, I want to land on the demo and start exploring
immediately without a login, while the session stays tightly limited.

#### Acceptance Criteria

1. THE backend SHALL add `POST /api/auth/demo-session`, active only when
   Public_Demo_Mode is on, which authenticates the seeded Demo_User and returns
   a short-lived access token.
2. THE `AccessTokenPayload` SHALL gain an optional `sessionType?: "normal" |
   "public-demo"`, and demo tokens SHALL set `sessionType: "public-demo"`.
3. THE claim SHALL be threaded through token signing, verification (including
   the WebSocket verify path) and `req.user`, such that an absent claim is
   treated as `"normal"` (backward compatible).
4. A Demo_Session SHALL NOT be issued a refresh token or refresh cookie.
5. THE demo token lifetime SHALL be `DEMO_SESSION_MINUTES` (default 120).
6. A Demo_Session SHALL NOT be able to use `POST /api/auth/login`,
   `POST /api/auth/setup`, `POST /api/auth/refresh`, `PUT /api/auth/password`,
   or any user/group management route.
7. WHEN a demo token expires, THE frontend SHALL be able to obtain a fresh
   Demo_Session automatically.
8. THE demo-session endpoint SHALL be rate limited per IP independently of login.

### Requirement 3: Seeded, minimally-privileged demo identity

**User Story:** As the demo author, I want the public identity to hold only the
permissions needed to operate the seeded tabs, so authorization alone already
blocks most abuse.

#### Acceptance Criteria

1. THE demo seed SHALL create exactly one `demo` user in a `Public Demo` group.
2. THE Demo_Group SHALL be granted only `read`/`interact` on the seeded demo
   tabs, and SHALL NOT hold `write`, `admin`, or any authoring/management grant.
3. THE Demo_User SHALL have role `"user"`, never `"admin"`.
4. Every publicly reachable demo tab SHALL be a deliberately seeded, reviewed
   tab (Requirement 15/seed quality).

### Requirement 4: Fail-closed Public Demo Guard (additive)

**User Story:** As a security-conscious maintainer, I want demo restrictions to
be an allowlist that denies anything new by default, so adding a route later
never silently exposes it to the public.

#### Acceptance Criteria

1. THE Public_Demo_Guard SHALL run **after** `authenticate` and **before** the
   route handlers/resource guards, so existing authorization still applies in
   full.
2. WHEN the request is not a Demo_Session (normal/absent `sessionType`), THE
   guard SHALL pass through unchanged.
3. WHEN the request is a Demo_Session, THE guard SHALL allow it only if it
   matches an entry in the Demo_Policy allowlist; otherwise it SHALL respond
   `403` with a demo-specific message and SHALL NOT reach the handler.
4. THE Demo_Policy SHALL be an allowlist keyed on HTTP method + path pattern; an
   unmatched method/path combination SHALL be denied (fail closed).
5. THE guard SHALL NOT convert a normally-restricted operation into an allowed
   one — it can only further restrict. A read that existing resource
   authorization would filter SHALL remain filtered.
6. Adding a new API route SHALL NOT grant Demo_Sessions access to it until it is
   explicitly added to the Demo_Policy.

### Requirement 5: Allowed read capabilities

**User Story:** As a visitor, I want the seeded tabs to render fully — devices,
state, automations, custom UI, history, health — so the demo feels real.

#### Acceptance Criteria

1. THE Demo_Policy SHALL allow the permission-filtered reads required to render
   seeded tabs, including at least: `GET /api/auth/me`, `GET /api/layout`,
   `GET /api/devices`, `GET /api/devices/:id`, `GET /api/devices/:id/history`,
   `GET /api/devices/:id/actions`, `GET /api/devices/:id/completion-tiers`,
   `GET /api/state`, `GET /api/automations`, `GET /api/automations/:id`,
   `GET /api/automations/:id/ui-module`, `GET /api/automations/:id/state`,
   `GET /api/automations/history`, approved Data Store read routes,
   `GET /api/health`, and `GET /api/system/version`.
2. Each allowed read SHALL continue to pass through its existing resource /
   collection permission filter; the guard SHALL NOT widen any read to a global
   read.
3. A Demo_Session SHALL be able to open a demo WebSocket connection and receive
   only the broadcasts its tab scope already permits.

### Requirement 6: Bounded automation state writes

**User Story:** As a visitor, I want seeded controls that persist small amounts
of state (a toggle, a timer) to work, while I cannot bloat or abuse storage.

#### Acceptance Criteria

1. THE Demo_Policy SHALL allow `PUT /api/automations/:id/state` for
   Demo_Sessions, subject to demo-specific validation, and existing
   `requireAutomation("interact")` authorization SHALL still apply.
2. FOR a Demo_Session, THE backend SHALL reject a state write before persistence
   when: the key exceeds 64 characters; the serialized value exceeds 8 KB; or
   the automation already holds 100 keys and the write introduces a new one.
3. WHERE an automation declares Demo_Rule_Access `writableStateKeys`, a
   Demo_Session SHALL be able to write only those keys; a write to any other key
   SHALL be rejected.
4. A rejected state write SHALL return a `4xx` validation/forbidden error and
   SHALL NOT modify stored state.
5. THE state-write route SHALL enforce a small dedicated request-body limit for
   Demo_Sessions, below the global 1 MB limit.

### Requirement 7: Allowlisted automation fire events

**User Story:** As a visitor, I want seeded buttons (pause, reset, send-hint) to
work, without being able to inject arbitrary automation context.

#### Acceptance Criteria

1. THE Demo_Policy SHALL allow `POST /api/automations/:id/fire` for
   Demo_Sessions, subject to demo-specific validation, with existing
   authorization still applied.
2. FOR a Demo_Session, THE fire request SHALL be accepted only in the
   `{ eventName, payload? }` form; a request supplying a `context` (topic,
   deviceId, state) override SHALL be rejected.
3. WHERE an automation declares Demo_Rule_Access `fireEvents`, only those event
   names SHALL be accepted for a Demo_Session; any other event name SHALL be
   rejected.
4. A Demo_Session fire SHALL never let the visitor choose the trigger topic,
   target device, or event state that trusted Seeded_Logic receives beyond the
   declared, bounded `eventName`/`payload`.

### Requirement 8: Explicitly forbidden capabilities

**User Story:** As a maintainer, I want a stranger to be unable to author,
administer, or reach infrastructure, regardless of how they craft requests.

#### Acceptance Criteria

1. A Demo_Session SHALL be denied all of: normal login/setup/refresh, password
   change, user/group management, and security administration.
2. A Demo_Session SHALL be denied all automation authoring (create, edit Logic,
   edit UI source, delete, change trigger/authority) and all layout authoring
   (tab/pane add/remove/reorder, save layout).
3. A Demo_Session SHALL be denied all raw MQTT publish, MQTT provisioning,
   credential and broker-security operations.
4. A Demo_Session SHALL be denied all connector operations (create/edit/delete,
   LAN discovery, Hue/Kasa pairing, setup workflows).
5. A Demo_Session SHALL be denied all Data Store administration (create/delete
   collection, arbitrary record writes, buckets, config, enable/disable, quotas)
   — only approved seeded read routes and bounded automation state are writable.
6. A Demo_Session SHALL be denied all system administration (logs, host/network
   diagnostics, config/env, metrics administration).
7. A Demo_Session SHALL be denied device administration (rename/delete devices,
   bridge management, arbitrary device actions) unless a specific simulated
   device action is later explicitly added to the Demo_Policy.

### Requirement 9: Dedicated demo rate and payload limits

**User Story:** As an operator, I want the app itself (not just Cloudflare) to
stop a visitor exhausting the demo with valid-but-excessive requests.

#### Acceptance Criteria

1. THE backend SHALL apply application-level rate limits: demo-session creation
   ~10/min/IP; automation state writes ~60/min/session; automation fire
   ~30–60/min/session; and a bounded cap on WebSocket connection attempts per
   IP/session.
2. Rate limiting SHALL NOT depend on Cloudflare; the limits SHALL be enforced in
   Aeolus.
3. THE backend SHALL enforce request-body, state-value, history-query and
   Data-Store result limits so a Demo_Session cannot exhaust memory with valid
   requests.
4. Exceeding a limit SHALL return `429` (rate) or `4xx` (payload), never a `500`
   or a crash.

### Requirement 10: Frontend demo mode

**User Story:** As a visitor, I want the demo to feel intentionally designed —
no login wall, no buttons that just 403, a clear "this is a demo" banner.

#### Acceptance Criteria

1. WHEN `VITE_PUBLIC_DEMO` is true, THE frontend SHALL request a Demo_Session on
   load and open the default demo tab without showing the login screen.
2. THE frontend SHALL display a persistent demo banner (simulated devices,
   shared, resets nightly) with a link back to `aeolus.com.au`.
3. THE frontend SHALL hide functionality unusable in demo mode (automation/Logic
   editors, layout editing, connector admin, MQTT security, security/admin
   pages, user/group management, system diagnostics, account/password settings,
   Data Store administration, destructive actions) rather than letting visitors
   click into `403`s.
4. WHEN a Demo_Session expires, THE frontend SHALL transparently obtain a new
   one.
5. WHEN the environment is in its nightly reset window, THE frontend SHALL show
   a deliberate maintenance state rather than generic connection errors.
6. THE demo SHALL be usable on mobile.

### Requirement 11: Trusted Seeded Logic boundary and outbound HTTP

**User Story:** As the demo author, I want trusted seeded Logic to keep its
normal capabilities, while the visitor only ever supplies bounded event inputs.

#### Acceptance Criteria

1. Seeded_Logic SHALL retain its normal sandbox capabilities (internal MQTT,
   simulated device control, Data Store access, approved outbound HTTP); the
   demo boundary is enforced at the visitor→REST edge, not inside the sandbox.
2. THE control path SHALL be: visitor → declared bounded event → Seeded_Logic →
   system capability; a visitor SHALL NEVER reach an arbitrary MQTT topic, URL
   or code path.
3. A Demo_Session SHALL NOT be able to author or edit any HTTP-capable Logic or
   supply an outbound URL.
4. THE demo deployment SHALL ensure no AWS metadata endpoint and no
   host/internal Docker service is reachable via any visitor-influenced request.

### Requirement 12: MQTT and network isolation (deployment)

**User Story:** As an operator, I want the demo broker and network fully
isolated so nothing real is reachable.

#### Acceptance Criteria

1. THE demo SHALL use a dedicated internal Mosquitto broker with MQTT port 1883
   not exposed publicly and no shared/real credentials.
2. THE demo SHALL not connect real devices, perform LAN discovery, or use host
   networking; simulator traffic SHALL stay inside the demo network.
3. Raw `POST /api/mqtt/publish` SHALL remain forbidden to Demo_Sessions while
   Seeded_Logic may use internal MQTT.

### Requirement 13: Golden/active database and reset

**User Story:** As an operator, I want the demo to reset to a known-good state
nightly and on demand, without the reset being load-bearing for security.

#### Acceptance Criteria

1. THE demo SHALL use two databases: an immutable Golden_Database and a
   disposable Active_Database; the app SHALL use only the Active_Database.
2. THE Golden_Database SHALL be read-only to the application (ideally not
   mounted writable into the backend container) and SHALL never be modified by
   normal app operation.
3. A nightly reset (~`03:30` Australia/Sydney) SHALL run an orderly sequence:
   mark maintenance → stop backend → reset broker state if needed → delete the
   Active_Database and its `-wal`/`-shm` files → copy the Golden_Database into
   place → start broker → start backend → health check → restore availability.
4. THE reset SHALL NOT overwrite the Active_Database while Aeolus is running.
5. THE system SHALL provide `scripts/reset-demo.sh` for an immediate manual
   reset, optionally via an admin/developer-only GitHub Action.
6. Demo safety SHALL NOT depend on the reset occurring; the environment SHALL
   remain safe even if a reset never runs.

### Requirement 14: Demo deployment

**User Story:** As an operator, I want a dedicated, hardened deployment separate
from any real install.

#### Acceptance Criteria

1. THE repo SHALL add `docker-compose.demo.yml` composing frontend, backend,
   mosquitto and cloudflared, with `NODE_ENV=production` and
   `AEOLUS_PUBLIC_DEMO=true`.
2. THE demo stack SHALL use bridge networking, no host networking, no public
   MQTT port, no public backend port, no public database, no Docker socket
   mount, `no-new-privileges`, minimal capabilities, and resource limits.
3. Public ingress SHALL be via Cloudflare Tunnel; ports 80/443/1883/backend/DB
   SHALL NOT be directly exposed on the VM.
4. THE demo environment SHALL contain no real connector credentials and perform
   no real device discovery.
5. Deployment SHALL be manual via a `workflow_dispatch` GitHub Action that
   builds/publishes an image for a chosen ref, deploys, and runs a health check;
   pushes to `main` SHALL NOT auto-deploy the demo.

### Requirement 15: Seed quality and observability

**User Story:** As the demo author, I want the seeded content to be compelling
and the running demo observable to operators only.

#### Acceptance Criteria

1. Each seeded demo tab SHALL demonstrate a distinct use case with meaningful
   state, no placeholder/broken content, no sensitive data, only trusted
   Logic/UI, and SHALL function without real LAN hardware and recover after
   reset.
2. Operators SHALL be able to observe demo version/commit, backend/broker
   health, reset status, active WebSocket sessions, rate-limit activity,
   unexpected 403/404 spikes, resource usage and restart count.
3. Administrative/observability metrics SHALL NOT be exposed to Demo_Sessions.

### Requirement 16: Security, adversarial and reset test coverage

**User Story:** As a maintainer, I want automated proof that the demo allows
exactly what it should and denies everything else, including hostile inputs.

#### Acceptance Criteria

1. Integration tests SHALL prove a Demo_Session CAN: obtain a session, load every
   seeded tab, read permitted device/automation/Data-Store state, receive
   permitted WebSocket updates, load custom UI modules, save permitted bounded
   state, and fire approved events.
2. Integration tests SHALL prove a Demo_Session CANNOT perform any capability in
   Requirement 8, supply arbitrary automation context or outbound URL, save
   oversized values, or bypass rate limits.
3. Tests SHALL prove that an unknown route/mutation fails closed for a
   Demo_Session.
4. Adversarial tests SHALL exercise a hostile client (direct API calls, oversized
   values, unexpected event names, context overrides, route fuzzing, rapid
   fire, many WS connections, forbidden endpoints, expired demo tokens, forged
   normal-JWT claims, invalid/hidden resource IDs) and SHALL always yield
   `403/404/429/validation error` — never `500`, crash, host access, secret
   disclosure, or persistent corruption.
5. Reset tests SHALL prove that after modifying demo state and running reset, the
   seeded state is restored, temporary modifications are gone, all tabs load,
   WebSocket/automations/MQTT work, and the Golden_Database is unchanged.

### Requirement 17: No regression to normal installations

**User Story:** As an existing operator, I want zero behavioural change when demo
mode is off.

#### Acceptance Criteria

1. WHEN Public_Demo_Mode is off, THE token payload, auth flows, authorization,
   rate limits and every route SHALL behave exactly as before.
2. THE `sessionType` claim SHALL be optional and backward compatible; existing
   tokens without it SHALL be treated as Normal_Sessions.
3. THE Public_Demo_Guard SHALL impose no restriction on Normal_Sessions.
4. Existing authentication, resource-authorization, automation-scope, event
   admission and Data Store test suites SHALL continue to pass unchanged.
