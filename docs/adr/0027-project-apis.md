# ADR-0027: Project APIs — published, read-only HTTP endpoints for Automation Projects

- **Status:** Proposed (Phase 0 complete, awaiting review before Phase 1)
- **Date:** 2026-11-19
- **Plan:** [Project APIs implementation plan](../architecture/project-apis-plan.md)

## Context

Automation Projects (ADR-0012) can show data in their own dashboard UI, but another program,
including another Aeolus installation, has no supported way to read it. The only HTTP
surface is the dashboard API, which authenticates human sessions with 15-minute JWTs and
refresh cookies (ADR-0025) and authorizes through tabs and groups (ADR-0019). Reusing that
for unattended machine access would either hand out human credentials or grow a hidden
admin account.

Aeolus is local-first and is not hardened for arbitrary public exposure
(`docs/security/README.md`). The first consumer is another Aeolus installation on the same
LAN or VPN.

Phase 0 checked the original plan against the code at `ea1afa1` and found several
assumptions that do not hold. They shape the decision below:

- **The Logic bundle cannot provide handlers.** The generated Logic entry always calls
  `automation({ actions: [run] })`, esbuild removes named exports that nothing imports,
  and running the bundle runs every imported file's top-level code.
- **`Sandbox.execute()` returns success or failure only**, and its setup script reads
  device, MQTT, HTTP and state references without checking they exist. Passing it fewer
  capabilities makes it throw rather than producing a restricted sandbox.
- **isolated-vm's `timeout` bounds synchronous execution only.** CPU spent after an
  `await` keeps running on the isolate's thread until the isolate is disposed (measured).
- **Running a request through `AutomationEngine.fire()` would be wrong:** one
  `execution_history` row per request, duplicate suppression of identical concurrent
  GETs, and competition for the engine's ten execution slots.
- **The global `authenticate` middleware rejects any bearer token that is not a JWT**, and
  the public-demo guard only inspects demo *sessions*, so it never sees machine requests.
- **There is no audit log for admin actions, no log redaction, and no persistent rate
  limiting.** The request logger records full URLs, including query strings.
- **Automation ids are random UUIDs, and the showcase seeder deletes and recreates its
  automations on every reseed.** A URL or grant tied to an automation id does not survive
  `make showcase-seed`.
- **Anyone with `write` on a tab can edit a project's files.** A tab writer could therefore
  change the code behind an already-approved endpoint.
- **Saving the layout cleared every tab-scoped automation's owner.** Fixed separately in
  `1430c87` before this work, because ownership is part of the authority model.

## Decision

A Project API is a set of **GET-only, read-only** endpoints an Automation Project declares
in source. An admin **publishes an immutable snapshot** of them under a permanent slug, and
**API clients** with **API keys** call them through `/api/exposed/v1/<slug>/…`. API clients
are not dashboard users.

### Declaration

- `api/routes.json` is a static manifest: data, parsed with `JSON.parse` and validated with
  Zod, never executed. Version 1 allows up to 16 routes. Methods are `GET` only. Paths use
  lowercase literal segments and `:name` parameters, with no wildcards, regular
  expressions, optional segments or query-driven routing. Each route has a stable `id`, the
  name of the exported `handler`, and a JSON Schema for its success `response`.
- Two routes that some request path could match both (`/tanks/:id` and `/tanks/all`) are a
  compile error, not resolved by precedence.
- The response schema is a small subset of JSON Schema. It excludes `pattern` (a ReDoS
  surface, because validation runs on the host), `$ref`/`$defs`, `format` and composition
  keywords, and is capped at 8 KiB and depth 8. Zod's `fromJSONSchema` builds the validator
  and `toJSONSchema` will produce the OpenAPI document, so no new dependency is needed.
- Handlers live in `api/handlers.ts`. They are compiled into a **separate bundle** whose
  generated entry imports exactly the handlers the manifest names, so a missing export is a
  compile error.
- The API bundle may import only files under `api/` and `lib/`, and only `.ts`, `.js` and
  `.json`. Every import, including those made by `lib/` files, goes through the resolver
  that enforces this, so the whole import graph is checked. Nothing under `logic/` or `ui/`
  and no packages. `lib/` is the explicit directory for code shared with Logic. It is not
  called `shared/`, to avoid confusion with Shared Automation State. A `lib/` module's
  top-level code does run, but only inside the API sandbox described below.

