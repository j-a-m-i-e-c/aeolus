# Add an MQTT device

Configure an ESP32, Arduino or other MQTT client for the local broker.

## Before you start

The default Docker Compose broker is Open and does not require credentials. Dashboard-managed Shared Password and
Per-Device security are under development and disabled by default. For an authenticated production deployment,
configure Mosquitto manually as described in [Production deployment](../production-deployment.md#2-mqtt-broker-security),
then enter the same credentials in the device firmware.

The dashboard workflow below is available only for development testing when
`MQTT_MANAGED_PROVISIONING_ENABLED=true` is set explicitly.

## Create the credential (experimental dashboard workflow)

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

The experimental provisioning API is under:

```text
/api/mqtt/provisioning
```

See [MQTT security](../security/mqtt.md) for the endpoint list and security modes.
