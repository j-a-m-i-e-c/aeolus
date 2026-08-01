# Design Document

## Overview

Today Aeolus can hold exactly one admin. The first-run setup (`authService.setupAdmin`) creates it; every later user goes through `POST /api/auth/users`, which calls `userService.createUser()` — and that function hardcodes `role = 'user'` in its `INSERT`. `userService.updateUser()` only writes `group_id` and `password_hash`, so a role can never change. The only role-related safeguard is in `userService.deleteUser()`, which refuses to delete the last admin.

This feature adds two capabilities and extends one safeguard:

1. **Create with a role** — `createUser()` accepts a `role` (`admin` | `user`, defaulting to `user`), and the create schema/route pass it through.
2. **Change a role** — `updateUser()` accepts an optional `role` and updates it, in either direction.
3. **Last-admin safeguard on demotion** — the existing "cannot remove the last admin" rule (currently only on delete) is extended so a demotion that would drop the admin count to zero is refused with the same `409 Conflict`.

The change is deliberately small and stays entirely inside the existing auth layer (`src/auth/user-service.ts`, `src/api/schemas/auth.schemas.ts`, `src/api/routes/auth.routes.ts`) and the existing admin UI (`frontend/src/pages/UserManagementPage.tsx`). No new tables, migrations, routes, or middleware. All user-management routes are already `authenticate` + `requireAdmin`; that gating is unchanged.

### Goals

- An admin can create additional admins and promote/demote existing users.
- The system can never be left with zero admins (delete or demote).
- Existing flows (create ordinary user, change group/password) behave exactly as before when `role` is omitted.
- Password hashes are never returned; role is validated server-side.

### Non-goals

- No change to the setup flow, the group/tab permission model, or `read`/`interact`/`write`.
- No self-service role change, invitations, or MFA.
- No persisted audit log beyond existing application logging.

## Architecture

The request path is unchanged; only the service and schema layers gain a `role` field and the demotion safeguard.

```mermaid
flowchart TD
    R[POST/PUT /api/auth/users] --> A[authenticate]
    A --> AD[requireAdmin]
    AD --> V[validate: createUserSchema / updateUserSchema\nrole in {admin,user}]
    V --> H[route handler]
    H --> S[user-service.createUser / updateUser]
    S --> G{role change is a demotion\nof the last admin?}
    G -->|yes| C[ConflictError 409]
    G -->|no| DB[(users table\nrole column)]
```

The `users` table already has a `role TEXT` column (`'admin' | 'user'`) from the baseline migration, so no schema migration is required.

## Components and Interfaces

### Schemas (`src/api/schemas/auth.schemas.ts`)

Add a shared role enum and extend the two user schemas. `role` is optional on both; the service applies the default on create and leaves the role unchanged on update when omitted.

```typescript
const roleSchema = z.enum(["admin", "user"]);

export const createUserSchema = z.object({
  username: z.string().min(1, "Username must not be empty"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  groupId: z.string().nullable(),
  role: roleSchema.optional(),          // NEW — defaults to "user" in the service
});

export const updateUserSchema = z.object({
  groupId: z.string().nullable().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: roleSchema.optional(),          // NEW
});
```

An invalid `role` string fails Zod validation, producing the API's standard `400` (R1.3, R2.4).

### User service (`src/auth/user-service.ts`)

**`createUser`** gains a `role` parameter (default `"user"`) and writes it instead of the hardcoded literal:

```typescript
export async function createUser(
  username: string,
  password: string,
  groupId: string | null,
  role: "admin" | "user" = "user",
): Promise<User> {
  validatePassword(password);
  // ...hash...
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, username, passwordHash, role, groupId, createdAt);
  // return { ...role }
}
```

The existing `ConflictError` on `UNIQUE constraint failed` (username) is unchanged (R1.5).

**`updateUser`** gains `role` in its `updates` object and, when the update is a demotion, applies the last-admin safeguard before writing:

```typescript
export async function updateUser(
  id: string,
  updates: { groupId?: string | null; password?: string; role?: "admin" | "user" },
): Promise<User> {
  const existing = getUser(id);
  if (!existing) throw new NotFoundError("User not found");

  if (updates.role !== undefined && updates.role !== existing.role) {
    if (existing.role === "admin" && updates.role === "user") {
      assertNotLastAdmin();          // shared with deleteUser (see below)
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(updates.role, id);
  }
  // existing password / groupId branches unchanged
  return getUser(id)!;
}
```

Notes:
- `groupId` update is widened to accept `null` (the route already passes `groupId || null`); this matches the create path and lets an admin clear a group. This is a compatible refinement, not a behavior change for existing callers.
- Promotion (`user` → `admin`) has no safeguard — it only ever increases the admin count.
- Only an actual change triggers a write; submitting the current role is a no-op (keeps promotion/demotion idempotent and avoids a spurious last-admin check when "demoting" is not actually happening).

**Shared last-admin guard.** Extract the count-and-throw currently inline in `deleteUser` into a small helper reused by both delete and demotion, so the two paths cannot diverge:

```typescript
/** Throw ConflictError if the system currently has only one admin. */
function assertNotLastAdmin(): void {
  const db = getDatabase();
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .get() as { count: number };
  if (count <= 1) {
    throw new ConflictError("Cannot remove the last admin user");
  }
}
```

`deleteUser` keeps its existing behavior (only calls `assertNotLastAdmin()` when the target is an admin) (R3.2). `updateUser` calls it only on a genuine admin→user demotion (R3.1). The count is evaluated at request time (R3.4).

