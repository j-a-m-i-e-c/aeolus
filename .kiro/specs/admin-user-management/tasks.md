# Implementation Plan: Admin User Management

## Overview

This plan lets admins create additional admins and change an existing user's role in both directions, with a last-admin safeguard covering both deletion (existing) and demotion (new). The work is small and stays inside the existing auth layer plus the admin user-management UI. No new tables, migrations, routes, or middleware — the `users.role` column and the admin-gated `/api/auth/users` routes already exist.

Implementation is bottom-up: schema (Zod) first, then the `user-service` changes and the shared last-admin guard, then the two one-line route wirings, then the frontend controls.

Property-based tests use **fast-check** with a minimum of **100 iterations**, follow the existing pattern in the repo, and are tagged `// Feature: admin-user-management, Property N: <text>`. Test sub-tasks are marked optional with `*`.

## Tasks

- [ ] 1. Add the `role` field to the user schemas
  - [ ] 1.1 Extend `src/api/schemas/auth.schemas.ts`
    - Add `const roleSchema = z.enum(["admin", "user"]);`
    - Add `role: roleSchema.optional()` to both `createUserSchema` and `updateUserSchema`
    - _Requirements: 1.1, 1.3, 2.1, 2.4_

- [ ] 2. Extend the user service with role create/update and the shared last-admin guard
  - [ ] 2.1 Extract the last-admin guard in `src/auth/user-service.ts`
    - Add a private `assertNotLastAdmin()` that counts `role = 'admin'` users and throws `ConflictError("Cannot remove the last admin user")` when the count is `<= 1`
    - Refactor `deleteUser` to call `assertNotLastAdmin()` in its existing admin branch (behavior unchanged)
    - _Requirements: 3.2, 3.4_
  - [ ] 2.2 Add `role` to `createUser`
    - Add a `role: "admin" | "user" = "user"` parameter; write it in the `INSERT` instead of the hardcoded `'user'`; return it in the `User`
    - _Requirements: 1.1, 1.2, 1.4, 5.1_
  - [ ] 2.3 Add `role` to `updateUser`
    - Widen the `updates` type to include `role?: "admin" | "user"` (and `groupId?: string | null`)
    - When `updates.role` is present and differs from the current role: if it is an admin→user demotion call `assertNotLastAdmin()` first, then `UPDATE users SET role = ?`
    - Leave role unchanged when `role` is omitted; keep the existing password/group branches independent
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 5.2_
  - [ ]* 2.4 Extend `src/auth/user-service.test.ts` with unit + property tests
    - Unit: create admin vs default user; create returns no password/hash; promote; demote with another admin present; omit-role leaves role unchanged while applying group/password; demote last admin → `ConflictError`; delete last admin → `ConflictError` (regression); update/delete missing user → `NotFoundError`
    - **Property 1: The admin population never drops to zero** — apply a generated sequence of create/promote/demote/delete ops and assert admin count is never driven from 1 to 0
    - **Property 2: Role updates are exact and side-effect-isolated** — role equals submitted (or prior when omitted) and group/password apply independently
    - Use a fresh `:memory:` DB per test; tag properties `// Feature: admin-user-management, Property N: <text>`
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 5.1, 5.2_

- [ ] 3. Wire `role` through the routes
  - [ ] 3.1 Update `src/api/routes/auth.routes.ts`
    - `POST /api/auth/users`: pass `role` into `userService.createUser(username, password, groupId, role)`
    - `PUT /api/auth/users/:id`: no change needed beyond the schema (the whole validated body is already forwarded as `updates`); confirm `role` flows through and the response omits the hash
    - _Requirements: 1.1, 2.1, 2.7_
  - [ ]* 3.2 Extend `src/api/routes/auth.routes.test.ts`
    - `POST /users` with `role: "admin"` → 201 admin record; invalid `role` → 400
    - `PUT /users/:id` promote/demote → updated role; last-admin demotion → 409
    - Non-admin caller → 403 on create/update/delete; `DELETE` last admin → 409, non-last admin → 200
    - _Requirements: 1.1, 1.3, 1.6, 2.1, 2.2, 2.6, 3.1, 3.2, 3.3, 5.4_

- [ ] 4. Add role controls to the user-management UI
  - [ ] 4.1 Update `frontend/src/pages/UserManagementPage.tsx`
    - Add a Role `<select>` (default `user`, option `admin`) to the create form and include `role` in the create POST body
    - Add a Role `<select>` to the edit modal initialized to the user's current role; include `role` in the `updates` payload when it differs
    - Show the delete button for admin users too (remove the `u.role !== "admin"` guard) and surface a `409` from delete/update in the existing error slots without changing the displayed role
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 4.2 Extend `frontend/src/pages/UserManagementPage.test.tsx`
    - Create form sends `role`; edit modal initializes and sends changed `role`; role column renders; a mocked `409` surfaces an error and leaves the role unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 5. Checkpoint — build, lint, and full suite green
  - Run the backend and frontend test suites and the build; fix any regressions. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks; core implementation sub-tasks are never optional.
- No schema migration: `users.role` already exists in the baseline migration.
- All `/api/auth/users` routes remain `authenticate` + `requireAdmin`; this feature adds no new routes and changes no guards.
- Property tests use fast-check with `{ numRuns: 100 }` (or higher) and carry the `// Feature: admin-user-management, Property N: <text>` tag.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "4.2"] },
    { "id": 4, "tasks": ["5"] }
  ]
}
```
