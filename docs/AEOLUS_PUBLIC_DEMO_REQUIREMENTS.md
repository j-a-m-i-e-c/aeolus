# Aeolus Public Demo Mode Requirements

**Status:** Proposed implementation specification  
**Purpose:** Define a safe, intentionally restricted public demo mode for Aeolus at `demo.aeolus.com.au`.

---

## 1. Goal

Create a public, shared Aeolus demo that allows visitors to explore the real Aeolus platform and interact with seeded simulated environments without exposing:

- real devices
- real credentials
- administrative capabilities
- arbitrary MQTT access
- arbitrary automation authoring
- arbitrary outbound HTTP access
- host services
- persistent user-controlled state

The demo should use the real Aeolus frontend, backend, automation engine, state system, WebSocket updates, Data Store reads, seeded Logic/UI, and internal MQTT infrastructure.

The public demo is **not** a separate fork of Aeolus.

It must be enabled using configuration flags and remain inactive in normal Aeolus installations.

---

## 2. Core Principles

### 2.1 Fail closed

Public demo access must be implemented as an explicit allowlist.

If a new API route is added later, public demo users must **not** automatically receive access to it.

Unknown or unclassified operations must be denied.

### 2.2 Demo restrictions are additive

The existing Aeolus authentication, resource authorization, tab permissions, automation scope protections, Data Store permissions, and other security controls must remain active.

Demo mode adds additional restrictions. It must not bypass or weaken existing authorization.

### 2.3 Shared but disposable

The public demo is shared between visitors.

Visitors may interact with approved seeded controls and modify temporary demo state.

The active environment is disposable and resets nightly from an immutable known-good snapshot.

### 2.4 Reset is not a security mechanism

The demo must remain safe even if a reset never occurs.

The nightly reset exists to restore presentation quality and demo state, not to recover from server compromise.

### 2.5 No real infrastructure

The public demo must never contain:

- production credentials
- personal credentials
- real Hue or Kasa credentials
- real MQTT credentials reused elsewhere
- real device connections
- LAN discovery
- host network access
- real farm/property data

---

# 3. Configuration

Add backend configuration:

```env
AEOLUS_PUBLIC_DEMO=true
DEMO_SESSION_MINUTES=120
DEMO_RESET_TIME=03:30
```

Recommended frontend configuration:

```env
VITE_PUBLIC_DEMO=true
```

Normal Aeolus deployments must default to:

```env
AEOLUS_PUBLIC_DEMO=false
```

Demo behaviour must never activate implicitly based on hostname or environment.

---

# 4. Demo Authentication

## 4.1 Demo session endpoint

Add:

```text
POST /api/auth/demo-session
```

This endpoint must only operate when:

```text
AEOLUS_PUBLIC_DEMO=true
```

It creates or authenticates the pre-seeded public demo user and returns a short-lived access token.

No username/password form is required for public visitors.

The frontend should automatically request a demo session when the demo site is opened.

## 4.2 Demo token type

Extend the access token payload:

```ts
interface AccessTokenPayload {
  userId: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
  sessionType?: "normal" | "public-demo";
}
```

Public demo tokens must contain:

```ts
sessionType: "public-demo"
```

## 4.3 Demo session restrictions

Public demo sessions:

- must be short lived
- should not receive refresh tokens
- must not be able to change passwords
- must not use normal login flows
- must not access setup/bootstrap flows
- should automatically obtain a new demo session after expiration

Suggested lifetime:

```text
120 minutes
```

---

# 5. Seeded Demo Identity

The seed process must create:

```text
User: demo
Group: Public Demo
```

The public demo group should receive only the minimum tab permissions required to operate the seeded demo.

Typical permissions:

```text
read / interact
```

Do not grant:

```text
admin
write
layout authoring
automation authoring
connector management
security management
```

All public-facing demo tabs should be deliberately seeded and reviewed.

---

# 6. Public Demo Guard

Create a dedicated backend policy layer such as:

