# Project APIs: implementation plan

**Status:** Phases 0 to 3 complete and approved on `main`; Phase 4 in progress.
Outstanding release validation: Raspberry Pi measurements (see
[Release validation](#release-validation)). Script caching stays disabled until they exist.
**Decision record:** [ADR-0027](../adr/0027-project-apis.md). This plan is the
implementation detail behind it, and replaces the original "Aeolus Project APIs —
Implementation Specification" (reviewed against `f0cf75d`).

## Ground rules

- Each phase is committed to `main` once it passes every gate, then stops for review before
  the next phase starts. Unfinished work stays local. (Phases 0 and 1 were developed on
  `feat/project-apis` and fast-forwarded into `main` at `414c1e8`; the branch is deleted.)
- The existing gates all pass: `tsc` (root, e2e, frontend), ESLint, backend and frontend
  coverage suites, project compiler and migration tests, and the real-isolate sandbox
  tests. **A skipped isolate test is not a passing security check.**
- No new runtime dependencies. Validation uses Zod 4 (already installed, including
  `fromJSONSchema`/`toJSONSchema`). Compilation uses esbuild. The sandbox uses isolated-vm.
- Types follow the data: `unknown` at untrusted inputs, Zod-inferred types after
  validation, and no `any` or cast that pretends to validate.
- The rules below do not change: existing projects behave exactly as before, the dashboard
  is unchanged, command evidence is retained indefinitely, the authored outbound HTTP
  policy (ADR-0020) is untouched, and the public-demo boundary (ADR-0023) still fails
  closed.

## Corrections to the original specification

| Original assumption | Actual code | Consequence |
|---|---|---|
| Handlers can come from the project's compiled Logic | The Logic entry always calls `automation()`, and esbuild removes unimported named exports | Separate API bundle with a generated entry (done in Phase 0) |
| Restrict capabilities by passing fewer references to the sandbox | The Logic bootstrap reads device, MQTT, HTTP and state references without checking they exist | Dedicated API setup script (done in Phase 0) |
| The sandbox's 5 s timeout bounds handlers | It bounds synchronous code only | Host wall-clock deadline plus `dispose()` (done in Phase 0) |
| A request can use `fire()` | One run record per request, duplicate suppression, shared execution slots | `invokeApiHandler()`, outside the engine |
| "Persisted with project revisions" | One counter on `automation_rules`, no history; toggling doesn't bump it | Immutable publication snapshots carry their own revision |
| `apiEntry` can be added to the project payload | Zod strips unknown keys, so the field would be silently dropped | Schema change in Phase 1. The API is found by convention (`api/routes.json`), so no new entry field is needed |
| The public-demo guard covers new routes | It only inspects demo sessions | Explicit `config.publicDemo.enabled` check: the router is not mounted |
| Reuse audit logging and log redaction | Neither exists. The request logger records query strings | New audit table; the router rejects query strings and logs the path only |
| Automation ids work as API identity | Random UUIDs, recreated on every reseed | Permanent API id plus an admin-chosen slug |
| Only admins edit projects | Tab writers can edit any automation exposed on their tab | Snapshots: edits never change what is served |
| Ownership survives layout saves | Every layout save nulled `owner_tab_id` | Fixed on `main` in `1430c87`, with regression tests |
| An automation's `http.get` can reach another Aeolus | The outbound policy blocks RFC 1918, 100.64/10 (Tailscale) and ULA addresses | Phase 5 uses a dedicated connector |
| Connector secrets are protected | Plain JSON in SQLite, masked only in API responses | Secrets stay out of logs, exports and responses; encryption at rest is a separate ADR |
| The editor has room for an "API" section | "API" is already the API-reference panel | The new section is called **Endpoints** |

## Phase 0: design validation and sandbox proof (complete)

**Delivered**
- `src/project-api/manifest.ts`:
  - Manifest schema: version 1, at most 16 routes, GET only, strict keys.
  - Route ids and handler names, with reserved names (`default`, `__proto__`, `then`…) refused.
  - Path grammar and overlap detection.
  - The response-schema subset, with size and depth caps.
  - Request-path matching: literals compared raw, parameters decoded once, with encoded `/` or `\`, dot segments, control characters and values over 128 bytes refused.
  - A response validator built with `z.fromJSONSchema`.
- `src/project-api/api-compiler.ts`:
  - Builds the API bundle from a generated entry that names each handler.
  - Restricts imports to `api/` and `lib/` across the whole graph, and to `.ts`/`.js`/`.json`.
  - No packages, URLs or dynamic package imports.
  - Strict mode, and a content hash of the manifest plus bundle.
- `src/project-api/api-sandbox.ts`, `invokeApiHandler()`:
  - A fresh isolate with a read-only state view and the frozen `state` and `api` globals.
  - Values cross the boundary as copies only.
  - Statuses 200/400/404; a missing handler, an invalid body, a body over 64 KiB, a thrown error and memory exhaustion are each classified.
  - A host deadline that disposes the isolate, and a cap on concurrent isolates.
- Tests:
  - 51 manifest and 18 compiler unit tests.
  - 26 real-isolate tests, all of which ran here on Windows; none were skipped.
- This plan and ADR-0027.

**What the proof established** (all by tests in
`src/__integration__/project-api-sandbox.integration.test.ts` and `src/project-api/*.test.ts`)
1. Compilation runs no author code: a top-level `throw` in a handler compiles. Imports
   outside `api/` and `lib/` are refused with file and line, including one made by a `lib/`
   file on behalf of `api/`.
2. A response-bearing handler returns plain JSON to the host, synchronously or async, with
   `api.response(404)` for "not found".
3. The isolate has no automation, device, network, storage or host capability, and no raw
   bridge reference. State is read-only, frozen and copied, so mutating a returned value
   does not touch the host. The request is frozen. Author code cannot replace `state` or
   the invoker.
4. Errors propagate as classified results. A `__proto__` key returns as plain data and
   never pollutes host prototypes. Unserializable, cyclic and `undefined` bodies are
   refused.
5. The host ends, within deadline + 300 ms, a synchronous top-level loop, a synchronous
   handler loop, **a CPU loop after an `await`** (while the host event loop keeps running)
   and a promise that never settles. Memory exhaustion is classified `memory`. The
   concurrency cap returns `busy` and frees its slot. Each request starts from a fresh
   isolate, so nothing leaks between requests.
6. An end-to-end local GET built from these pieces returns 200 with a schema-valid body,
   404 from the handler for an unknown id, and 404 for an encoded slash or unknown path.
   The project's Logic is not in the API bundle, so requests cannot run it.

**Measured:** median 1.8 ms and p90 2.2 ms per request on the development PC (Windows,
Node 24.14), including isolate creation, script compilation and invocation. Phase 3 adds a
benchmark for the full HTTP path; see its performance section.

**Phase 0 is not:** wired into project compilation, routing, storage or the UI. Nothing in
it is reachable at runtime.

## Phase 1: compilation, snapshots, storage and audit (complete)

**Delivered**
- **Compilation.** `compileAutomationProject()` compiles the API whenever `api/routes.json`
  exists and returns it as `api`. Every save therefore reports manifest and import errors in
  the editor's existing `details` shape. Projects without a manifest compile exactly as
  before, including ones with other files under `api/`.
  - The compile error class moved to `src/automations/project-compile-error.ts`, and is
    re-exported from its old module, to avoid an import cycle.
- **The API compile records its whole transitive import graph**:
  - `sources`: the manifest plus every file esbuild loaded;
  - `contentHash`: over those sources, so an esbuild upgrade does not count as a code
    change;
  - `bundleHash`.
- **Migration 021:**
  - `project_apis`, `project_api_snapshots`, `project_api_retired_slugs` and
    `project_api_audit`;
  - triggers that make snapshots immutable, make the audit append-only, retire a slug on
    rename or delete (including the foreign-key cascade), and refuse a retired slug unless
    it is reclaimed.
- **`src/project-api/publication-store.ts`:**
  - `setSlug`, with explicit, audited `reclaim`;
  - `publish`, bound to the reviewed content hash and automation revision;
  - `unpublish` and `deleteForAutomation`;
  - `resolve`, which checks every live fact on every call;
  - `listAudit`, keyset-paged, and `storageStats`.

  Each mutation writes its audit record in the same transaction.
- **`/api/project-apis` management routes:**
  - GET status, PUT slug, POST publish and POST unpublish;
  - GET audit, with `limit`/`before`/`apiId` and storage use.

  A real admin is required, which refuses public-demo sessions even on GET. Nothing under
  `/api/project-apis` or `/api/exposed` is on the demo allowlist, which is asserted by a test.
- **Automation delete** removes the API (snapshots cascade, slug retired), audited with the
  deleting user, in the same transaction as the rule delete.
- **Docs:** this plan, ADR-0027, `reference/api.md` and `architecture/AUTOMATION_PROJECTS.md`
  (`api/`, `lib/` and `shared/`, and how they differ from Shared Automation State).

**On `main`, separately:** `a083caa`. Request logs record the path only. Credentials in
query strings are refused with 400. API keys and JWTs pasted into a path are masked in logs
and metrics labels.

**Departures from the plan as previously written** (none changes an approved decision)
1. **Publication management routes moved from Phase 2 to Phase 1.** Publishing, slugs and
   the admin audit read interface need them. Clients, keys, grants and the `/api/exposed`
   router stay in Phase 2.
2. **No `current_content_hash` column.** Whether the source has changed since publication
   is worked out on demand by compiling the current source in the admin status route. The
   project save path is unchanged apart from validating `api/routes.json`.
3. **`api/handlers.ts` without a manifest is not an error.** Only the manifest declares an
   API, so a project saved before this feature cannot start failing.
4. **The publisher must still be an admin.** This is how the decision "do not snapshot an
   administrator's permissions" is implemented: a demoted or deleted publisher stops the API
   until another admin republishes it.
5. **Retired slugs can be reclaimed explicitly** (`reclaim: true`, audited), so a showcase
   reseed or a deliberate migration can point a known URL at a new API.

**Requested Phase 1 tests**

| Requested | Where | Status |
|---|---|---|
| Editing published code while requests are active | `project-api-publication.integration.test.ts` | Done: an in-flight request and later requests run the snapshot; the new code runs only after a republish |
| Restarting Aeolus with an existing snapshot | same file (SQLite file reopened) | Done: same snapshot served; unpublished state also survives restart |
| Disabling and revoking access while an old snapshot exists | store tests and integration | Disable, unpublish, lost authority, demoted or deleted publisher, contract mismatch and bundle tampering all fail closed. **Key revocation needs Phase 2 keys** |
| Accessing an ungranted endpoint | — | **Phase 2** (needs keys, grants and the router) |
| Forged HTTPS forwarding headers | — | **Phase 2** (`EXPOSED_API_REQUIRE_HTTPS` is part of the router) |
| Credentials in query strings | `request-logger.test.ts` on `main` | Done for logging and global refusal. The exposed-router case is **Phase 2** |
| Invalid transitive imports | compiler tests; management route test | Done: `lib/` importing `logic/` is refused with file and line, and cannot be published |
| Failed transaction involving audit records | store tests | Done for create slug, rename, publish, unpublish and automation delete: no change when the audit insert fails |
| Reverting source without reactivating historical grants | store tests | Done for publications: identical reverted content stays unpublished, and republishing creates a new snapshot. **Grant behaviour is Phase 2**, where grants will be revoked on unpublish so none can be reactivated |

## Phase 2: clients, keys, grants and the request pipeline (complete)

**Delivered**
- **Durable publisher withdrawal.** Demoting or deleting the admin who published
  unpublishes their APIs and revokes those grants in the same transaction as the user
  change, audited against the acting admin. Promoting them back restores nothing. Triggers
  on `users` (migration 022) cover every other path. The live publisher check in `resolve()`
  stays as defence in depth.
- **Migration 022:** `api_clients`, `api_credentials` and `api_grants`. Grant rows are
  kept after revocation, with who, when and why.
- **Stores:**
  - `access-store.ts`: clients, keys (issue, rotate with overlap, revoke) and grants, each
    audited in its transaction.
  - `api-keys.ts`: key format, SHA-256 and constant-time comparison.
  - `audit.ts`: the shared audit writer and route fingerprints.
- **Grant lifecycle:**
  - unpublish revokes all of an API's grants;
  - republish revokes grants whose route fingerprint changed;
  - automation delete revokes before the cascade;
  - disable and runtime-contract mismatch revoke nothing.
- **`/api/exposed` router** (`exposed-router.ts`), mounted before `authenticate`:
  - terminal, with CORS skipped for its prefix;
  - a uniform 405, 401 and 404, each with one fixed body;
  - `EXPOSED_API_REQUIRE_HTTPS` through `req.secure`;
  - in-memory per-key and per-client rate and concurrency limits;
  - the snapshot executed in the API sandbox, with the 200 body checked against its schema;
  - a fixed 404 for everything in public-demo mode.
- **Metrics** label all exposed traffic `/api/exposed/:slug/:route`, from the full original
  path.
- **Management routes** for clients, keys and grants. `unpublish` returns `revokedGrants`,
  and a reclaimed slug reports `reclaimedFrom`. The status route caches compiles by
  revision and source hash.
- **Configuration:** `EXPOSED_API_REQUIRE_HTTPS`, `EXPOSED_API_REQUESTS_PER_MINUTE` and
  `EXPOSED_API_CONCURRENT_PER_CLIENT` in `config.ts`, `docker-compose.yml`, `.env.example`
  and `reference/operations.md`.
- **Docs:** the new `reference/project-apis.md`; `reference/api.md`;
  `security/tokens-and-api.md`, which separates dashboard clients from API keys; and
  ADR-0027.

**Departures**
1. **Handler execution, response validation and limits landed in Phase 2**, because your
   Phase 2 requirements include "every request executes the immutable approved snapshot"
   and an in-flight revocation test. Phase 3 shrinks to what is listed there.
2. **A withdrawn approval also revokes that API's grants.** It is treated as an unpublish,
   so the rule "no publication, no grants" has no exception, and a republish by another
   admin needs regranting.
3. **A granted caller sees `503` for an unavailable API. A caller with no grant to it sees
   `404`**, so an API's state is visible only to its grantees. Phase 3 narrowed this to the
   route: only a route the caller is granted can answer `503`.

**Requested tests**

| Requested | Where |
|---|---|
| Demote then promote with no request in between | `user-service.project-api.test.ts`, `publication-store.test.ts` |
| Uniform 401 (12 kinds of bad credential) | `project-api-exposed.integration.test.ts` |
| Indistinguishable 404, including other projects' APIs | same |
| No enumeration through OPTIONS or method errors | same: one 405 body for all methods and paths, with no CORS approval |
| Revocation during an in-flight request | same: the running request finishes, the next is refused |
| Key, grant, client and unpublish revocation on the next request | same |
| Unpublish revokes grants for good, keys keep working elsewhere | same |
| Forged `X-Forwarded-Proto` | same: refused without a trusted proxy, accepted only from a trusted hop |
| Keys in URLs, logs or metrics | same, plus `request-logger.test.ts` |
| Public-demo mode | same, plus `demo-policy.test.ts` |
| Machine key on a management route | `project-api.access.routes.test.ts` (real `authenticate`) |
| Reclaimed slug inherits nothing | integration and route tests |
| Transactional audit | store tests: every mutation rolls back when its audit insert fails |

### Phase 2 design notes kept from the plan


**Migration 022**
- `api_clients`: `id`, `name`, `status` (`active` | `disabled`), `created_by`, timestamps.
- `api_credentials`
  - `id`, `client_id`, `key_id` UNIQUE, `secret_hash` (SHA-256)
  - `last4`, `expires_at`, `revoked_at`
  - `last_used_at`, updated at most once a minute
- `api_grants`
  - `client_id`, `api_id`, `route_id`
  - a `route_fingerprint` (path, handler and response schema hash)
  - `access` (`read`), `granted_by`, `granted_at`
  - Unique on (`client_id`, `api_id`, `route_id`).
- Client, credential and grant changes are audited in `project_api_audit` (from
  migration 021), in the same transaction. No secret material is ever written there.

**Management API** (added to `/api/project-apis`, same real-admin guard)
- Create and disable clients.
- Issue, rotate (with an explicit overlap) and revoke keys.
- Grant and revoke routes.
- Read recent activity.
- A key is returned once, from issue or rotate. Machine keys are refused on every
  management route.

**`/api/exposed/v1/:slug/*` router**, mounted before `authenticate` in `src/index.ts`
- Terminal: it never falls through to dashboard routes.
- CORS off and cookies ignored. Query strings are rejected.
- A uniform `405` for any non-GET/HEAD method (OPTIONS included), before any lookup.
- Request URL and header bounds.
- Not mounted in public-demo mode.
- Pipeline order and uniform error bodies as in ADR-0027.
- `EXPOSED_API_REQUIRE_HTTPS`: when on, a request is served only if `req.secure` is true,
  meaning direct TLS or `X-Forwarded-Proto` from a hop trusted through `TRUST_PROXY_HOPS`.
- Responses carry `X-Request-Id`, `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.
- Metrics label the route as `/api/exposed/:slug/:route`.

**Grant rules**
- Credentials, revocation, client status and grants are always read live, never from a
  snapshot.
- On republish, a grant survives only for routes whose fingerprint is unchanged.
- On unpublish, all grants for the API are revoked, so a later publish (including one of
  reverted source) never reactivates old access.

**Negative security tests** (all required)
- No key, a malformed key, an unknown key id or a wrong secret gets the same `401` and
  body. So do an expired key, a revoked key and a disabled client. None of them reaches
  the sandbox.
- Revoking a key, disabling a client or revoking a grant takes effect on the next request
  while the old snapshot is still published.
- A key in the query string, a dashboard JWT, a refresh cookie and a demo session are all
  refused.
- A valid key reaching an ungranted route, an unknown slug, a retired slug, a removed route
  or **another project's API** gets the same `404` and body as a route that doesn't exist.
- A new route on a republished snapshot is not callable under the old grant. Unpublishing,
  reverting the source and republishing restores no grant.
- An API key on any `/api/...` management or dashboard route gets `401`. A request with a
  valid JWT to `/api/exposed/*` doesn't fall through.
- POST, PUT, DELETE, PATCH and OPTIONS get the same `405` for existing and non-existent
  paths, and OPTIONS gets no CORS approval.
- With `EXPOSED_API_REQUIRE_HTTPS` on, a forged `X-Forwarded-Proto: https` is refused when
  no proxy is trusted, and when it arrives from an untrusted hop.
- `{ "role": "admin" }` or `__proto__` in headers or the path changes nothing.
- An oversized URL or headers are refused.
- No key material appears in logs, the admin log buffer, metrics, audit rows or error
  bodies (asserted by capturing log output).

## Phase 3: validation and hardening (complete)

Phase 2 already executes snapshots, maps statuses and enforces limits (departure 1), so
Phase 3 validates and hardens what exists. No new capability was added.

**Refinements from the Phase 2 review**
- **A. Only a granted route can answer `503`.** The router used to check that the client
  held *any* grant to the API, then the API's health, then the route grant, so a client
  granted one route got `503` on its ungranted routes while the API was unavailable. Now
  `resolve()` returns the API record and the snapshot's routes for an unavailable
  publication as well, and the router settles the exact route grant first. Ungranted
  routes are `404` whether the API is serving, disabled, has lost authority, has a
  publisher who is no longer an admin, mismatches the runtime contract or fails its
  integrity check. A stored manifest that no longer parses identifies no route, so every
  caller gets `404`. `hasAnyGrant` was removed.
- **B. Rotation chooses the new key's expiry explicitly.** `rotateKey` copied the old key's
  `expires_at` onto the replacement, so rotating a key about to expire issued one about to
  expire too, and the overlap was the only lifetime the admin chose. Now the rotate body
  requires `expiresAt` (a future timestamp, or `null`) for the new key, and `overlapSeconds`
  only sets how long the old key keeps working. Both values are audited (`key.rotated`
  and `key.expiring` metadata).

**Hardening found while testing**
- **A slot leak, fixed.** If the state reader threw before the isolate started, the
  rejection escaped before `.finally()` was attached in the same chain, and the client's
  concurrency slot stayed taken. Everything after admission now runs in one
  `try`/`finally`.
- **The limiter's pruning was quadratic when full.** Once 10,000 windows were tracked and
  none had expired, every new key rescanned the whole map. It now scans at most once a
  minute. Only authenticated keys reach the limiter (at most 200 clients with 10 keys
  each), so this was found by its unit test timing out under coverage, not in use.
- **Disconnects end the isolate.** When the response closes before it is written, an
  `AbortSignal` disposes the isolate at once instead of letting it run to the 5 s deadline.
  The request is logged as `client-disconnected`.
- **Oversized results are prechecked inside the isolate.** A result longer than the limit
  in UTF-16 code units is refused before it is copied out. That is not a byte count: the
  64 KiB limit is the exact UTF-8 byte count the host checks afterwards, which catches a
  multibyte string that passed the precheck. Tests cover two-, three- and four-byte
  characters, a multibyte body just under the limit, and an ASCII body at exactly the
  limit and one byte over (`project-api-sandbox.integration.test.ts`).
- **Isolate construction is inside the slot's `try`/`finally`** (after the Phase 3 review).
  The slot used to be taken before `new Isolate()`, outside the cleanup, so a constructor
  that threw would have held it for good. A constructor failure now frees the slot and
  reports the sandbox `unavailable` (`api-sandbox.construction.test.ts`, with a stubbed
  `isolated-vm` whose constructor throws).
- **Host handles are released explicitly.** References, the context, its global and the
  compiled scripts are released with the request rather than left to the host's garbage
  collector. On the development PC this halved RSS growth over 150,000 four-way invocations
  (75 to 264 MB before, 75 to 157 MB after), with the JS heap flat at 10 to 11 MB both
  times. A bare `isolated-vm` create, compile, run and dispose loop with no Aeolus code grows
  at the same remaining rate (39 to 119 MB over 150,000), so what is left is native
  allocator retention in V8 or `isolated-vm`, not a leak in this code. The benchmark's soak
  step measures it on the Pi.

**Security boundary** (`project-api-boundary.integration.test.ts`). A hostile handler runs
in a real isolate through the router and the `automationStateReader` that `src/index.ts`
uses, while the host is watched:

| A Project API GET cannot | Evidence |
|---|---|
| Modify Automation State or Shared State | No set or delete exists; `defineProperty` and assignment on `state` throw; a mutated copy leaves the stored value unchanged; spies on every method of `AutomationStateStore` (except `get`/`getAll`), `SharedStateStore` and `DataStore` record no call; a fingerprint of every table is unchanged |
| Publish MQTT or an automation event | Every method of `MqttService` and `AutomationEventService` is spied, and `eventBus.emit` records nothing |
| Dispatch a device command or bypass `CommandService` | Every method of `CommandService`, `DeviceRegistry`, `ConnectorRegistry`, `CommandHistoryStore`, `AutomationEngine`, `Sandbox` and `ExecutionLog` is spied and none is called; no SQL other than authentication's runs |
| Make an outbound HTTP request | `fetch`, `http`/`https` `request` and `get`, `net`, `tls`, `dgram` and `dns` are spied; the test's own connection is the only network activity. Inside, `fetch`, `XMLHttpRequest`, `WebSocket` and dynamic `import()` of a URL are absent or refused |
| Read another automation's private state | The reader is bound to the owning automation id on the host; path-like, prefixed and prototype keys all return nothing; only that automation id is ever read; the other automation's value never appears in the response |
| Reach Node.js, the filesystem or the environment | `process`, `require`, `module`, `Buffer` and timers are absent, including through `Function` and constructor chains; `import("node:fs")` is refused; `fs` and `child_process` entry points record no call; a file canary and an environment canary never appear |

The only SQL write during a request is authentication's `last_used_at` stamp, and the table
fingerprint excludes that column alone. Prototype pollution inside the isolate does not
reach the host.

**Runtime resilience** (`project-api-resilience.integration.test.ts`). After every test, no
client slot and no isolate is still held.

| Case | Result |
|---|---|
| Synchronous loop, CPU loop after `await`, promise that never settles | `504` within the deadline plus 600 ms; the host event loop keeps ticking; other requests are served meanwhile |
| Thrown `Error`, thrown string, rejection after `await`, stack overflow | The same `500` body, with no message, stack or detail |
| Oversized response, long in characters or only in UTF-8 bytes | `500`, refused as `too-large` |
| Memory exhaustion (16 MB isolate) | `500`; the next request is served normally |
| State reader failing before the isolate starts, or inside it | `500`, and with one slot per client the next request is not `429` |
| A mixed run of failures at one concurrent slot | Every slot comes back; the last request is `200` |
| Eight concurrent requests | Each gets its own isolate and its own answer |
| Over the server-wide isolate cap / the per-client cap | `503` with `Retry-After: 1` / `429`; both free up afterwards |
| Caller disconnects during a CPU loop or a pending promise | The isolate is disposed within a second rather than at the 5 s deadline, and the slots are released |
| Restart | The same snapshot, grants and keys are served from the file database; rate windows start again; a request in flight when the listener closes ends its isolate and leaves nothing persisted; a revocation made before the restart still holds |

**Performance.** `scripts/bench/project-api-bench.ts` (`make bench-project-api`; see
`scripts/bench/README.md`) runs the real router, stores and sandbox over HTTP against a
WAL SQLite file holding about 9 KB of persisted automation state. Both handlers read it:
`tank` reads one key, `summary` reads all of them. The server runs in its own process.

Measured on the development PC only: AMD Ryzen 7 9700X (8 cores, 16 threads), 32 GB,
Windows 11 (10.0.26300), Node 24.14.0, `isolated-vm` 6.2.0, NVMe. Medians move by about a
millisecond between runs on this machine; these are from one run.

| Measure | p50 | p95 | Other |
|---|---|---|---|
| Cold: first request after start, client side (5 fresh processes) | 25.8 ms | 27.8 ms | server's own timing 20 ms; second request 6.8 ms; start-up 404 ms |
| Warm `tank`, sequential (300) | 3.6 ms | 4.6 ms | p99 5.5 ms; 99 % of one core; RSS 92 MB |
| Warm `summary`, sequential (300) | 3.7 ms | 5.8 ms | p99 7.7 ms; RSS 95 MB |
| 1 caller, 10 s | 3.3 ms | 4.6 ms | 285 req/s; 93 % CPU; RSS 115 MB |
| 2 callers | 5.2 ms | 7.2 ms | 368 req/s; 121 % CPU; RSS 125 MB |
| 4 callers (at the cap of 4 isolates) | 9.9 ms | 14.5 ms | 391 req/s; 132 % CPU; RSS 136 MB |
| 8 callers (twice the cap) | 22.6 ms | 32.1 ms | 184 req/s served, 1,451 req/s refused with `503`; RSS 143 MB |
| Idle RSS after GC, before and after load | | | 87 MB, then 144 MB; soak of 10,000 more requests: 137, 139, 118, 116, 120 MB |

CPU is the server process's user and system time over wall time; 100 % is one core. Event
loop delay p99 stayed between 12 and 19 ms throughout.

**Script caching: not added.** Splitting one invocation on the PC (p50, 100 iterations):
isolate and context creation 1.46 ms, compiling the 1 KB bundle 0.14 ms (0.08 ms from a V8
code cache), running it 0.04 ms, the full invocation 2.97 ms. A cache would save about
0.06 ms, or 2 %. For a 44 KB bundle it would save about 0.46 ms of 0.65 ms. Isolate
creation dominates, and a code cache cannot remove it. So caching is decided on the Pi
numbers: it is worth adding only if `compile` minus `compileFromCache` is a material share,
say a fifth, of `fullInvocation` there. If it is added, it is keyed by snapshot id and
bundle hash, holds V8 code-cache data only, and never shares an isolate or context between
requests.

The Raspberry Pi run is deferred to [release validation](#release-validation); it does not
block Phase 4.

**Compatibility.** Nothing outside `src/project-api`, its routes and `src/index.ts` (one
line: the shared `automationStateReader`) changed. The full backend and frontend suites
cover the automation engine, MQTT processing, command evidence, dashboard authentication
and public-demo policy unchanged.

**Tests added in Phase 3**

| Requested | Where |
|---|---|
| Ungranted route stays `404` while the API is disabled, has lost authority, has a contract mismatch or fails integrity; granted route `503` | `project-api-exposed.integration.test.ts` |
| Unparseable stored manifest gives `404` | same |
| Rotation: explicit new expiry, separate overlap, both audited, past expiry refused | `access.unit.test.ts`, `project-api.access.routes.test.ts` |
| A GET cannot reach state, events, MQTT, commands, network, Node.js, filesystem or environment | `project-api-boundary.integration.test.ts` |
| Loops, unresolved promises, exceptions, oversized responses, memory, concurrency, disconnects, restart, slot release | `project-api-resilience.integration.test.ts` |
| An isolate constructor that throws releases its slot | `api-sandbox.construction.test.ts` |
| The response limit is UTF-8 bytes, not string length | `project-api-sandbox.integration.test.ts` |

## Phase 4: OpenAPI, Endpoints UI and documentation

- An OpenAPI 3.1 document is generated from the **published snapshot** (paths, parameters,
  response schemas via `z.toJSONSchema`, bearer auth, the error responses, and
  `operationId` taken from the route id). It is admin-only to download and validated in
  tests with a standard OpenAPI parser, added as a dev dependency only.
- **Endpoints** section in the Automation Project editor: a new component covered by the
  frontend gate. It keeps separate panels for:
  - declared routes and compile errors
  - publication status, slug, effective URL, and the published-versus-current difference
    with a Publish button
  - API clients and their grants
  - credentials (key id, last four characters, expiry, last used), issued with a one-time
    reveal and copy
  - recent activity

  Non-admins see it read-only; the server enforces this regardless. Read-only in public
  demo. A curl example uses a placeholder key.
- **Documentation**
  - `docs/reference/api.md`
  - a new `docs/reference/project-apis.md` covering the author guide, statuses and limits
  - `docs/security/tokens-and-api.md`, which currently defines API clients as JWT holders
    and has a stale public-route table
  - the threat model
  - operations: LAN/VPN, a reverse-proxy example, backups, and key rotation and revocation
  - the CHANGELOG
- **Acceptance**
  - The OpenAPI document validates.
  - The documentation matches the published snapshot.
  - The demo build cannot publish or create clients.
  - Disabling publication takes effect on the next request.

## Phase 5: Aeolus-to-Aeolus connector

- A bundled connector, `src/connectors/aeolus-remote/`, registered in `src/index.ts`. Each
  instance has:
  - a base URL
  - an API key (a `password` field)
  - the endpoint path
  - a poll interval within bounds
  - a maximum response size
  - an explicit **Allow plaintext HTTP on a trusted LAN** flag
- **Transport** (its own; ADR-0020's authored-HTTP policy is untouched)
  - Only the configured host, so private and VPN addresses are allowed for that host alone.
  - HTTPS by default. HTTP only with the flag, which shows a warning in the UI and in the
    log once per connection.
  - An HTTPS URL is never downgraded, and there are no cross-origin redirects (at most two
    same-origin ones).
  - Response size cap, total timeout, and an explicit per-request connection-attempt
    timeout.
- **Device:** one read-only device per instance whose state is `{ data, sourceTime,
  fetchedAt, stale, httpStatus, error }`. It is always returned, so a failed poll marks
  the data stale instead of leaving it looking current. Health follows the last fetch.
- **The dual-stack connection issue is investigated on its own:** reproduce Node's 250 ms
  per-address attempt limit against long-round-trip dual-stack hosts in the backend's
  `fetch` and `https.request` paths. Fix it with a per-request option rather than a
  process-wide default, and decide separately whether `requestPublicHttp` needs the same
  fix.
- **Secrets:** check that the connector key never appears in logs, exports or responses,
  including a fix for the generic edit form posting the `********` mask back over a stored
  secret. Encryption at rest is a separate ADR.
- **Demonstration** on a Pi and a PC on the same LAN, designed so two Pis also work:
  1. A publishes a `GET /conditions/summary` endpoint from Northern Rivers.
  2. B stores a key granted to that route only.
  3. B renders the remote data with its source time.
  4. Disconnect them: both keep working locally, and B's reading turns visibly stale.
  5. Revoke the key: B fails closed.
  6. Rotate the key: it survives a connector restart.

## Phase 6 (separate approval)

POST and device-command endpoints, with request schemas, `command` grants, idempotency
keys, replay protection, tighter per-route limits, audit attribution and `CommandService`
evidence semantics. Also out of scope until then: webhooks, WebSocket subscriptions,
discovery or federation, anonymous public APIs, OAuth/OIDC, delegated client management,
billing and Kong integration.

## Threat model coverage

| Threat | Covered by |
|---|---|
| Author code at compile time | Phase 0 (compiler tests) |
| Logic or UI code reached from an API, including via `lib/` | Phase 0 |
| Sandbox escape to `process`, `require`, MQTT, devices, HTTP, Shared State or the Data Store | Phase 0 (capability test) |
| State mutation, events, MQTT, commands or outbound requests through a GET | Phase 0 (no set/delete, copies); Phase 3 (host-side spies and table fingerprint) |
| Probing an unavailable API's health through an ungranted route | Phase 3 (route grant checked before health) |
| A failing or abandoned request holding a concurrency slot or an isolate | Phase 3 (resilience tests, disconnect abort) |
| Long-running promises, async CPU loops, memory exhaustion | Phase 0 |
| `__proto__` keys, cyclic and oversized bodies | Phase 0 |
| Encoded-path traversal and ambiguous routes | Phase 0 |
| Credentials copied from a browser session; dashboard JWTs or demo sessions used as keys | Phase 2 |
| Keys in URLs or logs | Phase 2 |
| Revoked, expired or ungranted keys, unknown slugs, removed routes | Phase 2 |
| A changed handler or new route under an old grant | Phase 1 snapshots, Phase 2 republish rule |
| CORS, OPTIONS, method confusion, fall-through to dashboard routes | Phase 2 |
| Proxy trust spoofing | Phase 2 (existing `TRUST_PROXY_HOPS`; limits keyed by credential, not IP) |
| Concurrent quota admission | Phase 2 (limiter), Phase 3 (per-client and server-wide caps under load) |
| Source deleted or edited during a request | Phase 1 (`project-api-publication.integration.test.ts`; the snapshot is read once per request) |
| SSRF through the outbound connector | Phase 5 (configured host only, redirect rules) |

## Release validation

Items to complete before a release that ships Project APIs. They are measurements, not
missing implementation.

1. **Raspberry Pi measurements.** On the Pi, from the repository root:
   `make bench-project-api` (Docker only; the first image build compiles the native
   modules). The JSON lands in `/tmp/aeolus-bench`. Record it here with the Pi model and
   storage type, next to the PC table in Phase 3.
2. **The script-caching decision**, from those numbers. Caching stays disabled until then;
   the PC results do not justify it.
3. **Native memory growth on the Pi.** On the PC, sustained concurrent load raised idle
   RSS by about 0.5 MB per 1,000 requests, matching bare `isolated-vm`. Check the Pi soak
   numbers. If it matters there, the remedy is operational (watching RSS), not a change to
   isolation.
