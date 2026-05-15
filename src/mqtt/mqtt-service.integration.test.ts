// Integration tests for MQTT service pipeline
// Verifies that the universal topic parser integrates correctly with the
// event bus and device registry — previously-rejected topics now flow through.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { parseTopic } from "./topic-parser.js";
import { DEVICE_STATE_CHANGE, MQTT_RAW_MESSAGE } from "../core/event-bus.js";
import { DeviceRegistry } from "../core/device-registry.js";
import type { NormalizedEvent } from "../core/types.js";

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Simulate what MqttService.handleMessage does:
 * parse the topic, decode the payload, build a NormalizedEvent, and emit it.
 * This avoids needing an actual MQTT connection while testing the full pipeline.
 */
function simulateHandleMessage(
  eventBus: EventEmitter,
  topic: string,
  payload: string,
): void {
  eventBus.emit(MQTT_RAW_MESSAGE, { topic, payload, timestamp: Date.now() });

  const parsed = parseTopic(topic);
  if (!parsed) {
    return;
  }

  let state: Record<string, unknown>;
  try {
    const jsonValue = JSON.parse(payload);
    if (typeof jsonValue === "object" && jsonValue !== null && !Array.isArray(jsonValue)) {
      state = jsonValue;
    } else {
      state = { value: jsonValue };
    }
  } catch {
    const num = Number(payload);
    if (!isNaN(num) && payload.trim().length > 0) {
      state = { value: num };
    } else if (payload.trim().length > 0) {
      state = { value: payload.trim() };
    } else {
      return;
    }
  }

  const event: NormalizedEvent = {
    deviceId: parsed.deviceId,
    deviceType: parsed.deviceType,
    state,
    topic,
    timestamp: Date.now(),
  };

  eventBus.emit(DEVICE_STATE_CHANGE, event);
}

describe("MQTT Service Integration", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let registry: DeviceRegistry;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT '{}',
      integration TEXT NOT NULL DEFAULT 'mqtt', last_seen INTEGER NOT NULL
    )`);

    eventBus = new EventEmitter();
    registry = new DeviceRegistry(db, eventBus);

    // Wire up the event bus → registry, same as index.ts does in production
    eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
      registry.upsert(event);
    });
  });

  afterEach(() => {
    db.close();
  });

  describe("previously-rejected topics now emit DEVICE_STATE_CHANGE", () => {
    it("thermostat/living emits DEVICE_STATE_CHANGE and stores device", () => {
      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      simulateHandleMessage(eventBus, "thermostat/living", '{"temperature": 72}');

      expect(events.length).toBe(1);
      expect(events[0].deviceId).toBe("thermostat-living");
      expect(events[0].deviceType).toBe("thermostat");
      expect(events[0].state).toEqual({ temperature: 72 });

      const device = registry.getById("thermostat-living");
      expect(device).toBeDefined();
      expect(device!.type).toBe("thermostat");
    });

    it("valve/irrigation/command emits DEVICE_STATE_CHANGE", () => {
      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      simulateHandleMessage(eventBus, "valve/irrigation/command", '{"open": true}');

      expect(events.length).toBe(1);
      expect(events[0].deviceId).toBe("valve-irrigation-command");
      expect(events[0].deviceType).toBe("valve");
    });

    it("pump/well/status emits DEVICE_STATE_CHANGE", () => {
      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      simulateHandleMessage(eventBus, "pump/well/status", '{"running": true}');

      expect(events.length).toBe(1);
      expect(events[0].deviceId).toBe("pump-well-status");
      expect(events[0].deviceType).toBe("pump");
    });

    it("single-segment topic heartbeat emits DEVICE_STATE_CHANGE", () => {
      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      simulateHandleMessage(eventBus, "heartbeat", '{"alive": true}');

      expect(events.length).toBe(1);
      expect(events[0].deviceId).toBe("heartbeat");
      expect(events[0].deviceType).toBe("heartbeat");
    });
  });

  describe("device registry stores devices with novel type strings", () => {
    it("stores a device with type 'thermostat'", () => {
      simulateHandleMessage(eventBus, "thermostat/living", '{"temperature": 72}');

      const device = registry.getById("thermostat-living");
      expect(device).toBeDefined();
      expect(device!.type).toBe("thermostat");
      expect(device!.state).toEqual({ temperature: 72 });
      expect(device!.capabilities).toEqual([]); // unknown type → empty capabilities
    });

    it("stores a device with type 'irrigation'", () => {
      simulateHandleMessage(eventBus, "irrigation/zone1", '{"active": true}');

      const device = registry.getById("irrigation-zone1");
      expect(device).toBeDefined();
      expect(device!.type).toBe("irrigation");
      expect(device!.capabilities).toEqual([]);
    });

    it("stores a device with a known type and infers capabilities", () => {
      simulateHandleMessage(eventBus, "light/kitchen", '{"brightness": 80}');

      const device = registry.getById("light-kitchen");
      expect(device).toBeDefined();
      expect(device!.type).toBe("light");
      expect(device!.capabilities).toEqual(["on/off", "brightness"]);
    });

    it("updates state on subsequent messages for the same device", () => {
      simulateHandleMessage(eventBus, "thermostat/living", '{"temperature": 72}');
      simulateHandleMessage(eventBus, "thermostat/living", '{"humidity": 45}');

      const device = registry.getById("thermostat-living");
      expect(device).toBeDefined();
      expect(device!.state).toEqual({ temperature: 72, humidity: 45 });
    });
  });
});