```text
src/demo/public-demo-guard.ts
src/demo/demo-policy.ts
```

It should execute after authentication.

Conceptually:

```ts
if (!config.publicDemoMode) {
  next();
  return;
}

if (req.user.sessionType !== "public-demo") {
  next();
  return;
}

if (!demoPolicy.isAllowed(req)) {
  throw new ForbiddenError("Unavailable in the public demo");
}

next();
```

The policy must be an **allowlist**, not a blocklist.

A newly added route should be denied to public demo sessions until explicitly reviewed and allowed.

---

# 7. Allowed Public Demo Capabilities

The exact route list may evolve, but public demo sessions should generally be limited to the following categories.

## 7.1 Safe reads

Allow permission-filtered reads required to render seeded tabs:

```text
GET /api/auth/me

GET /api/layout

GET /api/devices
GET /api/devices/:id
GET /api/devices/:id/history
GET /api/devices/:id/actions
GET /api/devices/:id/completion-tiers

GET /api/state

GET /api/automations
GET /api/automations/:id
GET /api/automations/:id/ui-module
GET /api/automations/:id/state
GET /api/automations/history

approved Data Store read endpoints

GET /api/health
GET /api/system/version
```

All existing resource filters must remain active.

The demo guard must never turn a normally restricted read into a global read.

## 7.2 Approved mutations

Initially allow only:

```text
PUT  /api/automations/:id/state
POST /api/automations/:id/fire
```

These operations require additional demo-specific validation described below.

Simulated device actions may be enabled later if explicitly declared safe.

## 7.3 Admin read-only visibility (masked)

To let the public demo showcase the whole platform, demo sessions are granted
**read-only** visibility into the admin/pinned surfaces (System, Data Store,
Security, Connectors). This is only safe under two conditions, both of which the
demo box satisfies:

1. The demo box is a throwaway instance with **no real credentials or devices**
   configured, reset on a schedule.
2. A server-side masking layer (`src/demo/demo-scrub.ts`) redacts sensitive
   fields from these responses before they leave the process — host/network
   identifiers, credentials, real usernames, and raw log contents become `•••`.

Allowlisted admin **reads** (GET only):

```text
GET /api/system                       (hostname + network addresses masked)
GET /api/system/logs                  (IPs / long tokens scrubbed from messages)
GET /api/connectors                   (config secrets masked)
GET /api/connectors/available
GET /api/connectors/:id/status        (config secrets masked)
GET /api/data-store/config
GET /api/data-store/stats
GET /api/data-store/buckets
GET /api/data-store/buckets/:bucket
GET /api/auth/users                   (usernames pseudonymised)
GET /api/auth/groups
GET /api/auth/mqtt-credentials        (credential fields masked)
GET /api/mqtt/provisioning/status     (shared credential already stripped for non-admins)
GET /api/mqtt/private-topics
```

Enforcement: `requireAdmin` relaxes only for public-demo sessions on read-only
methods (GET/HEAD); the fail-closed guard remains the authoritative allowlist,
so no mutating admin route becomes reachable. On the frontend these pages render
without their mutating controls (`useReadOnlyDemo`).

---

# 8. Explicitly Forbidden Capabilities

Public demo sessions must never be able to perform the following. Note: several
admin surfaces are now **viewable read-only with masking** per §7.3 — the items
below concern the *mutations* and *unmasked/raw* access that remain forbidden.

## Authentication and administration

```text
normal login
setup/bootstrap
password changes
refresh token management
user management
group management
security administration
```

## Automation authoring

```text
create automation
edit Logic
edit custom UI source
delete automation
change trigger configuration
change automation authority
```

## Layout authoring

```text
add/remove/reorder tabs
add/remove/reorder panes
save global layout
```

## MQTT administration

```text
raw MQTT publish
MQTT provisioning
MQTT credential creation
MQTT credential revocation
private-topic administration
broker security mode changes
```

## Connector administration

