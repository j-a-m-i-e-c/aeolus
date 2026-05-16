# Add a User

Create accounts for household members so they can access the dashboard with controlled permissions.

## Prerequisites

- You must be logged in as the admin
- You should have at least one group created (see [Set Up Groups & Permissions](./setup-groups-permissions.md))

## Steps

1. Go to the **System** tab (the dashboard/home page)
2. Scroll down to the **Users** section
3. Click **Add User**
4. Fill in:
   - **Username** — whatever they'll log in with
   - **Password** — minimum 8 characters (they can change it later)
   - **Group** — select which group they belong to (this controls what tabs they see)
5. Click **Create**

The user can now log in at the same URL with their credentials.

## What users can do

Users see only the tabs assigned to their group, with the permission level set for each tab:

| Permission | What they can do |
|-----------|-----------------|
| Read | View the tab — all controls are disabled |
| Interact | Toggle devices, fire automations, use buttons |
| Write | Full control including editing automation code and managing panes |

## Changing a user's group

1. In the Users section, click the **pencil icon** next to the user
2. Change the **Group Assignment** dropdown
3. Click **Save Changes**

The change takes effect on their next token refresh (within 15 minutes, or immediately if they log out and back in).

## Resetting a user's password

1. Click the **pencil icon** next to the user
2. Enter a new password in the **Reset Password** field
3. Click **Save Changes**

This invalidates all their active sessions — they'll need to log in again with the new password.

## Deleting a user

1. Click the **trash icon** next to the user
2. Confirm the deletion

Note: You cannot delete the last admin account.
