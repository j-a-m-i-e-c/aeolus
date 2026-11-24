# Project APIs

An Automation Project can publish read-only HTTP endpoints for other programs, including
another Aeolus installation. The decision record is [ADR-0027](../adr/0027-project-apis.md),
and the phase plan is [project-apis-plan.md](../architecture/project-apis-plan.md).

Three separate things decide whether a request succeeds:

| | What it is | Changes when |
|---|---|---|
| **Development revision** | The project's current source | Anyone with write access saves the project |
| **Approved publication** | An immutable snapshot of the API an admin reviewed | An admin publishes or unpublishes |
| **Consumer access** | API clients, their keys and per-route grants | An admin creates, revokes or grants |

Requests always run the approved publication. Consumer access is read live on every request.

## Declaring endpoints

```text
api/routes.json    endpoints, as data
api/handlers.ts    the handler each route names
lib/               optional modules shared with Logic
```

```json
{
  "version": 1,
  "routes": [
    {
      "id": "tank-status",
      "method": "GET",
      "path": "/tanks/:id",
      "handler": "getTank",
      "response": {
        "type": "object",
        "properties": { "levelPercent": { "type": "number" }, "pumpRunning": { "type": "boolean" } },
        "required": ["levelPercent", "pumpRunning"]
      }
    }
  ]
}
```

```ts
// api/handlers.ts
export function getTank(request: { routeId: string; params: { id: string } }) {
  if (request.params.id !== "main") return api.response(404, { error: "Tank not found" });
  return { levelPercent: state.get("mainTankLevelPercent"), pumpRunning: state.get("mainPumpRunning") === true };
}
```

**Routes**
- `GET` only.
- At most 16 routes.
- Paths use lowercase literal segments and `:name` parameters, with no wildcards, regular
  expressions or optional segments.
- Two routes that some path could match both are a compile error.

**Handlers** may import only from `api/` and `lib/`. They run in their own sandbox and see
only `state.get` and `state.getAll`, read-only, for their own automation, plus
`api.response(status, body)` for a 400 or 404. They have no devices, MQTT, HTTP, Shared
State, Data Store or Node APIs. A successful response must match the route's `response`
schema, a small JSON Schema subset without `pattern`, `$ref` or `format`.

Saving the project validates all of this and serves nothing.

## Publishing and access in the editor

Open an automation's project in the editor and choose **Endpoints**, next to **Logic** and
**UI**. It appears for admins only, and never in the public demo; the server refuses every
management action to anyone else whatever the UI shows. The **API** button beside it is the
unchanged Logic and UI API reference.

1. **Inspect.** *Declared routes* lists each route's method, path, route id, handler and
   response schema from the **saved** source, and any compile errors. Unsaved editor changes
   are not included; save first. With no `api/routes.json` it shows an example manifest and
   handler to copy.
2. **Create the API.** Under *Publication*, choose the slug. Changing it later retires the
   old URL. A retired slug can be reclaimed only after a warning that it names a different
   API, and nothing (publication, keys, grants) carries over from the API that held it.
3. **Publish.** *Publication* shows the saved source and the published snapshot side by
   side. **Publish** asks for confirmation of the exact revision and content hash you are
   approving. If the saved source changed in the meantime, nothing is published and the
   view reloads. Before a republish it lists each route as unchanged, changed, removed or
   new, and which grants a republish would revoke.
4. **Create a client and a key.** Under *API clients*, create a client, open it and **Issue
   key** with an expiry (30 days, 90 days, a year, a date, or never). The key is shown once,
   with a copy button; after you close that dialog only its id and last four characters are
   ever shown. **Rotate** chooses the replacement's expiry and, separately, how long the old
   key keeps working. **Revoke** and **Disable** ask for confirmation first; disabling is
   temporary and keeps keys and grants.
5. **Grant a route.** Under *Access*, choose a client and a published route.
6. **Test it.** *Calling the API* shows each route's URL and a `curl` example with a
   placeholder key, generates the snapshot's OpenAPI 3.1 document, and sends a test
   request through the real pipeline with a key you paste in. The test key is used for that
   one request and kept nowhere.
7. **Unpublish** asks for confirmation that names how many grants are revoked for good.
   Clients and keys are untouched.

*Activity* lists this API's publication and access changes from the audit log.

## Publishing and access through the API

Everything below is admin-only, under `/api/project-apis` (see [API reference](api.md)). The
Endpoints view uses the same routes.
1. **Slug.** `PUT /api/project-apis/:automationId/slug { "slug": "tank-levels" }` gives the
   API its permanent URL: `/api/exposed/v1/tank-levels/...`.
2. **Publish.** `GET /api/project-apis/:automationId` shows the declared routes and their
   `contentHash`. `POST .../publish { "contentHash": ... }` snapshots exactly that content.
   If the source changed since you looked, the publish is refused.