### Routes (`src/api/routes/auth.routes.ts`)

Two one-line changes; the routes are already `authenticate` + `requireAdmin` + `validate(...)`:

- `POST /api/auth/users` handler passes `role` through:
  `userService.createUser(username, password, groupId, role)`.
- `PUT /api/auth/users/:id` already forwards the whole validated body as `updates`; once `role` is in `updateUserSchema` it flows through automatically. The response shape (already omitting the hash) is unchanged and now reflects the updated role (R2.7, R1.4).

No route gains or loses a guard.

### Frontend (`frontend/src/pages/UserManagementPage.tsx`)

The page already renders each user's role (a `Shield`/`User` icon and a role badge) and calls the three routes through `authFetch`. Three additive changes:

1. **Create form** — add a Role `<select>` (`user` default, `admin` option) next to the group selector; include `role` in the create request body. (R4.1)
2. **Edit modal** — add a Role `<select>` initialized to the user's current role; include `role` in the `updates` payload when it differs from the original (mirroring the existing group/password diffing). (R4.3)
3. **Delete affordance** — the delete button is currently hidden for any admin (`u.role !== "admin"`). Change this so delete is offered for admins too and rely on the server's `409` for the last admin, surfacing that error in the existing delete-error slot. This makes deleting a non-last admin possible from the UI (R3.3) while keeping the last-admin protection authoritative on the server. The edit modal's demotion path surfaces the same `409` in its error slot (R4.4).

The page is only reachable by admins (it is mounted behind the admin-only settings area and every call it makes is admin-gated), satisfying "role controls shown only to admins" (R4.5, R5.4). No new client permission logic is introduced.

## Data Models

No schema change. The relevant column already exists:

```sql
-- users (baseline migration), unchanged
role TEXT NOT NULL DEFAULT 'user'  CHECK (role IN ('admin','user'))
```

`role` in API payloads is constrained to `admin | user` by `roleSchema`.

## Correctness Properties

The logic here is small and mostly example-shaped (specific status codes and a count-based guard), so the bulk of verification is example/integration tests. Two general properties are worth stating.

### Property 1: The admin population never drops to zero

*For any* sequence of create, promote, demote, and delete operations applied through the service, the number of users with role `admin` is at least 1 at every point after the first admin exists; any single operation that would reduce it from 1 to 0 (a demotion or deletion of the last admin) is rejected and leaves the state unchanged.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 2: Role updates are exact and side-effect-isolated

*For any* existing user and *any* update payload, after `updateUser`:
- the role equals the submitted role when a valid `role` is present, and equals the prior role when `role` is omitted; and
- group and password updates are applied independently of whether `role` is present.

**Validates: Requirements 2.1, 2.2, 2.3, 5.2**

## Error Handling

Reuses the existing typed errors from `src/api/middleware/error-handler.ts`:

- Invalid `role` value → Zod `validate` middleware → `400`.
- Duplicate username on create → `ConflictError` → `409` (unchanged).
- Update/delete of a missing user → `NotFoundError` → `404`.
- Demote/delete the last admin → `ConflictError` → `409` with message "Cannot remove the last admin user".
- Non-admin caller → `requireAdmin` → `403` (unchanged).

The last-admin count query and the role write in `updateUser` run against the same request's DB handle; better-sqlite3 is synchronous, so the count-then-write is not subject to async interleaving within a single request.

## Testing Strategy

### Unit tests — `src/auth/user-service.test.ts` (extend existing)

- `createUser` with `role: "admin"` creates an admin; default (omitted) creates a `user` (R1.1, R1.2, R5.1).
- `createUser` never returns a password/hash field (R1.4).
- `updateUser` promotes `user` → `admin` (R2.1).
- `updateUser` demotes `admin` → `user` when another admin exists (R2.2, R3.3).
- `updateUser` with `role` omitted leaves role unchanged and still applies group/password (R2.3, R5.2).
- `updateUser` demoting the last admin throws `ConflictError` and leaves role `admin` (R3.1).
- `deleteUser` on the last admin still throws `ConflictError` (R3.2, regression).
- `deleteUser`/`updateUser` on a missing user throws `NotFoundError` (R2.5).
- Property 1 and Property 2 as `fast-check` properties (≥100 runs), driving the service against an in-memory (`:memory:`) SQLite seeded with a generated set of users/roles and a generated operation sequence. Tag each with `// Feature: admin-user-management, Property N: ...`.

### Route/integration tests — `src/api/routes/auth.routes.test.ts` (extend existing)

- `POST /api/auth/users` with `role: "admin"` returns `201` and an admin record; invalid `role` returns `400` (R1.1, R1.3).
- `PUT /api/auth/users/:id` with `role: "admin"` / `role: "user"` returns the updated role; last-admin demotion returns `409` (R2.1, R2.2, R3.1).
- Non-admin caller to any user-management route returns `403` (R1.6, R2.6, R5.4).
- `DELETE` last admin returns `409`; `DELETE` a non-last admin returns `200` (R3.2, R3.3).

### Frontend tests — `frontend/src/pages/UserManagementPage.test.tsx` (extend existing)

- Create form includes a role selector and sends `role` in the POST body (R4.1).
- Edit modal includes a role selector initialized to the current role and sends `role` when changed (R4.3).
- Role column renders the current role for each user (R4.2).
- A `409` from update or delete surfaces an error and leaves the row's role unchanged (R4.4).

### Test data cleanup

Service and route tests use a fresh `:memory:` database per test (matching existing auth tests) so no fixtures leak.
