# Add an MQTT device

Configure an ESP32, Arduino or other MQTT client for the local broker.

## Choose the broker security mode

Open **Security → MQTT Security** and choose one of the three supported modes:

- **Open** — no MQTT username/password. Best for bring-up on a trusted or isolated LAN.
- **Shared Password** — one generated credential used by all external MQTT devices.
- **Per-Device** — a unique credential for each device, with independent revocation.

The standard Docker Compose deployment supports all three immediately; there are no MQTT provisioning feature flags to enable.

## Shared Password

Switch to **Shared Password** and copy the displayed username and password into each MQTT client that should connect. Regenerating the credential invalidates the old shared password, so update affected devices after rotating it.

## Create a Per-Device credential

1. Switch to **Per-Device**.
2. Choose **Add Device**.
3. Enter a recognisable device name, such as `living-room-esp32`.
4. Create the credential.
5. Copy the generated password immediately. It is shown once.

Example:

| Field | Value |
|---|---|
| Username | `mqtt-living-room-esp32` |
| Password | generated value shown by Aeolus |

## Configure the device

```cpp
const char* mqtt_server = "192.168.1.100";
const int mqtt_port = 1883;
const char* mqtt_user = "mqtt-living-room-esp32";
const char* mqtt_pass = "copy-the-generated-password";

client.setServer(mqtt_server, mqtt_port);
client.connect("living-room-esp32", mqtt_user, mqtt_pass);
```

Use a unique MQTT client ID as well as a unique Per-Device credential. MQTT credentials are logical identities rather than hardware-bound secrets, so protect both the username/password and the client configuration that carries them.

## Verify it

- Check the MQTT status in Aeolus.
- Watch the MQTT inspector for the device's messages.
- Check broker logs if needed:

```bash
docker logs aeolus-mosquitto
```

## Revoke a Per-Device credential

Delete the credential from **Security → MQTT Security**. Aeolus regenerates the broker password file and reloads Mosquitto automatically. The revoked username/password will no longer authenticate while other device credentials remain active.

See [MQTT security](../security/mqtt.md) for the endpoint list, broker wiring and security trade-offs.
