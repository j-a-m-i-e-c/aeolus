# Permissions

Aeolus currently uses an admin role plus group-based tab permissions.

## Levels

```text
write > interact > read
```

| Level | Intended use |
|---|---|
| `read` | View a tab and its information |
| `interact` | Use controls and fire actions |
| `write` | Edit panes, automation configuration and other writable content |

A check for `read` accepts all three levels. A check for `interact` accepts `interact` and `write`.

## Groups and assignments

1. An admin creates a group.
2. The group is assigned specific tab IDs with permission levels.
3. A normal user is assigned to one group.
4. The frontend uses the returned assignments to decide which tabs and controls to show.
5. Protected routes use `requireTabPermission()` where a tab-scoped mutation needs enforcement.

## Resource-level authorization

Device and automation routes are authorized against the target resource, not
against a tab identifier taken from the request. The middleware resolves, on the
server, which tabs actually expose the target resource and grants the most
permissive level the user's group holds across those tabs.

- **Automations** — a server-side ownership table (`automation_tab_assignments`)
  records which tabs expose each automation, derived from each pane's
  `config.ruleId`. It is backfilled on upgrade and kept current when the layout
  is saved.
- **Devices** — exposure is computed live at request time. A tab exposes a
  device only through a purposeful, scoped device pane (`hue-control`,
  `kasa-control`, `sensor-panel`). Every other pane type, including the
  `device-grid` pane and any unknown/legacy pane, exposes nothing. There is no
  stored device assignment, so a newly added device that matches an existing
  pane's scope is reachable immediately.

Enforced routes: device actions (`POST /api/devices/:id/action`), automation
firing (`POST /api/automations/:id/fire`), enable/disable
(`PATCH /api/automations/:id/toggle`), automation state writes
(`PUT`/`DELETE /api/automations/:id/state...`). Device and automation listings
and detail reads are filtered to resources the group can reach at `read`.

The decision is derived entirely from server-side resource identity; a
caller-supplied tab identifier can neither grant nor widen access. A resource
that no tab exposes is inaccessible to non-admins (fail-closed). Missing
resources return `404` before any permission check. Destructive device-history
routes remain admin-only.

## Automation authoring scope

Every automation carries a server-side authorization scope so authored Logic
cannot exceed the authority of whoever wrote it. Scope is two columns on
`automation_rules`: `authored_unrestricted` and `owner_tab_id`.

- **Admin-authored automations are unrestricted** (`authored_unrestricted = 1`):
  they run with system-wide authority — all devices, any MQTT topic, all Data
  Store collections and buckets, HTTP per the sandbox SSRF policy.
- **Non-admin-authored automations are scoped** (`authored_unrestricted = 0`) to
  a single owning tab chosen at creation. The author must hold `write` on that
  tab. At runtime the automation may act only on the devices that tab exposes and
  the Data Store collections it surfaces; it may not publish raw MQTT, may not use
  shared key-value buckets, and its outbound HTTP is limited to the SSRF policy.
  Form-rule webhook actions are refused for scoped automations.

Scope is bound at creation from the caller's server-side role, never from a body
field, and is immutable across non-admin updates. Enforcement is defense in
depth: the sandbox injects only the in-scope device inventory and Data Store
surface, and the command boundary re-checks every dispatch, so a script that
fabricates an out-of-scope identifier is still refused. If a scoped automation's
owning tab is deleted, its scope becomes empty (fail-closed) — it is never
silently promoted to unrestricted.

The owning tab also **exposes** its automations (in addition to any panes that
reference them), so a non-admin author can view, fire, and edit their own
automation through the resource guards above without needing an admin to place a
pane. Pre-existing automations are marked unrestricted on upgrade so nothing
that worked before breaks.

Deferred (tracked in the backlog): per-automation MQTT publish namespaces that
would let scoped automations publish safely, and consolidating outbound HTTP
(script `http` and form-rule webhooks) behind one bounded, SSRF-checked host
service.

## Admin role

Admins bypass tab permission checks and can perform system-wide administration, including:

- user and group management, including creating additional admin users and
  promoting/demoting existing users between `admin` and `user`. The system
  refuses to demote or delete the last remaining admin, so a deployment can never
  be left with no administrator;
- connector management;
- MQTT credential management;
- full layout administration;
- authoring unrestricted (system-wide) automations.

## Current scope

The permission model is tab-oriented: tabs are the operator boundary, and a
group's tab assignments drive both the UI and route enforcement. Device and
automation routes now derive authorization from the tabs that expose the target
resource (see Resource-level authorization above), so holding permission on an
unrelated tab no longer authorizes operations on a resource that tab does not
expose.

WebSocket visibility now follows the same resource model and is fail-closed:
device state and automation events are scoped to the tabs that expose the
resource, and any event without an explicit scope (Data Store events) is
delivered to admins only rather than to every client. The raw MQTT feed is a
deliberate exception: it is a discovery firehose and is visible to every
authenticated client so it stays useful for building automations and onboarding
devices. Sensitive topics can be withheld from that feed with private topic
filters (`/api/mqtt/private-topics`): a message whose topic matches a filter is
delivered to admins only. Any authenticated user may add a filter or view the
list, because marking a topic private only hides data; removing a filter
re-exposes the topic and is therefore admin-only. Raw MQTT publish remains
outside the resource model. Do not present the group system as strong tenant
isolation between hostile users; it is designed for a small, mostly-trusted
local installation.

For a future multi-site or multi-tenant product, permissions should attach
directly to sites and resources, with tabs treated as views.
