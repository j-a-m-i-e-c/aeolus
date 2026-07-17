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

## Admin role

Admins bypass tab permission checks and can perform system-wide administration, including:

- user and group management;
- connector management;
- MQTT credential management;
- full layout administration.

## Current scope

The current permission model is tab-oriented. It is designed for a trusted local installation where tabs are the main operator boundary.

Devices, automation records and platform APIs are not all modelled as independently owned resources. Do not present the current group system as strong tenant isolation between hostile users.

For a future multi-site or multi-tenant product, permissions should attach directly to sites and resources, with tabs treated as views.
