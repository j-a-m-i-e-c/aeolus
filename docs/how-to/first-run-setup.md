# First-Run Setup

After a fresh deploy (or after wiping the database), Aeolus requires you to create an admin account before anything else works.

## What happens

1. You navigate to the Aeolus dashboard (e.g., `http://localhost:5173`)
2. Instead of the normal UI, you see the **Setup Page**
3. You create your admin username and password
4. You're automatically logged in and redirected to the dashboard

## Steps

1. **Open the dashboard** in your browser
2. You'll see "Create Admin Account" with a username and password form
3. Enter a username (anything you want)
4. Enter a password (minimum 8 characters)
5. Confirm the password
6. Click **Create Account**

That's it. You're now the admin with full access to everything.

## What the admin can do

- See all tabs with full write access
- Create/delete tabs
- Create/manage users and groups
- Manage MQTT device credentials
- Manage connectors and services
- Everything else

## Notes

- There is no "disable auth" option — authentication is always active
- The admin account has no group assignment (it bypasses all group/tab restrictions)
- If you need to add other users, see [Add a User](./add-a-user.md)
- If you need to control what users can see, see [Set Up Groups & Permissions](./setup-groups-permissions.md)