```text
create connector
delete connector
edit connector configuration
perform LAN discovery
Hue bridge pairing
Kasa discovery
connector setup workflows
```

## Data Store administration

```text
create collection
delete collection
write arbitrary records
export unrestricted data
enable/disable Data Store
modify quotas
manage shared buckets
```

Only explicitly approved seeded state interactions should be writable.

## System administration

Host diagnostics and application logs are **viewable read-only but masked** per
§7.3 (hostname/network addresses redacted; IPs and long tokens scrubbed from log
messages). Still forbidden:

```text
unmasked host / network / disk identifiers
environment/config values
metrics administration
any system mutation
```

## Device administration

```text
rename real devices
delete devices
bridge management
arbitrary device actions
```

If simulated device actions are added later, they must be explicitly allowlisted.

---

# 9. Automation State Writes

Public visitors may use seeded UI functionality implemented through:

```ts
aeolus.save(...)
```

Public demo state writes must have bounded storage.

Recommended limits:

```text
maximum key length: 64 characters
maximum serialized value size: 8 KB
maximum keys per automation: 100
maximum request body: small dedicated limit
```

The backend must reject oversized state writes before persistence.

Where practical, individual seeded automations may define permitted writable state keys.

Example:

```ts
demoAccess: {
  writableStateKeys: [
    "master",
    "spot",
    "tracking",
    "timer"
  ]
}
```

This stricter per-rule policy is preferred for controls exposed publicly.

---

# 10. Automation Fire Events

Public custom UIs may use:

```ts
aeolus.fire(...)
```

Public demo firing must be restricted to explicit seeded interactions.

Preferred request format:

```json
{
  "eventName": "pause",
  "payload": {}
}
```

Public demo sessions must **not** be allowed to supply arbitrary automation contexts.

Reject inputs such as:

```json
{
  "context": {
    "topic": "arbitrary/topic",
    "deviceId": "arbitrary-device",
    "state": {}
  }
}
```

Recommended per-automation policy:

```ts
demoAccess: {
  fireEvents: [
    "pause",
    "reset",
    "send-hint"
  ]
}
```

Only declared event names should be accepted for public demo sessions.

Seeded trusted Logic may continue using its normal system capabilities where required.

---

# 11. Seeded Logic Trust Model

Seeded Logic is trusted application code authored by the Aeolus project.

Visitors do not author or modify it.

Seeded Logic may use capabilities such as:

- internal MQTT publishing
- simulated device control
- Data Store access
- approved outbound HTTP integrations

This is acceptable because visitors control only bounded event inputs.

The distinction must remain:

```text
visitor
  ↓
approved event
  ↓
trusted seeded Logic
  ↓
system capability
```

Never:

```text
visitor
  ↓
arbitrary MQTT topic / URL / code
```

---

# 12. Outbound HTTP

Public users must not control outbound destinations.

Existing seeded integrations may call known public services, for example:

- The Space Devs
- ISS location APIs
- NOAA space weather APIs

Long term, demo deployment should ideally use an outbound allowlist.

At minimum:

- public users cannot author HTTP-capable Logic
- public users cannot provide URLs
- no AWS metadata endpoint is reachable
- no host/internal Docker service should be reachable through user-controlled HTTP

---

# 13. MQTT Demo Isolation

The public demo must use a dedicated internal Mosquitto broker.

Requirements:

- MQTT port 1883 is not exposed publicly
- no real devices connect to the demo broker
- no credentials are shared with any other deployment
- raw `/api/mqtt/publish` is forbidden to demo users
- trusted seeded Logic may use internal MQTT
- simulator traffic remains inside the demo environment

LAN discovery should be disabled.

Do not use host networking.

---

# 14. Frontend Demo Mode

When:

```text
VITE_PUBLIC_DEMO=true
```

the frontend should behave intentionally as a demo.

## 14.1 Automatic session

On load:

```text
request /api/auth/demo-session
→ authenticate
→ open default demo tab
```

Avoid exposing the normal login screen to public visitors.

