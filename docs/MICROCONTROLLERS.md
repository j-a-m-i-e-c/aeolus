# Connecting microcontrollers to Aeolus

Microcontrollers connect to the local Mosquitto broker, publish telemetry and optionally subscribe to command topics.

Aeolus discovers devices from incoming MQTT topics. Firmware flashing and OTA updates remain outside the platform.

## 1. Publish telemetry

A simple ESP32 publisher:

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient wifi;
PubSubClient mqtt(wifi);

void setup() {
  WiFi.begin("your-ssid", "your-password");
  while (WiFi.status() != WL_CONNECTED) delay(500);

  mqtt.setServer("aeolus.local", 1883);
}

void loop() {
  if (!mqtt.connected()) {
    mqtt.connect("workshop-temperature");
  }

  mqtt.loop();
  mqtt.publish(
    "sensor/workshop/temperature",
    "{\"value\":23.5,\"unit\":\"°C\"}"
  );
  delay(5000);
}
```

After the message arrives, Aeolus creates or updates a device for that topic.

## Topic conventions

Aeolus accepts arbitrary valid topics. A useful convention is:

```text
{type}/{location}/{metric}
```

Examples:

| Topic | Meaning |
|---|---|
| `sensor/workshop/temperature` | Workshop temperature |
| `sensor/tank/level` | Tank level |
| `switch/escape-room/door` | Escape-room door state |
| `sensor/vessel/depth` | Research-vessel depth |
| `light/stage/front-wash` | Stage fixture state |

Recognised first segments help Aeolus choose a device type and display name, but unfamiliar topic shapes are still accepted.

## Payloads

Recommended:

```json
{
  "value": 23.5,
  "unit": "°C",
  "battery": 82
}
```

Aeolus also accepts numbers, strings, booleans and JSON objects with several fields.

## MQTT credentials

Broker authentication depends on the configured security mode:

- Open: no username or password;
- Shared: one shared credential;
- Per-Device: a unique credential for each client.

See [Add an MQTT device](how-to/add-mqtt-device.md).

## 2. Receive commands

An actuator subscribes to a command topic and publishes its resulting state on a normal state topic.

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

#define RELAY_PIN 5

WiFiClient wifi;
PubSubClient mqtt(wifi);

const char* COMMAND_TOPIC = "switch/workshop/extractor/set";
const char* STATE_TOPIC = "switch/workshop/extractor";

void publishState() {
  const bool on = digitalRead(RELAY_PIN) == HIGH;
  mqtt.publish(STATE_TOPIC, on
    ? "{\"on\":true}"
    : "{\"on\":false}");
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += static_cast<char>(payload[i]);
  }

  if (message.indexOf("\"on\":true") >= 0) {
    digitalWrite(RELAY_PIN, HIGH);
  } else if (message.indexOf("\"on\":false") >= 0) {
    digitalWrite(RELAY_PIN, LOW);
  }

  publishState();
}

void connectMqtt() {
  while (!mqtt.connected()) {
    if (mqtt.connect("workshop-extractor")) {
      mqtt.subscribe(COMMAND_TOPIC);
      publishState();
    } else {
      delay(5000);
    }
  }
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  WiFi.begin("your-ssid", "your-password");
  while (WiFi.status() != WL_CONNECTED) delay(500);

  mqtt.setServer("aeolus.local", 1883);
  mqtt.setCallback(onMessage);
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
}
```

Publishing state after a command lets the dashboard and automations see what the device reports.

## Command topic selection

For an MQTT device action, Aeolus uses:

1. an explicit `commandTopic` on the device when available;
2. otherwise the state topic with its last segment replaced by `set`;
3. otherwise `{deviceId}/set`.

For example:

```text
sensor/workshop/fan/state
```

becomes:

```text
sensor/workshop/fan/set
```

Choose topic shapes deliberately when the derived form is not suitable.

## Sending commands

### Preferred: device action

Free-form Logic can target the registered device rather than hardcoding the transport:

```javascript
const result = await devices.action(
  "switch-workshop-extractor",
  "command",
  {
    payload: { on: true }
  }
);

if (!result.success) {
  log.error(result.error ?? "Extractor command failed");
}
```

The exact device ID is visible in Aeolus. MQTT devices expose a `command` action in their action catalog.

To wait for a state reported by the same device:

