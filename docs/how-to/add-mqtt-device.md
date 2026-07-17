# Add an MQTT device

Create a broker credential for an ESP32, Arduino or other MQTT client.

## Before you start

The steps below assume MQTT provisioning has been wired into your deployment. In the default Docker Compose setup, configure Mosquitto manually as described in [Production deployment](../production-deployment.md#2-mqtt-broker-security), then enter the same credentials in the device firmware.

1. Log in as the administrator.
2. Open **Security**.
3. Select **MQTT Security**.
4. Set the broker to **Per-Device** mode.

Open mode does not require credentials. Shared mode uses one credential for all devices.

## Create the credential

1. In the Per-Device credential list, choose **Add Device**.
2. Enter a recognisable device name, such as `living-room-esp32`.
3. Create the credential.
4. Copy the generated password immediately. It is shown once.

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

Use a unique MQTT client ID as well as a unique credential.

## Verify it

- Check the MQTT status in Aeolus.
- Watch the MQTT inspector for its messages.
- Check broker logs:

```bash
docker logs aeolus-mosquitto
```

## Revoke it

In a provisioning-enabled deployment, delete the credential from **Security → MQTT Security**. In a manually managed deployment, also remove it from the Mosquitto password file and reload the broker.

The current provisioning API is under:

```text
/api/mqtt/provisioning
```

See [MQTT security](../security/mqtt.md) for the endpoint list and security modes.