## 14.2 Demo banner

Display a small persistent banner such as:

> **Public demo** · Simulated devices · Shared environment · Resets nightly

Include a link back to:

```text
aeolus.com.au
```

## 14.3 Hide unusable functionality

Do not merely let visitors click controls that will return 403.

Hide:

- automation editors
- layout editing
- connector administration
- MQTT security
- security/admin pages
- user/group management
- system diagnostics
- password/account settings
- Data Store administration
- destructive actions

The public demo should feel deliberately designed, not artificially broken.

---

# 15. Free-Text Input Policy

Avoid unnecessary public free-text fields.

Public visitors should primarily manipulate bounded values such as:

- switches
- sliders
- timers
- scene selections
- seeded commands
- finite options

Do not expose fields that allow arbitrary public-facing names/descriptions unless required.

This reduces abuse and prevents the demo from becoming covered in offensive text.

---

# 16. Rate Limits

Apply dedicated public-demo rate limits.

Suggested starting limits:

```text
demo session creation:
  10 requests / minute / IP

automation state writes:
  60 requests / minute / session

automation fire:
  30–60 requests / minute / session

WebSocket connection attempts:
  bounded per IP/session
```

Tune based on observed usage.

Rate limiting must not rely on Cloudflare alone.

Aeolus should enforce its own application-level limits.

---

# 17. Resource Limits

The demo VM and containers must have reasonable resource ceilings.

Apply limits to:

- backend memory
- backend CPU
- Mosquitto memory
- simulator memory
- frontend/reverse proxy resources where appropriate

The application should also enforce:

- request body limits
- state-value limits
- history query limits
- Data Store result limits
- WebSocket connection limits where practical

Goal:

A visitor should not be able to exhaust the VM simply by sending valid but excessive requests.

---

# 18. Demo Database Model

Use two databases:

```text
immutable golden snapshot
active disposable database
```

Example host structure:

```text
/opt/aeolus-demo/
├── golden/
│   └── aeolus-demo.db
├── data/
│   └── aeolus.db
└── scripts/
    ├── reset-demo.sh
    └── demo-health-check.sh
```

The backend should mount/use only:

```text
data/aeolus.db
```

The golden snapshot should not be writable or ideally even mounted into the backend container.

Recommended permissions:

```text
golden/aeolus-demo.db → read-only to deployment/reset owner
```

---

# 19. Nightly Reset

The environment should reset once per night.

Recommended time:

```text
03:30 Australia/Sydney
```

The reset sequence must be orderly.

```text
mark demo unavailable / maintenance state
↓
stop backend
↓
stop broker if broker state also needs reset
↓
delete active SQLite database
↓
delete active -wal / -shm files
↓
copy immutable golden DB to active location
↓
clear disposable broker state if needed
↓
start Mosquitto
↓
start backend
↓
run health check
↓
restore public availability
```

Do **not** overwrite the active SQLite database while Aeolus is running.

The UI should state:

> Shared demo. Changes are temporary and reset nightly.

---

# 20. Manual Reset

Provide:

```text
scripts/reset-demo.sh
```

This must allow an operator to immediately reset a damaged or vandalized shared demo.

Optionally expose this through a manual GitHub Action:

```text
Reset Public Demo
```

This workflow must be admin/developer initiated only.

---

# 21. Demo Deployment

Add:

```text
docker-compose.demo.yml
```

Suggested services:

```text
frontend
backend
mosquitto
cloudflared
```

Optional separate simulator service if simulation is not handled by seeded MQTT Logic.

Requirements:

- `NODE_ENV=production`
- `AEOLUS_PUBLIC_DEMO=true`
- bridge networking
- no host networking
- no public MQTT port
- no public backend port
- no public database
- Cloudflare Tunnel as public ingress
- no real connector credentials
- no real device discovery
- no Docker socket mount
- no unnecessary Linux capabilities
- `no-new-privileges`
- resource limits

---

# 22. Cloudflare / Origin Security

Preferred traffic flow:

