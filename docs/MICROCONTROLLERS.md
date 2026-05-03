# 🔌 Connecting Microcontrollers to Aeolus

Your microcontroller connects to the Mosquitto MQTT broker on the Aeolus Pi (`aeolus.local:1883`), publishes sensor data, and optionally subscribes to command topics to receive instructions. Devices appear in the dashboard automatically — no registration needed.

> **Note:** Aeolus does not currently handle compiling or uploading firmware to your microcontrollers. You'll need the [Arduino IDE](https://www.arduino.cc/en/software), [PlatformIO](https://platformio.org/), or [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/latest/) to flash your boards. OTA firmware management from the Aeolus dashboard is on the [roadmap](ROADMAP.md).

---

## Quick Start — Publish Sensor Data

Connect to the broker and publish a reading. That's it — the device appears in Aeolus instantly.

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

void setup() {
  WiFi.begin("your-wifi-ssid", "your-wifi-password");
  while (WiFi.status() != WL_CONNECTED) delay(500);

  mqtt.setServer("aeolus.local", 1883);
}

void loop() {
  if (!mqtt.connected()) {
    mqtt.connect("my-sensor");
  }
  mqtt.loop();

  // Publish a temperature reading — device auto-registers in Aeolus
  mqtt.publish("sensor/kitchen/temp", "{\"value\":23.5,\"unit\":\"°C\"}");
  delay(5000);
}
```

## Quick Start — Receive Commands

Subscribe to a topic and act on messages from Aeolus automations or the dashboard.

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

#define RELAY_PIN 5
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

void onMessage(char* topic, byte* payload, unsigned int length) {
  String msg = String((char*)payload).substring(0, length);
  if (msg == "{\"action\":\"open\"}")  digitalWrite(RELAY_PIN, HIGH);
  if (msg == "{\"action\":\"close\"}") digitalWrite(RELAY_PIN, LOW);
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  WiFi.begin("your-wifi-ssid", "your-wifi-password");
  while (WiFi.status() != WL_CONNECTED) delay(500);

  mqtt.setServer("aeolus.local", 1883);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (!mqtt.connected()) {
    mqtt.connect("my-actuator");
    mqtt.subscribe("valve/irrigation/command");
  }
  mqtt.loop();
}
```

---

## MQTT Topic Convention

Aeolus accepts **any** MQTT topic structure — every valid topic is parsed, and the device appears in the dashboard automatically. The recommended format is `{type}/{location}/{metric}`, which gives you better auto-generated device names, but it is not required.

| Segment | Purpose | Examples |
|---------|---------|----------|
| `type` | Device category (recommended first segment) | `sensor`, `light`, `switch`, `motion`, `valve`, `climate` |
| `location` | Where the device is | `kitchen`, `garage`, `outdoor`, `tank` |
| `metric` | What's being measured (optional) | `temp`, `humidity`, `level`, `light` |

> **Not required.** The convention above is a recommendation for cleaner device names. Aeolus will parse and accept any topic — single-segment, multi-segment, or with device types it has never seen before.

**Standard examples (recommended format):**

| Topic | Auto-Generated Name |
|-------|---------------------|
| `sensor/kitchen/temp` | Kitchen Temp |
| `sensor/outdoor/humidity` | Outdoor Humidity |
| `light/bedroom` | Bedroom |
| `motion/hallway` | Hallway |
| `sensor/tank/level` | Tank Level |
| `valve/irrigation/command` | Irrigation Command |

**Non-standard examples (also work):**

| Topic | Auto-Generated Name |
|-------|---------------------|
| `thermostat/living/temp` | Thermostat Living Temp |
| `mydevice/room1/status` | Mydevice Room1 Status |
| `heartbeat` | Heartbeat |
| `status` | Status |
| `custom-sensor/zone-a/co2` | Custom-Sensor Zone-A Co2 |

For topics that start with a recognized type (`sensor`, `switch`, `light`, `climate`, `plug`, `valve`, `pump`, `motion`, `fan`, `lock`, `cover`), the type is stripped from the display name. For all other topics, every segment is included in the name. Either way, the device is fully functional.

## Payload Format

Aeolus accepts multiple payload formats:

```json
// JSON object (recommended)
{ "value": 23.5, "unit": "°C" }

// Plain number
23.5

// JSON with multiple fields
{ "temperature": 23.5, "humidity": 61, "battery": 3.2 }

// String
"on"
```

---

## Sending Commands from Aeolus

Once your actuator is subscribed to a command topic, you can send commands from Aeolus in three ways:

### 1. MQTT Inspector (dashboard)

Open the MQTT Inspector pane, type the topic and payload, and hit publish:

- **Topic:** `valve/irrigation/command`
- **Payload:** `{"action": "open"}`

### 2. Automation script

```javascript
automation({
  conditions: [
    function isSoilDry(ctx) {
      return ctx.state.value < 30;
    }
  ],
  actions: [
    function startIrrigation(ctx) {
      mqtt.publish("valve/irrigation/command", JSON.stringify({ action: "open" }));
      log.info("Irrigation started — soil moisture low");
    }
  ]
});
```

### 3. REST API

```bash
curl -X POST http://aeolus.local:3001/api/mqtt/publish \
  -H "Content-Type: application/json" \
  -d '{"topic": "valve/irrigation/command", "message": "{\"action\": \"open\"}"}'
```

---

## Testing Without Hardware

