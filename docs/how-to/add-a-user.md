# Add a user

Create a non-admin dashboard account and assign it to a group.

## Before you start

- Log in as the administrator.
- Create at least one group first. See [Set up groups and permissions](setup-groups-permissions.md).

## Steps

1. Open **Security**.
2. Select **Users & Groups**.
3. In the Users section, choose **Add User**.
4. Enter:
   - a username;
   - a password of at least eight characters;
   - the group the user should belong to.
5. Choose **Create**.

The user can now sign in at the normal Aeolus URL.

## Change a user

Use the edit control beside the user to:

- assign a different group;
- set a new password.

A password reset revokes the user's refresh tokens. They must sign in again.

## Delete a user

Use the delete control and confirm the action.

The account created during first-run setup is the administrator. The normal user-creation flow creates `user` accounts, not additional administrators.
