# First-run setup

A fresh Aeolus database has no users. The first browser session creates the administrator.

## Steps

1. Start Aeolus.
2. Open `http://localhost:3000`, or the hostname and frontend port used by your deployment.
3. Enter an administrator username.
4. Enter and confirm a password of at least eight characters.
5. Choose **Create Account**.

Aeolus signs the new administrator in and opens the dashboard.

## Administrator access

The administrator can:

- see all tabs;
- manage layout;
- manage users and groups;
- configure MQTT security;
- manage connectors;
- author automations.

Authentication cannot be disabled for the dashboard and HTTP API.

Next:

- [Set up groups and permissions](setup-groups-permissions.md)
- [Add a user](add-a-user.md)
- [Add an MQTT device](add-mqtt-device.md)