```text
Internet
  ↓
Cloudflare
  ↓
Cloudflare Tunnel
  ↓
demo frontend/backend
```

Do not expose ports 80/443 directly on the VM if Tunnel is used.

Do not expose:

```text
1883
backend API port
SQLite
Docker daemon
```

SSH should be:

- restricted to trusted admin IPs, or
- accessed through an appropriate management mechanism

---

# 23. Deployment Workflow

Demo deployment should remain manual.

Recommended GitHub Action:

```text
Deploy Aeolus Demo
```

Trigger:

```yaml
on:
  workflow_dispatch:
```

The operator chooses a branch/tag/commit.

The workflow should:

```text
run required CI/build checks
build immutable images
publish image
connect to demo host
pull selected version
restart demo services
run health check
```

Do not automatically deploy every push to `main`.

---

# 24. Security Tests

Add explicit public-demo integration tests.

A public demo token **must be able to**:

- obtain a demo session
- load every seeded public tab
- read its permitted device state
- receive permitted WebSocket updates
- load custom UI modules
- read automation state
- save permitted bounded state
- fire approved events
- read approved demo Data Store data

A public demo token **must not be able to**:

- use normal login/setup administration
- create users
- change passwords
- manage groups
- create/edit/delete automations
- edit Logic
- edit custom UI source
- change layout
- configure connectors
- perform LAN discovery
- publish arbitrary MQTT
- configure MQTT security
- access MQTT credentials
- manage Data Store collections
- write arbitrary Data Store records
- read system logs
- read host/network diagnostics
- invoke arbitrary device actions
- supply arbitrary automation context
- supply arbitrary outbound HTTP URLs
- save oversized values
- bypass rate limits

Unknown routes/mutations must fail closed.

---

# 25. Reset Tests

Test reset behaviour:

1. Start from golden state.
2. Modify several demo controls.
3. Persist automation UI state.
4. Run reset.
5. Verify:
   - original seeded state restored
   - temporary user modifications gone
   - all tabs load
   - WebSocket works
   - automations are registered
   - MQTT connects
   - demo session endpoint works
   - health check passes

Also test that the golden database is never modified by normal app operation.

---

# 26. Abuse / Adversarial Tests

Before launch, manually test the demo as a hostile browser client.

Attempt:

- direct API requests ignoring frontend UI
- oversized JSON values
- unexpected event names
- arbitrary context overrides
- route fuzzing
- rapid repeated `fire()` requests
- many WebSocket connections
- forbidden connector endpoints
- forbidden MQTT endpoints
- forbidden Data Store writes
- expired demo tokens
- forged normal JWT claims
- invalid device IDs
- hidden resource IDs

Expected outcome:

```text
403 / 404 / rate-limited / validation error
```

Never:

```text
500
process crash
host access
secret disclosure
persistent corruption
```

---

# 27. Observability

The operator should be able to observe:

- current demo version / commit
- backend health
- broker health
- reset status
- number of active WebSocket sessions
- rate-limit activity
- unexpected 403/404 spikes
- memory/CPU usage
- restart count

Do not expose these administrative metrics to public demo users.

---

# 28. Demo UX Requirements

The public demo should explain itself.

Display:

> **Public demo**  
> This is a shared simulated Aeolus environment. Changes are temporary and the environment resets nightly.

Consider showing:

```text
Demo build: <short commit SHA>
```

The visitor should always have:

```text
Back to aeolus.com.au
```

available.

If the environment is in its nightly reset window, show a deliberate maintenance state rather than generic connection errors.

---

# 29. Seed Quality Requirements

Before launch, review every public demo tab.

Each should:

- demonstrate a distinct Aeolus use case
- have meaningful values/state
- avoid obviously broken or placeholder content
- avoid sensitive/private data
- contain only trusted Logic/UI
- function without real LAN hardware
- recover correctly after nightly reset

Suggested flagship tabs include:

