# ADR-0027: Project APIs — published, read-only HTTP endpoints for Automation Projects

- **Status:** Accepted for Phases 0 to 3 (published, read-only GET endpoints with clients, keys and grants, and the Phase 3 boundary, resilience and performance validation). Phase 3 awaiting review before Phase 4; the script-caching decision waits on Raspberry Pi measurements
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
  that enforces this, so the whole import graph is checked. Nothing under `logic/`, `ui/`
  or `shared/`, no packages, no Node built-ins and no dynamic imports. `lib/` is the explicit
  directory for code shared with Logic. Existing projects keep their `shared/` folder (code
  shared between Logic and UI) unchanged; neither folder has anything to do with Shared
  Automation State. A `lib/` module's top-level code does run, but only inside the API
  sandbox described below. The folder rule is a structure rule, not the security boundary:
  the sandbox is.
- A project declares an API only by having `api/routes.json`. Other files under `api/` in
  a project saved before this feature stay ordinary files and change nothing.

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
  CPU loops after an `await`, and promises that never settle. A caller that disconnects
  before its response is written has its isolate disposed at once rather than at the
  deadline. Responses are capped at 64 KiB, checked inside the isolate before the result
  is copied out and again on the host in UTF-8 bytes, and at most four isolates run at once.
- **Every admitted request gives back its slots.** Everything after rate-limit admission
  runs in one `try`/`finally`, so the per-client concurrency slot and the isolate slot are
  released after a timeout, a thrown error, memory exhaustion, an oversized response, a
  disconnect, or a state reader that fails before the isolate starts.
- A handler returns a JSON value (200) or `api.response(status, body)` with status 400 or
  404. Every other status belongs to the host. A 200 body must satisfy the route's response
  schema, or the caller receives a 500 that does not leak details.
- No `execution_history` row is written and no automation events are emitted. Requests are
  attributed in structured logs (request id, API, route, client, status, duration, reason).
  A bounded in-memory recent-activity list for the Endpoints UI is planned for Phase 4.
- **What a GET cannot do is tested from both sides** (Phase 3). A hostile handler in a real
  isolate tries every escape. Meanwhile the host spies on every method of the state, Shared
  State, Data Store, command, MQTT, automation-event, engine, device and connector classes,
  on the event bus, on Node's network, process and filesystem entry points, and on every
  SQL statement. The only write a request makes is authentication's `last_used_at` stamp,
  at most once a minute per key; that is bookkeeping, not automation state.
- **Compiled-script caching is not used.** Compiling a bundle is a small part of an
  invocation on the development PC; isolate creation dominates, and a code cache cannot
  remove that. Whether it is worth adding is decided on Raspberry Pi measurements
  (`make bench-project-api`). If added, the cache must be keyed by snapshot id and bundle
  hash and hold V8 code-cache data only, never a shared isolate or context, so each request
  still starts from a fresh isolate.

### Publication

- **What is served is an immutable publication snapshot**, not the project's current
  source. A snapshot records:
  - the manifest (endpoint definitions and response schemas);
  - the source of every file in the handlers' transitive import graph;
  - the compiled bundle, with its SHA-256 hash, which is checked before the snapshot is
    served;
  - a content hash over the manifest and those sources;
  - the automation revision it was compiled from, and the API runtime contract version.

  A database trigger rejects any `UPDATE` to a snapshot. Only a real admin can publish, and
  only for an admin-authored (unrestricted) automation in the MVP.
- **A publish is bound to what was reviewed.** The admin submits the content hash they saw,
  and the transaction also checks that the automation's revision has not moved. An edit that
  lands between review and publish therefore gets `409` rather than being published unseen.
- **Code is snapshotted; authority is not.** Every resolve re-checks live facts and fails
  closed if any is false:
  - the automation exists, is enabled and is still admin-authored;
  - the admin who published is still an admin (defence in depth: see the next point);
  - the snapshot's runtime contract matches the server's;
  - the bundle hash matches.

  Client, key and grant state are also read live on every request.
- **Two kinds of "not serving" are deliberately different.**
  - *Temporarily unavailable:* the automation is disabled, or a runtime-contract mismatch
    after an upgrade. The approval and grants are kept, a caller granted the requested
    route gets `503`, and serving resumes when the cause is gone.
  - *Approval withdrawn:* the admin who published is demoted or deleted. This is a durable
    transition, not a live check. In the same transaction as the role change or deletion,
    every publication that admin approved is unpublished and its grants revoked, each with
    an audit record naming the acting admin. Promoting the user back restores nothing; an
    authorised admin must republish and grant again. Snapshots and audit history are kept.
  - `user-service.ts` does this inside `updateUser` and `deleteUser`, which now take the
    acting admin. Database triggers on `users` (migration 022) do the same for any other
    path that changes a user, such as direct SQL or emergency admin recovery. They record
    the actor as `system`, and find nothing to do when the application has already done it.
