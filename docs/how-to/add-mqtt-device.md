# Add an MQTT Device

Provision credentials for a new microcontroller (ESP32, Arduino, etc.) so it can authenticate with the Mosquitto broker and publish/subscribe to topics.

## How MQTT auth works

Aeolus manages a Mosquitto password file. When you create a credential in the dashboard, Aeolus:
1. Generates a username and random password
2. Stores the hashed password in the database
3. Regenerates the Mosquitto password file
4. Mosquitto picks up the new file and allows the device to connect

Devices authenticate directly with Mosquitto using username/password — they never touch the HTTP API or need JWTs.

## Steps

1. Log in as admin
2. Go to the **System** tab
3. Scroll to the **MQTT Credentials** section (or access via API)
4. Click **Add Credential** (or POST to `/api/auth/mqtt-credentials`)
5. Enter a **device name** (e.g., "living-room-esp32")
6. Click **Create**
7. **Copy the password immediately** — it's only shown once

## What you get

| Field | Example |
|-------|---------|
| Username | `mqtt-living-room-esp32` |
| Password | `dGhpcyBpcyBhIHJhbmRvbSBwYXNzd29yZA` |

The username is auto-generated from the device name (lowercase, hyphens, prefixed with `mqtt-`).

## Flash your device

In your microcontroller firmware, configure the MQTT connection:

```cpp
// Arduino / ESP32 example
const char* mqtt_server = "192.168.1.100";  // Your Aeolus host
const int mqtt_port = 1883;
const char* mqtt_user = "mqtt-living-room-esp32";
const char* mqtt_pass = "dGhpcyBpcyBhIHJhbmRvbSBwYXNzd29yZA";

client.setServer(mqtt_server, mqtt_port);
client.connect("esp32-client-id", mqtt_user, mqtt_pass);
```

## Verify connection

Once flashed and powered on, the device should connect to Mosquitto. You can verify by:
- Checking the MQTT status indicator in the Aeolus sidebar
- Looking at Mosquitto logs: `docker logs aeolus-mosquitto`
- Publishing a test message and seeing it appear in the dashboard

## Revoking a credential

1. In the MQTT Credentials section, click the **trash icon** next to the device
2. The credential is removed and the password file is regenerated
3. The device will be disconnected on its next reconnect attempt

## Notes

- The backend has its own credential (`aeolus-backend`) created automatically on startup — don't delete it
- Each device needs its own credential — don't share credentials between devices
- If a device can't connect, try deleting and recreating the credential
- The password file is at `mosquitto/password_file` (configurable via `MQTT_PASSWORD_FILE` env var)
