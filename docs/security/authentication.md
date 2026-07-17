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
- update usernames, passwords and group assignment;
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