- **Publishing never revives an old snapshot.** Unpublishing keeps the snapshot as history.
  If the source is later reverted to identical content, nothing is served until an admin
  publishes again, and that publish records a new snapshot by that admin.
- Saving the project never changes what is served, so a tab writer's edit cannot run under
  an existing grant. When the current source's API content hash differs from the published
  snapshot, the Endpoints section shows **unpublished changes**. Serving them requires an
  admin to review and republish. Nothing reactivates silently.
- A publication **fails closed** (503 for a caller granted the requested route) when its automation is
  disabled, when it is no longer admin-authored, when the snapshot's runtime contract no
  longer matches the server's (an Aeolus upgrade that changes the sandbox capabilities),
  or when the snapshot is missing. Deleting the automation deletes its API, snapshots and
  grants, with each grant revocation audited first.
- **Unpublishing revokes every grant to the API** in the same transaction, each audited,
  keeping the grant rows as history. Republishing, even identical source, restores none.
  Keys and clients are untouched, because a client may hold grants to other APIs. The
  management UI must warn that unpublishing withdraws client access and that regranting
  will be needed.
- Snapshots are also the foundation for the planned project versioning and rollback work:
  a snapshot is a compiled, reviewable revision.

### Identity

- Each API has a permanent internal id and an admin-chosen **slug** (`[a-z0-9-]{3,48}`,
  unique), independent of the automation's UUID and name. Renaming the automation or
  editing the project never changes the URL.
- Changing a slug is an explicit admin action. The old slug stops resolving and is
  **retired**, so another project cannot silently take over a URL an integration still
  calls. Retirement is enforced by database triggers on rename and delete, including the
  foreign-key cascade when the automation is deleted.
- An admin can deliberately reuse a retired slug with `reclaim: true`, which is audited.
  That is the supported way to point a known URL at a new API, for example after reseeding
  the showcase.
- The showcase is the documented exception to stable URLs: reseeding deletes and
  recreates its automations, which deletes their APIs, publications and grants, audited as
  `api.deleted` and `grant.revoked`. Reseeding never creates publications or grants, and
  never carries old credentials forward.

### Clients, keys and authorization

- **API clients** are named records managed by real admins in the dashboard. They have no
  login, role, session or refresh token, and never appear in `req.user`.
- **Keys** have the format `aeo_<keyId>_<secret>`. The secret has 256 random bits. Only a
  SHA-256 hash of it is stored; lookup is by `keyId`, and the hash comparison uses
  `crypto.timingSafeEqual`. A key is shown once, can expire, can be revoked, and can be
  rotated. Keys are accepted only in `Authorization: Bearer`, never in a URL, and are
  never logged.
- **Rotation chooses two lifetimes separately.** The admin chooses the replacement key's
  expiry explicitly (a time, or none); it is never inherited from the old key, so rotating
  a key that is about to expire never issues one that is about to expire too. The overlap
  is how long the old key keeps working: `0` revokes it at once, otherwise it expires
  after the overlap (at most a week, and never later than its own expiry). Both are
  audited.
- **Grants** name a client, an API, a stable route id and an access category (`read`). A
  request needs a valid key, a grant for that exact route, and a live publication that
  declares it. A new route is never added to an existing grant. On republish, a grant
  survives only for routes whose method, path, handler name and response schema are
  unchanged (the route fingerprint); otherwise it is revoked as `route-changed` and the
  admin must grant again. A reclaimed slug inherits nothing: grants, keys and
  publications belong to API ids, not slugs, and the slug response reports the previous
  API id.
- **Revocation applies to new requests.** Revoking a key or grant, disabling a client or
  unpublishing refuses the next request. A request that was already authorised and is
  running is allowed to finish, which takes at most the 5 s handler deadline. For read-only
  GET handlers this is intended, and it is tested.

### Request pipeline

- The router is mounted at `/api/exposed`, after CORS, body parsing, logging, the global
  per-IP limiter and metrics, and **before** the global `authenticate`. It answers every
  `/api/exposed/*` request itself and never calls `next()` except with an error, so no
  request falls through to dashboard routes.
- CORS is off for this router and cookies are ignored. GET and HEAD only. Any other method,
  including OPTIONS, gets the same `405` for every path under `/api/exposed`, before the key
  or route is looked at, so the response never depends on whether a route exists. There is
  no `Allow` header listing routes, and no CORS preflight approval.