### Execution

API handlers run through a dedicated `invokeApiHandler()`, never through `Sandbox.execute()`
or the engine.

- There is a fresh isolate per request, with 32 MB memory and its own setup script. The only
  host capability is a **read-only view of the owning automation's state**: `state.get` and
  `state.getAll`, bound to the automation id on the host. There are no devices, MQTT, HTTP,
  events, Shared State, Data Store, log, context or `automation()`. Using any of them is a
  ReferenceError.
- `state` and `api` are frozen, non-writable, non-configurable globals. The raw references
  are removed before author code loads, and the bundle runs in strict mode, so writes to
  them throw.
- The request (`routeId` and decoded `params`) and every response cross the boundary as
  JSON strings or `ExternalCopy` copies, never as callable references. The request is
  deep-frozen inside the isolate.
- **A host wall-clock deadline (5 s) disposes the isolate.** That ends synchronous loops,
  CPU loops after an `await`, and promises that never settle. Responses are capped at
  64 KiB, and at most four isolates run at once.
- A handler returns a JSON value (200) or `api.response(status, body)` with status 400 or
  404. Every other status belongs to the host. A 200 body must satisfy the route's response
  schema, or the caller receives a 500 that does not leak details.
- No `execution_history` row is written and no automation events are emitted. Requests are
  attributed in structured logs (request id, API, route, client, status, duration, reason)
  and in a bounded in-memory activity list.

### Publication

- **What is served is an immutable publication snapshot**, not the project's current
  source. Publishing copies the compiled manifest, API bundle, content hash, the automation
  revision it came from, and the API runtime contract version into a snapshot row. Only an
  admin can publish, and only for an admin-authored (unrestricted) automation in the MVP.
- Saving the project never changes what is served, so a tab writer's edit cannot run under
  an existing grant. When the current source's API content hash differs from the published
  snapshot, the Endpoints section shows **unpublished changes**. Serving them requires an
  admin to review and republish. Nothing reactivates silently.
- A publication **fails closed** (503 for a granted caller) when its automation is
  disabled, when it is no longer admin-authored, when the snapshot's runtime contract no
  longer matches the server's (an Aeolus upgrade that changes the sandbox capabilities),
  or when the snapshot is missing. Deleting the automation deletes its API, snapshots and
  grants.
- Snapshots are also the foundation for the planned project versioning and rollback work:
  a snapshot is a compiled, reviewable revision.

### Identity

- Each API has a permanent internal id and an admin-chosen **slug** (`[a-z0-9-]{3,48}`,
  unique), independent of the automation's UUID and name. Renaming the automation or
  editing the project never changes the URL.
- Changing a slug is an explicit admin action. The old slug stops resolving and is
  **retired permanently**, so another project can never take over a URL an integration
  still calls.
- The showcase is the documented exception: reseeding deletes and recreates its
  automations, which deletes their APIs, publications and grants. Reseeding never creates
  publications or grants, and never carries old credentials forward.

### Clients, keys and authorization

- **API clients** are named records managed by real admins in the dashboard. They have no
  login, role, session or refresh token, and never appear in `req.user`.
- **Keys** have the format `aeo_<keyId>_<secret>`. The secret has 256 random bits. Only a
  SHA-256 hash of it is stored; lookup is by `keyId`, and the hash comparison uses
  `crypto.timingSafeEqual`. A key is shown once, can expire, can be revoked, and can be
  rotated with an explicit overlap. Keys are accepted only in `Authorization: Bearer`,
  never in a URL, and are never logged.
- **Grants** name a client, an API, a stable route id and an access category (`read`). A
  request needs a valid key, a grant for that exact route, and a live publication that
  declares it. A new route is never added to an existing grant. On republish, a grant
  survives only for routes whose path, handler name and response schema are unchanged;
  otherwise the admin must grant again.

### Request pipeline

- The router is mounted at `/api/exposed`, after CORS, body parsing, logging, the global
  per-IP limiter and metrics, and **before** the global `authenticate`. It answers every
  `/api/exposed/*` request itself and never calls `next()` except with an error, so no
  request falls through to dashboard routes.
- CORS is off for this router and cookies are ignored. GET and HEAD only: any other method
  gets 405.