```javascript
const result = await devices.action(
  "switch-workshop-extractor",
  "command",
  { payload: { on: true } },
  {
    condition: state => state.on === true,
    timeoutMs: 5000
  }
);
```

Confirmation can also observe another device. A pump command could, for example, wait for a flow sensor rather than trusting a relay state.

### Raw MQTT publish

For transport-level testing or protocols that are not modelled as a device action:

```javascript
mqtt.publish(
  "switch/workshop/extractor/set",
  JSON.stringify({ on: true })
);
```

Raw publish means that Aeolus handed a message to the MQTT client. It does not by itself verify the physical result.

### MQTT inspector

The dashboard MQTT inspector is useful for testing telemetry and command topics manually.

### HTTP API

```bash
curl -X POST http://aeolus.local:3001/api/mqtt/publish \
  -H "Authorization: Bearer $AEOLUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "switch/workshop/extractor/set",
    "payload": { "on": true }
  }'
```

This is also a raw publish path.

## Testing without hardware

```bash
mosquitto_pub \
  -h aeolus.local \
  -t "sensor/workshop/temperature" \
  -m '{"value":23.5,"unit":"°C"}'

mosquitto_pub \
  -h aeolus.local \
  -t "switch/escape-room/door" \
  -m '{"locked":true}'
```

Add `-u` and `-P` when broker authentication is enabled.

## Firmware practices

- Use a unique MQTT client ID.
- Reconnect Wi-Fi and MQTT without blocking forever.
- Re-subscribe after every reconnect.
- Publish current state after connecting.
- Use retained state only when a new subscriber should receive the last value.
- Use QoS 0 for frequent disposable telemetry and QoS 1 where delivery matters.
- Make command handling idempotent because QoS 1 can deliver duplicates.
- Use independent electrical and mechanical protection for physical equipment.
- Keep credentials out of public repositories.

## Command acknowledgement (optional)

For most devices, publishing state after handling a command is all you need. Aeolus can observe the state change and confirm the action worked — no extra firmware logic required.

If you need stronger guarantees for critical equipment (pumps, valves, access control), your firmware can acknowledge commands directly. This tells Aeolus the device received and acted on a specific command, rather than inferring it from state.

### How it works

When Aeolus sends a command to an ack-capable device, the payload includes a correlation envelope:

```json
{
  "action": "on",
  "params": { "speed": 100 },
  "correlationId": "abc-123-def",
  "responseTopic": "aeolus/acks/pump-01"
}
```

Your firmware reads `correlationId` and `responseTopic`, does its work, then publishes the result:

```json
{
  "correlationId": "abc-123-def",
  "success": true
}
```

Or on failure:

```json
{
  "correlationId": "abc-123-def",
  "success": false,
  "error": "relay stuck"
}
```

That's the entire protocol. Aeolus matches the correlation ID back to the pending command and advances it to the `ACKNOWLEDGED` lifecycle state.

### ESP32 example

```cpp
#include <ArduinoJson.h>

void onCommand(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  deserializeJson(doc, payload, length);

  const char* action = doc["action"];
  const char* correlationId = doc["correlationId"];
  const char* responseTopic = doc["responseTopic"];

  // Do the work
  bool ok = executeAction(action, doc["params"]);

  // Ack back (only if correlation was requested)
  if (correlationId && responseTopic) {
    JsonDocument ack;
    ack["correlationId"] = correlationId;
    ack["success"] = ok;
    if (!ok) ack["error"] = "action failed";

    char buffer[256];
    serializeJson(ack, buffer);
    mqtt.publish(responseTopic, buffer);
  }

  // Still publish state normally
  publishState();
}
```

If `correlationId` is absent, the command came without requesting an ack — just handle it normally.

### When to use this

- Fire-and-forget (`dispatch` tier) is fine for lights, notifications, non-critical switches
- State observation (`observed` tier) works when a sensor can confirm the effect — no firmware changes needed
- Direct acknowledgement (`acknowledged` tier) is for when you need the device itself to confirm, and no external sensor can observe the result

Most setups won't need ack. Start with state observation for anything critical, and add ack only where observation isn't practical.

## Further reading

- [Automation runtime](reference/automations.md)
- [MQTT security](security/mqtt.md)
- [Testing](TESTING.md)
- [Roadmap](ROADMAP.md)