- **Error bodies are uniform.** `401` for a missing, malformed, unknown, wrong, expired or
  revoked key, all with the same body. `404` for an unknown slug, a retired slug, an unknown
  route or an ungranted route, all with the same body. Only a caller granted the route sees
  its endpoint-specific errors. Generated documentation is admin-only.
- Requests with a query string are rejected in the MVP. The router logs the path, never the
  query, and credentials anywhere in a URL are refused globally (`url-credential-guard.ts`,
  on `main` in `a083caa`). Future query parameters must be declared per route in the
  manifest, validated and documented; arbitrary query input will never reach handlers.
- **Order:** method → size bounds → feature enabled → key (401 for missing or invalid) →
  grant for the exact route (404 when the slug, route or grant is missing) → publication
  live (503) → rate limit (429 with `Retry-After`) → handler (504 on timeout, 500 on
  failure).
- **Only a granted route can answer `503`.** The grant is checked against the published
  snapshot's routes before the publication's health is revealed, so a client granted one
  route gets `404` for every other route whether the API is serving, disabled, has lost
  authority or fails its integrity check. If the stored manifest no longer parses, no
  route can be identified and every caller gets `404`.
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
  (Phase 5) defaults to HTTPS, never downgrades HTTPS to HTTP, never disables certificate
  verification, and follows no cross-origin redirect.
- **Optional server-side enforcement: `EXPOSED_API_REQUIRE_HTTPS`** (off by default for
  LAN use). When on, a request is served only if Express establishes that the transport is
  HTTPS (`req.secure`), and is refused otherwise.
  - `req.secure` is true for a direct TLS connection, or when `X-Forwarded-Proto: https`
    arrives through a proxy hop that `TRUST_PROXY_HOPS` explicitly trusts.
  - With no trusted proxy configured, a client-supplied `X-Forwarded-Proto` is ignored.
  - Security is never inferred from the caller's IP address.
  - The documentation will say that the proxy must overwrite forwarded protocol headers,
    and that the backend port must not be reachable except through it.
- The management UI warns whenever bearer keys would be used over plaintext HTTP.

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
  snapshots, retired slugs and an audit log (Phase 1, migration 021), then clients,
  credentials and grants (Phase 2). The audit log is new because Aeolus has no admin audit
  log.
  - Every publication, client, credential and grant change writes its audit record **in
    the same transaction**, so a change whose record cannot be written does not happen.
  - Each record holds the acting admin, the operation, the targets, the old and new
    content hashes, a correlation id (the request's `X-Aeolus-Mutation-Id`, or a generated
    one) and structured metadata. It never holds keys or source.
  - The history is **append-only at the application level**. No route updates or deletes
    it, and triggers reject `UPDATE` and `DELETE`. It is not tamper-proof against someone
    with write access to the SQLite file.
  - Per-request API metrics stay separate from this administrative history.
- The editor works out whether the source has changed since publication on demand, by
  compiling the current source and comparing content hashes. The project save path is
  unchanged apart from validating `api/routes.json`.
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

## Implementation anchors

- `src/project-api/manifest.ts`: manifest schema, path rules, overlap check, matching, response validation
- `src/project-api/api-compiler.ts`: API bundle, import-graph restriction, content hash
- `src/project-api/api-sandbox.ts`: `invokeApiHandler()`, setup script, deadline and limits
- `src/__integration__/project-api-sandbox.integration.test.ts`: real-isolate security and termination proofs
- `src/project-api/publication-store.ts`: slugs, snapshots, live fail-closed resolution, audit
- `src/db/migrations/021-project-api-publications.ts`: tables and the immutability, append-only and slug-retirement triggers
- `src/api/routes/project-api.routes.ts`: admin-only publication management and audit read
- `src/__integration__/project-api-publication.integration.test.ts`: edits during an active request, restart, disable
- `src/db/migrations/022-project-api-access.ts`: clients, keys, grants, and the publisher demotion and deletion triggers
- `src/project-api/access-store.ts`, `api-keys.ts`, `audit.ts`: clients, keys, grants and the shared audit writer
- `src/project-api/exposed-router.ts`, `request-limits.ts`: the `/api/exposed` router and in-memory limits
- `src/auth/user-service.ts`: withdraws a demoted or deleted admin's publications in the same transaction
- `src/__integration__/project-api-exposed.integration.test.ts`: the router end to end
- `src/__integration__/project-api-boundary.integration.test.ts`: a hostile GET against host-side spies
- `src/__integration__/project-api-resilience.integration.test.ts`: failures, concurrency, disconnects and restart, with slot release
- `scripts/bench/project-api-bench.ts`, `make bench-project-api`: latency, CPU and memory measurement
- `docs/reference/project-apis.md`: author and operator reference
