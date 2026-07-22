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

## Admin role

Admins bypass tab permission checks and can perform system-wide administration, including:

- user and group management;
- connector management;
- MQTT credential management;
- full layout administration.

## Current scope

The permission model is tab-oriented: tabs are the operator boundary, and a
group's tab assignments drive both the UI and route enforcement. Device and
automation routes now derive authorization from the tabs that expose the target
resource (see Resource-level authorization above), so holding permission on an
unrelated tab no longer authorizes operations on a resource that tab does not
expose.

Some paths remain outside this resource model — notably raw MQTT publish and
WebSocket visibility filtering. Do not present the group system as strong tenant
isolation between hostile users; it is designed for a small, mostly-trusted
local installation.

For a future multi-site or multi-tenant product, permissions should attach
directly to sites and resources, with tabs treated as views.