3. **Client and key.** `POST /api/project-apis/clients { "name": "Remote farm" }`, then
   `POST /api/project-apis/clients/:clientId/keys`. The response contains the key
   `aeo_<keyId>_<secret>` **once**. It is not stored and cannot be shown again; a lost key is
   replaced by rotation.
   - **Rotating** (`POST .../keys/:credentialId/rotate { "expiresAt": ..., "overlapSeconds": ... }`)
     sets two lifetimes. `expiresAt` is the new key's expiry, a millisecond timestamp or
     `null` for none. It is required and never copied from the old key. `overlapSeconds` is
     how long the old key keeps working, up to a week and never past its own expiry. `0`,
     the default, revokes it at once.
4. **Grant.** `POST /api/project-apis/:automationId/grants { "clientId": ..., "routeId": "tank-status" }`.
   A grant covers one route. Routes added later are not included.

Then the client calls:

```bash
curl -H "Authorization: Bearer <api-key>" https://aeolus.local/api/exposed/v1/tank-levels/tanks/main
```

Use HTTPS unless the network is fully trusted. Plain HTTP on a trusted LAN is an explicit
development choice: the key crosses the network unencrypted, and the Endpoints view says so
whenever the dashboard itself is reached over HTTP. `GET .../openapi.json` returns an OpenAPI
3.1 document of the published snapshot for generating clients.

## What changes take effect, and when

| Change | Effect |
|---|---|
| Editing the project | Nothing served changes. The status shows unpublished changes until an admin republishes |
| Disabling the automation | Callers get `503` on the routes they are granted, until it is enabled again, and `404` on every other route. Grants are kept |
| An Aeolus upgrade that changes the handler runtime contract | The same `503`/`404` split until an admin republishes. Grants are kept |
| Unpublishing | Serving stops, and **every grant to that API is revoked** in the same transaction. Republishing, even identical source, restores none; grant again |
| Republishing changed source | Grants survive only for routes whose path, handler and response schema are unchanged |
| Demoting or deleting the admin who published | The publication is withdrawn and its grants revoked. Promoting them back restores nothing; an admin must republish and grant again |
| Revoking a key, disabling a client, revoking a grant | Refused from the next request. A request already running is allowed to finish (at most the 5 s handler deadline); for read-only endpoints this is intended |
| Changing the slug | The old slug stops resolving and is retired. Reusing it needs `reclaim: true`; grants, keys and publications belong to API ids, so a reclaimed slug inherits none of them |
| Deleting the automation | Its API, snapshots and grants are removed (audited) and the slug is retired. Reseeding the showcase does this to showcase APIs |

Revoking access never disables a client or revokes its keys: a client may hold grants to
other APIs.

## Responses

| Status | When |
|---|---|
| `200` | The handler's JSON, schema-checked |
| `400` | A query string was sent (none are supported yet), or the handler chose 400 |
| `401` | No key, or a malformed, unknown, wrong, expired or revoked key, or a disabled client. Same body for all |
| `403` | `EXPOSED_API_REQUIRE_HTTPS` is on and the request was not HTTPS |
| `404` | Unknown slug, route or version, or any route the key is not granted, including other projects' APIs, whether or not the API is currently available. Same body for all; a handler's own 404 is passed through only to a granted caller |
| `405` | Any method but `GET`/`HEAD`, on every path, including `OPTIONS`. No CORS approval |
| `429` | Over the per-minute or concurrency limit; see `Retry-After` |
| `500` | The handler threw, or returned something that breaks its schema |
| `503` | A route the key is granted, on an API that is unavailable (disabled, lost authority, publisher no longer an admin, runtime contract, integrity); or the server's handler sandboxes are all busy (`Retry-After: 1`) |
| `504` | The handler did not finish within 5 s |

Keys are accepted only in the `Authorization` header. A credential anywhere in a URL is
refused, and keys, query strings and response bodies are never logged.

## Network and limits

- **Supported:** a private LAN or a VPN (WireGuard, Tailscale). Exposing Aeolus to the
  internet through your own reverse proxy is possible but not a supported target.
- **Over plain HTTP the key crosses the network unencrypted.** Anyone who sees it can use it
  until it is revoked. Use HTTPS whenever the network is not fully trusted.
- **`EXPOSED_API_REQUIRE_HTTPS=true`** refuses any request Express does not establish as
  HTTPS. Behind a proxy:
  - set `TRUST_PROXY_HOPS` so `X-Forwarded-Proto` is trusted only from that proxy;
  - make the proxy **overwrite** `X-Forwarded-Proto` rather than pass a client's value on;
  - firewall the backend port so callers cannot bypass the proxy.

  With `TRUST_PROXY_HOPS=0`, a client-sent `X-Forwarded-Proto` is ignored.
- **Limits:**
  - 60 requests per minute per key and per client;
  - 2 concurrent requests per client;
  - 4 handler sandboxes at once across the server;
  - 64 KiB responses and a 5 s handler deadline;
  - a caller that disconnects has its handler stopped at once, and its slots freed.

  Limits are **in memory**: they reset when the backend restarts and are not shared between
  processes. One backend with one database is the supported topology.
- In public-demo mode every `/api/exposed` request gets `404`, and API management is
  refused.