Use the MQTT Inspector in the dashboard to publish test messages, or use `mosquitto_pub` from any machine on your network:

```bash
# Simulate a temperature reading
mosquitto_pub -h aeolus.local -t "sensor/kitchen/temp" -m '{"value": 23.5, "unit": "°C"}'

# Simulate a motion event
mosquitto_pub -h aeolus.local -t "motion/hallway" -m '{"value": true}'
```

---

## Tips

- **Use unique client IDs** — include the MAC address or device name to avoid MQTT connection conflicts
- **Publish state on connect** — actuators should publish their current state when they first connect so the dashboard is accurate
- **Use QoS 0** for sensor data (fire-and-forget) and **QoS 1** for commands (at-least-once delivery)
- **Add a status topic** — actuators should publish their state to a separate topic so Aeolus can track whether the command was executed
- **Handle reconnection** — Wi-Fi and MQTT connections drop; always reconnect in the loop and re-subscribe after reconnecting

---

## Full Example — Sensor + Actuator Combined

A complete, production-style template that reads a DHT22 sensor, publishes readings, listens for commands to control a relay, and handles Wi-Fi/MQTT reconnection properly.

### Required Libraries

Install via Arduino IDE Library Manager or PlatformIO:

| Library | Purpose |
|---------|---------|
| `PubSubClient` | MQTT client (by Nick O'Leary) |
| `DHT sensor library` | DHT11/DHT22 support (by Adafruit) |

For PlatformIO, add to `platformio.ini`:

```ini
[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
lib_deps =
  knolleary/PubSubClient@^2.8
  adafruit/DHT sensor library@^1.4
```

### ESP32 (Arduino framework)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

// ── Configuration ──────────────────────────────────────
const char* WIFI_SSID     = "your-wifi-ssid";
const char* WIFI_PASSWORD = "your-wifi-password";
const char* MQTT_SERVER   = "aeolus.local";
const int   MQTT_PORT     = 1883;

// Topics — follow the {type}/{location}/{metric} convention
const char* TOPIC_TEMP     = "sensor/garden/temp";
const char* TOPIC_HUMIDITY = "sensor/garden/humidity";
const char* TOPIC_MOISTURE = "sensor/garden/moisture";
const char* TOPIC_COMMAND  = "valve/garden/command";
const char* TOPIC_STATUS   = "switch/garden-valve";

// Hardware
#define DHT_PIN      4
#define DHT_TYPE     DHT22
#define RELAY_PIN    5
#define MOISTURE_PIN 34

// ── Globals ────────────────────────────────────────────
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL = 10000;  // 10 seconds

// ── MQTT message handler ───────────────────────────────
void onMessage(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  Serial.printf("Received: %s → %s\n", topic, message.c_str());

  if (message == "{\"action\":\"open\"}") {
    digitalWrite(RELAY_PIN, HIGH);
    mqtt.publish(TOPIC_STATUS, "{\"value\":\"on\"}");
  } else if (message == "{\"action\":\"close\"}") {
    digitalWrite(RELAY_PIN, LOW);
    mqtt.publish(TOPIC_STATUS, "{\"value\":\"off\"}");
  } else if (message == "{\"action\":\"toggle\"}") {
    bool current = digitalRead(RELAY_PIN);
    digitalWrite(RELAY_PIN, !current);
    mqtt.publish(TOPIC_STATUS, !current ? "{\"value\":\"on\"}" : "{\"value\":\"off\"}");
  }
}

// ── WiFi ───────────────────────────────────────────────
void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nConnected — IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── MQTT ───────────────────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("Connecting to MQTT...");
    String clientId = "aeolus-garden-" + String(WiFi.macAddress());
    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" connected");
      mqtt.subscribe(TOPIC_COMMAND);
      // Publish current state on connect
      bool current = digitalRead(RELAY_PIN);
      mqtt.publish(TOPIC_STATUS, current ? "{\"value\":\"on\"}" : "{\"value\":\"off\"}");
    } else {
      Serial.printf(" failed (rc=%d), retrying in 5s\n", mqtt.state());
      delay(5000);
    }
  }
}

// ── Setup ──────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  dht.begin();
  connectWiFi();
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(onMessage);
}

// ── Loop ───────────────────────────────────────────────
void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (millis() - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = millis();

    float temp = dht.readTemperature();
    float humidity = dht.readHumidity();
    int moisture = map(analogRead(MOISTURE_PIN), 4095, 0, 0, 100);

    char payload[64];

    if (!isnan(temp)) {
      snprintf(payload, sizeof(payload), "{\"value\":%.1f,\"unit\":\"°C\"}", temp);
      mqtt.publish(TOPIC_TEMP, payload);
    }
    if (!isnan(humidity)) {
      snprintf(payload, sizeof(payload), "{\"value\":%.1f,\"unit\":\"%%\"}", humidity);
      mqtt.publish(TOPIC_HUMIDITY, payload);
    }
    snprintf(payload, sizeof(payload), "{\"value\":%d,\"unit\":\"%%\"}", moisture);
    mqtt.publish(TOPIC_MOISTURE, payload);
  }
}
```

---

## What's Next

- Browse the [Automation docs](../README.md#automations) to write rules that react to your device data
- Check the [MQTT Inspector](../README.md#dashboard) to see your devices appear in real time
- See the [Roadmap](ROADMAP.md) for upcoming features like OTA firmware updates
