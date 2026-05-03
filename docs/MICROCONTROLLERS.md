# 🔌 Connecting Microcontrollers to Aeolus

This guide covers how to connect ESP32 and Arduino microcontrollers to Aeolus via MQTT. Your devices publish sensor data and subscribe to command topics — Aeolus handles everything else.

> **Note:** Aeolus does not currently handle compiling or uploading firmware to your microcontrollers. You'll need the [Arduino IDE](https://www.arduino.cc/en/software), [PlatformIO](https://platformio.org/), or [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/latest/) to flash your boards. OTA firmware management from the Aeolus dashboard is on the [roadmap](ROADMAP.md).

---

## How It Works

```
  [ Your Microcontroller ]              [ Aeolus ]
         │                                  │
         │── publishes to MQTT topic ──────►│── appears in device registry
         │   sensor/kitchen/temp            │── triggers automations
         │                                  │── shows on dashboard
         │                                  │
         │◄── subscribes to MQTT topic ─────│── automation sends command
         │   valve/irrigation/command        │── dashboard button press
         │                                  │── API call
```

Your microcontroller connects to the Mosquitto MQTT broker running on the Aeolus Pi (`aeolus.local:1883`). It publishes sensor readings to topics, and optionally subscribes to command topics to receive instructions from Aeolus automations.

Aeolus auto-discovers devices from MQTT messages — no registration or configuration needed. The first message on a new topic creates the device in the registry automatically.

---

## MQTT Topic Convention

Aeolus parses topics using the format `{type}/{location}/{metric}`:

| Segment | Purpose | Examples |
|---------|---------|----------|
| `type` | Device category — determines icon and capabilities | `sensor`, `light`, `switch`, `motion` |
| `location` | Where the device is | `kitchen`, `garage`, `outdoor`, `tank` |
| `metric` | What's being measured (optional) | `temp`, `humidity`, `level`, `light` |

**Examples:**

| Topic | Device ID | Device Type |
|-------|-----------|-------------|
| `sensor/kitchen/temp` | `sensor-kitchen-temp` | sensor |
| `sensor/outdoor/humidity` | `sensor-outdoor-humidity` | sensor |
| `light/bedroom` | `light-bedroom` | light |
| `switch/desk` | `switch-desk` | switch |
| `motion/hallway` | `motion-hallway` | sensor |
| `sensor/tank/level` | `sensor-tank-level` | sensor |

---

## Payload Format

Aeolus accepts multiple payload formats. JSON objects are recommended for structured data, but simple values work too.

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

## Template: Sensor (Publishing Data)

This template reads a DHT22 temperature/humidity sensor and publishes to Aeolus every 5 seconds. Use this as a starting point for any device that sends data.

### ESP32 (Arduino framework)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

// ── Configuration ──────────────────────────────────────
const char* WIFI_SSID     = "your-wifi-ssid";
const char* WIFI_PASSWORD = "your-wifi-password";
const char* MQTT_SERVER   = "aeolus.local";  // or your Pi's IP: 192.168.0.40
const int   MQTT_PORT     = 1883;

// Topics — follow the {type}/{location}/{metric} convention
const char* TOPIC_TEMP     = "sensor/kitchen/temp";
const char* TOPIC_HUMIDITY = "sensor/kitchen/humidity";

// Hardware
#define DHT_PIN  4
#define DHT_TYPE DHT22

// ── Globals ────────────────────────────────────────────
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL = 5000;  // 5 seconds

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
    // Use a unique client ID (e.g. based on MAC address)
    String clientId = "aeolus-kitchen-" + String(WiFi.macAddress());
    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" connected");
    } else {
      Serial.printf(" failed (rc=%d), retrying in 5s\n", mqtt.state());
      delay(5000);
    }
  }
}

// ── Setup ──────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  dht.begin();
  connectWiFi();
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
}