- Requests with a query string are rejected in the MVP. The router logs the path, never the
  query.
- **Order:** method → size bounds → feature enabled → key (401 for missing or invalid) →
  grant and route (404 when not granted or not found, so a key holder cannot probe for
  APIs it was not given) → publication live (503) → rate limit (429 with `Retry-After`) →
  handler (504 on timeout, 500 on failure).
- In public-demo mode the router is not mounted, and the client-management routes are not
  on the demo allowlist. They use a real-admin guard, because `requireAdmin` lets a demo
  session through on GET.

### Limits

Rate limits are **in memory, per credential and per client**, for the supported topology of
one backend and one SQLite database. The defaults are 60 requests a minute, with a
configurable ceiling, two concurrent requests per client, and four sandbox isolates across
the server. Limits reset when the backend restarts and are not distributed guarantees.

### Network posture

- The supported deployment is a **LAN or VPN** (private network, WireGuard, Tailscale).
  Internet exposure is the operator's own reverse-proxy configuration, documented but not a
  turnkey target.
- Plaintext HTTP is allowed only for a trusted LAN, and only by explicit opt-in on the
  calling side, with a conspicuous warning that the key crosses the network unencrypted. A
  stolen key works until it is revoked, however it is stored. The Aeolus-to-Aeolus connector
  (Phase 5) defaults to HTTPS, never downgrades HTTPS to HTTP, and follows no
  cross-origin redirect.

## Alternatives considered

- **Reuse `fire()` and automation state as the response.** It writes a run record per
  request, suppresses identical concurrent requests, has no response body, and grants the
  full Logic capability set.
- **Reuse the Logic bundle and export handlers from it.** Running it runs the project's
  Logic, and esbuild drops the exports anyway.
- **Declare routes in TypeScript.** Discovering them would mean evaluating author code at
  configuration time. JSON is unambiguously data.
- **Serve the current project source (a mutable pointer).** Any project writer could change
  what an approved client receives.
- **Disable publication on every relevant change.** This is the minimum acceptable
  behaviour. Snapshots give the same guarantee (no unreviewed code runs) without taking a
  working integration down on every edit.
- **Dashboard JWTs, a service-account user, or OAuth for machines.** These either conflate
  humans and machines or add an identity provider Aeolus does not need yet.
- **Embed Kong or a generic reverse proxy.** We borrow its model (service, route, consumer,
  credential, policy), but proxying and a plugin ecosystem are out of scope.
- **HMAC-peppered key hashes.** A 256-bit random secret does not benefit from a pepper, and
  a pepper adds a second secret to back up and rotate. SHA-256 matches the refresh-token
  precedent.
- **Durable SQLite rate counters.** They cost a write per request on a Pi's SD card. The
  supported topology is one process.

## Consequences

- External clients can read only what an admin deliberately published and granted, through
  code an admin approved.
- A project gains a second compiled artifact (the API bundle) and new tables: APIs,
  snapshots, clients, credentials, grants, retired slugs and an append-only audit of
  publication, client, credential and grant changes. The audit is new because Aeolus has no
  admin audit log.
- Republishing is a deliberate admin step after every API source change. That is friction
  by design.
- Rate limits and recent-activity data reset on restart.
- The HTTP surface grows. `docs/security/tokens-and-api.md`, the threat model and the
  public-demo policy must be updated in the same change that mounts the router.
- Handler code that touches a Logic-only global fails at request time with a ReferenceError
  rather than at compile time. The editor will flag known Logic globals in `api/`, but that
  is advisory.

## Revisit when

- A mutating (POST) or device-command endpoint is needed (the plan's Phase 6 is separate
  approval).
- More than one backend serves the same installation, which makes in-memory limits
  insufficient.
- Tab-scoped automations need to publish APIs.
- A key must be usable without a network secret, such as mTLS or signed requests.
- Aeolus is intended to be exposed directly to the internet.

## Implementation anchors (Phase 0)

- `src/project-api/manifest.ts`: manifest schema, path rules, overlap check, matching, response validation
- `src/project-api/api-compiler.ts`: API bundle, import-graph restriction, content hash
- `src/project-api/api-sandbox.ts`: `invokeApiHandler()`, setup script, deadline and limits
- `src/__integration__/project-api-sandbox.integration.test.ts`: real-isolate security and termination proofs