- Agriculture
- Escape Room
- Stage / Show Control
- Research Vessel
- Underground Mining
- Spacecraft
- Wildlife / Environment
- Off-grid Bunker

The collection should communicate:

> One platform can give very different physical places their own purpose-built software.

---

# 30. Non-Goals

The first public demo does **not** need:

- per-visitor isolated containers
- per-visitor databases
- multi-tenancy
- user registration
- persistent public accounts
- public automation authoring
- public connector installation
- public MQTT access
- public custom UI authoring
- real hardware
- fleet management
- autoscaling
- Kubernetes
- complex cloud infrastructure

Do not expand scope unless real demo usage demonstrates a need.

---

# 31. Acceptance Criteria

Demo mode is ready for launch when all of the following are true.

## Backend

- [ ] `AEOLUS_PUBLIC_DEMO` exists and defaults to false.
- [ ] `/api/auth/demo-session` creates short-lived demo-only sessions.
- [ ] Demo sessions receive no refresh token.
- [ ] Public demo guard is fail closed.
- [ ] Only explicit route/method combinations are allowed.
- [ ] Automation state writes have hard limits.
- [ ] Automation fire events are allowlisted.
- [ ] Arbitrary context override is impossible for public demo sessions.
- [ ] Raw MQTT publish is forbidden.
- [ ] Authoring and administration are forbidden.
- [ ] Existing resource authorization remains active.

## Frontend

- [ ] Demo session is obtained automatically.
- [ ] Demo banner is visible.
- [ ] Admin/editing functionality is hidden.
- [ ] No visible controls knowingly lead to 403 responses.
- [ ] Link back to `aeolus.com.au` exists.
- [ ] Demo behaves cleanly on mobile.

## Infrastructure

- [ ] Dedicated demo Compose file exists.
- [ ] Broker is internal only.
- [ ] Backend is not directly internet exposed.
- [ ] Cloudflare Tunnel is the public ingress.
- [ ] No real credentials exist in the environment.
- [ ] Golden DB is immutable from the application.
- [ ] Nightly reset runs at approximately 03:30 Australia/Sydney.
- [ ] Manual reset command exists.
- [ ] Health check runs after reset/deploy.
- [ ] Resource limits are configured.

## Tests

- [ ] Allowed demo operations are covered by integration tests.
- [ ] Forbidden demo operations are covered by integration tests.
- [ ] Unknown mutations fail closed.
- [ ] Rate/payload limits are tested.
- [ ] Reset restores known-good state.
- [ ] Golden DB remains unchanged.
- [ ] Exact public deployment commit has green CI.

---

# 32. Recommended Implementation Order

Implement in this order:

1. Add demo configuration flags.
2. Seed public demo user/group.
3. Add demo session token type and `/api/auth/demo-session`.
4. Implement fail-closed `PublicDemoGuard`.
5. Allow safe read endpoints.
6. Add bounded `aeolus.save()` support.
7. Add allowlisted `aeolus.fire()` support.
8. Add demo-specific rate/payload limits.
9. Add frontend automatic demo session and banner.
10. Hide administrative/authoring UI.
11. Add integration/adversarial tests.
12. Create `docker-compose.demo.yml`.
13. Create immutable golden database.
14. Implement manual reset script.
15. Implement nightly reset.
16. Add manual GitHub deployment workflow.
17. Deploy through Cloudflare Tunnel.
18. Run final hostile-client test pass.
19. Launch `demo.aeolus.com.au`.

---

# 33. Final Design Rule

When deciding whether to expose a feature in public demo mode, use this test:

> Can a stranger use this feature to choose arbitrary code, resource IDs, MQTT topics, network destinations, credentials, persistent public text, or host-level behaviour?

If yes:

```text
DENY BY DEFAULT
```

If the feature can be expressed as a bounded interaction against trusted seeded content:

```text
ALLOW EXPLICITLY
```

The public demo should showcase Aeolus's real platform behaviour while keeping the visitor inside a small, disposable, intentionally designed capability envelope.