// ── Loop ───────────────────────────────────────────────
void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (millis() - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = millis();

    float temp = dht.readTemperature();
    float humidity = dht.readHumidity();

    if (!isnan(temp)) {
      // Publish as JSON — Aeolus parses this automatically
      char payload[64];
      snprintf(payload, sizeof(payload), "{\"value\":%.1f,\"unit\":\"°C\"}", temp);
      mqtt.publish(TOPIC_TEMP, payload);
      Serial.printf("Published: %s → %s\n", TOPIC_TEMP, payload);
    }

    if (!isnan(humidity)) {
      char payload[64];
      snprintf(payload, sizeof(payload), "{\"value\":%.1f,\"unit\":\"%%\"}", humidity);
      mqtt.publish(TOPIC_HUMIDITY, payload);
      Serial.printf("Published: %s → %s\n", TOPIC_HUMIDITY, payload);
    }
  }
}
```

### Required Libraries

Install these in the Arduino IDE Library Manager or `platformio.ini`:

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

---

## Template: Actuator (Receiving Commands)

This template listens for commands from Aeolus and controls a relay (e.g. a solenoid valve, pump, or light). Use this for any device that needs to act on instructions.

### ESP32 (Arduino framework)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

// ── Configuration ──────────────────────────────────────
const char* WIFI_SSID     = "your-wifi-ssid";
const char* WIFI_PASSWORD = "your-wifi-password";
const char* MQTT_SERVER   = "aeolus.local";
const int   MQTT_PORT     = 1883;

// Topics
const char* TOPIC_COMMAND = "valve/irrigation/command";  // subscribe to this
const char* TOPIC_STATUS  = "switch/irrigation";         // publish state back

// Hardware
#define RELAY_PIN 5

// ── Globals ────────────────────────────────────────────
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// ── MQTT message handler ───────────────────────────────
void onMessage(char* topic, byte* payload, unsigned int length) {
  // Parse the incoming command
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.printf("Received: %s → %s\n", topic, message.c_str());

  // Act on the command
  if (message == "open" || message == "{\"action\":\"open\"}") {
    digitalWrite(RELAY_PIN, HIGH);
    mqtt.publish(TOPIC_STATUS, "{\"value\":\"on\"}");
    Serial.println("Valve OPENED");
  }
  else if (message == "close" || message == "{\"action\":\"close\"}") {
    digitalWrite(RELAY_PIN, LOW);
    mqtt.publish(TOPIC_STATUS, "{\"value\":\"off\"}");
    Serial.println("Valve CLOSED");
  }
  else if (message == "toggle" || message == "{\"action\":\"toggle\"}") {
    bool current = digitalRead(RELAY_PIN);
    digitalWrite(RELAY_PIN, !current);
    mqtt.publish(TOPIC_STATUS, !current ? "{\"value\":\"on\"}" : "{\"value\":\"off\"}");
    Serial.printf("Valve TOGGLED → %s\n", !current ? "OPEN" : "CLOSED");
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
    String clientId = "aeolus-irrigation-" + String(WiFi.macAddress());
    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" connected");
      mqtt.subscribe(TOPIC_COMMAND);
      Serial.printf("Subscribed to: %s\n", TOPIC_COMMAND);
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
  connectWiFi();
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(onMessage);
}

// ── Loop ───────────────────────────────────────────────
void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();
}
```

---

## Template: Combined (Sensor + Actuator)

Many real devices do both — read sensors and act on commands. This template combines both patterns: it publishes soil moisture readings and listens for irrigation commands.

### ESP32 (Arduino framework)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

// ── Configuration ──────────────────────────────────────
const char* WIFI_SSID     = "your-wifi-ssid";
const char* WIFI_PASSWORD = "your-wifi-password";
const char* MQTT_SERVER   = "aeolus.local";
const int   MQTT_PORT     = 1883;

// Topics
const char* TOPIC_MOISTURE = "sensor/garden/moisture";    // publish readings
const char* TOPIC_COMMAND  = "valve/garden/command";       // subscribe to commands
const char* TOPIC_STATUS   = "switch/garden-valve";        // publish valve state

// Hardware
#define MOISTURE_PIN 34   // analog input
#define RELAY_PIN    5    // solenoid valve

// ── Globals ────────────────────────────────────────────
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL = 10000;  // 10 seconds

void onMessage(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  if (message == "open" || message == "{\"action\":\"open\"}") {
    digitalWrite(RELAY_PIN, HIGH);
    mqtt.publish(TOPIC_STATUS, "{\"value\":\"on\"}");
  } else if (message == "close" || message == "{\"action\":\"close\"}") {
    digitalWrite(RELAY_PIN, LOW);
    mqtt.publish(TOPIC_STATUS, "{\"value\":\"off\"}");
  }
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void connectMQTT() {
  while (!mqtt.connected()) {
    String clientId = "aeolus-garden-" + String(WiFi.macAddress());
    if (mqtt.connect(clientId.c_str())) {
      mqtt.subscribe(TOPIC_COMMAND);
    } else {
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  connectWiFi();
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (millis() - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = millis();
    int raw = analogRead(MOISTURE_PIN);
    int percent = map(raw, 4095, 0, 0, 100);  // dry=4095, wet=0
    char payload[64];
    snprintf(payload, sizeof(payload), "{\"value\":%d,\"unit\":\"%%\"}", percent);
    mqtt.publish(TOPIC_MOISTURE, payload);
  }
}
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
// In the automation Logic tab
automation({
  conditions: [
    function isSoilDry(ctx) {
      return ctx.state.value < 30;  // moisture below 30%
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

You don't need a physical microcontroller to test. Use the MQTT Inspector in the Aeolus dashboard to publish test messages manually, or use `mosquitto_pub` from any machine on your network:

```bash
# Simulate a temperature reading
mosquitto_pub -h aeolus.local -t "sensor/kitchen/temp" -m '{"value": 23.5, "unit": "°C"}'

# Simulate a motion event
mosquitto_pub -h aeolus.local -t "motion/hallway" -m '{"value": true}'
```

The device will appear in the Aeolus dashboard immediately.

---

## Tips

- **Use unique client IDs** — include the MAC address or device name to avoid MQTT connection conflicts
- **Publish state on connect** — actuators should publish their current state when they first connect so the dashboard is accurate
- **Keep payloads small** — MQTT is designed for lightweight messages; avoid sending large blobs
- **Use QoS 0** for sensor data (fire-and-forget is fine for periodic readings) and **QoS 1** for commands (at-least-once delivery matters for actuators)
- **Add a status topic** — actuators should publish their state to a separate topic so Aeolus can track whether the command was executed
- **Handle reconnection** — Wi-Fi and MQTT connections drop; always reconnect in the loop and re-subscribe to topics after reconnecting

---

## What's Next

- Browse the [Automation docs](../README.md#automations) to write rules that react to your device data
- Check the [MQTT Inspector](../README.md#dashboard) to see your devices appear in real time
- See the [Roadmap](ROADMAP.md) for upcoming features like OTA firmware updates and device provisioning
