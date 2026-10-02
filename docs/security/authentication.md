# Human authentication

Authentication is always active.

## First-run setup

When no admin exists, the frontend shows the setup page. The initial account:

- receives the `admin` role;
- bypasses group and tab permission checks;
- can manage users, groups, connectors and the MQTT security controls.

Setup requires a non-empty username and a password of at least eight characters. It is blocked after the first admin is created.

See [First-run setup](../how-to/first-run-setup.md).

## Login

`POST /api/auth/login` validates the username and password. A successful login returns:

- a short-lived access token in the JSON response;
- a refresh token in an HttpOnly cookie;
- the current user record.

Login has a dedicated limit of five attempts per minute per IP, in addition to the global API limiter.

## Users

Admins can:

- list users;
- create users;
- update passwords, group assignment and per-user session policies;
- delete users.

Normal users can change their own password.

A non-admin user belongs to zero or one group. A user without a group can sign in but will not receive normal tab access.

## Groups

Groups contain a name and tab assignments. Each assignment has one of the permission levels documented in [Permissions](permissions.md).

Only admins can create, update and delete groups.

## Password storage

Passwords are hashed with bcrypt. Raw passwords are not stored.

Changing a user's password revokes that user's refresh tokens.

## Main endpoints

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/auth/status` | Public |
| `POST` | `/api/auth/setup` | Public only while setup is required |
| `POST` | `/api/auth/login` | Public |
| `POST` | `/api/auth/logout` | Authenticated; revokes the refresh cookie when present |
| `PUT` | `/api/auth/password` | Authenticated user |
| `GET` | `/api/auth/me` | Authenticated user |
| `GET`, `POST` | `/api/auth/users` | Admin |
| `PUT`, `DELETE` | `/api/auth/users/:id` | Admin |
| `GET`, `POST` | `/api/auth/groups` | Admin |
| `PUT`, `DELETE` | `/api/auth/groups/:id` | Admin |

## Administrator-managed session policy

Admins choose each new or existing user's session lifetime in the **Users** page: **1, 7 (default), or 30 days**. Optional idle logout is disabled by default, or may be set to 30 minutes, 2 hours or 8 hours. This sets the server-side *refresh-session* policy; access JWTs are always limited to 15 minutes. An idle logout concerns deliberate browser interaction; passive telemetry, background API requests and automatic refresh are not operator activity.

Session-policy changes are evaluated at the next token refresh. Decreasing the maximum lifetime or idle timeout can shorten an existing session. Increasing the lifetime only applies to newly issued sessions; ask the user to sign out and sign back in. Idle enforcement happens at refresh time and outstanding 15-minute access JWTs are not immediately revoked. Explicit password resets revoke the affected user's refresh tokens independently.

If the Pi or Wi-Fi is briefly unavailable, the dashboard retains the current session state and retries renewal. A definitive refresh rejection (`401/403`) still ends the session. An already-expired access token does **not** bypass server authorization during an outage.

## Unfinished Automation Project recovery

When editing from the Automations page or a dashboard automation pane, Aeolus keeps debounced recovery snapshots of the **complete multi-file project and authoring fields** in that browser's IndexedDB. On reopening, it offers **Restore** and **Discard**, never silently overwriting the server project. An explicit save removes the matching recovery snapshot. If the project changed on the server while the editor was open, Aeolus blocks the ordinary save and retains the local draft instead of blindly overwriting another editor's work. This re-read is not an atomic revision lock; concurrent writes during the re-read-to-PUT gap still require a future server-side revision protocol.

Recovery is specific to the current browser profile, origin and Aeolus user. It is not synchronized between browsers, and IndexedDB data is not encrypted from someone who already has access to the browser profile. Do not store passwords or API keys in unfinished source on shared devices. If browser storage is unavailable or full, the editor shows a warning and you should manually copy/save your work.

The hosted public-demo draft mechanism is independent; the unrestricted editor's recovery snapshots must not turn into mutations of shared demo state.

Architectural background: [ADR-0025](../adr/0025-resilient-sessions-and-local-automation-drafts.md).
