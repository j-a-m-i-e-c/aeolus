// src/core/device-registry.test.ts — Unit tests for DeviceRegistry uncovered paths

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import { DeviceRegistry, deserializeDevice } from "./device-registry.js";
import { initSchema } from "../db/database.js";
import type { Device } from "./types.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("DeviceRegistry — unit tests", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let registry: DeviceRegistry;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    eventBus = new EventEmitter();
    registry = new DeviceRegistry(db, eventBus);
    registry.loadFromDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("remove", () => {
    it("removes an existing device and returns true", () => {
      registry.upsert({
        deviceId: "test-device",
        deviceType: "sensor",
        state: { temperature: 22 },
        topic: "home/test-device",
        timestamp: Date.now(),
      });
      expect(registry.size).toBe(1);
      const result = registry.remove("test-device");
      expect(result).toBe(true);
      expect(registry.size).toBe(0);
      expect(registry.getById("test-device")).toBeUndefined();
    });

    it("returns false for non-existent device", () => {
      const result = registry.remove("nonexistent");
      expect(result).toBe(false);
    });

    it("removes device from database", () => {
      registry.upsert({
        deviceId: "db-device",
        deviceType: "light",
        state: { on: true },
        topic: "home/db-device",
        timestamp: Date.now(),
      });
      registry.remove("db-device");
      const row = db.prepare("SELECT * FROM devices WHERE id = ?").get("db-device");
      expect(row).toBeUndefined();
    });
  });

  describe("registerDevice", () => {
    it("registers a device directly", () => {
      const device: Device = {
        id: "direct-device",
        name: "Direct Device",
        type: "light",
        capabilities: ["on/off", "brightness"],
        state: { on: true },
        integration: "hue",
        lastSeen: Date.now(),
      };
      registry.registerDevice(device);
      expect(registry.getById("direct-device")).toEqual(device);
      expect(registry.size).toBe(1);
    });

    it("persists registered device to database", () => {
      const device: Device = {
        id: "persist-device",
        name: "Persist Device",
        type: "sensor",
        capabilities: ["temperature"],
        state: { temperature: 20 },
        integration: "mqtt",
        lastSeen: Date.now(),
      };
      registry.registerDevice(device);
      const row = db.prepare("SELECT * FROM devices WHERE id = ?").get("persist-device");
      expect(row).toBeDefined();
    });
  });

  describe("upsert — name derivation", () => {
    it("derives name from device ID when name is not provided", () => {
      registry.upsert({
        deviceId: "sensor-living-room",
        deviceType: "sensor",
        state: { temperature: 22 },
        topic: "home/sensor-living-room",
        timestamp: Date.now(),
      });
      const device = registry.getById("sensor-living-room");
      expect(device!.name).toBe("Living Room");
    });

    it("uses raw deviceId when no segments after first", () => {
      registry.upsert({
        deviceId: "standalone",
        deviceType: "sensor",
        state: { value: 1 },
        topic: "home/standalone",
        timestamp: Date.now(),
      });
      const device = registry.getById("standalone");
      expect(device!.name).toBe("standalone");
    });

    it("uses provided name when available", () => {
      registry.upsert({
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 22 },
        topic: "home/sensor-1",
        timestamp: Date.now(),
        name: "Custom Name",
      });
      const device = registry.getById("sensor-1");
      expect(device!.name).toBe("Custom Name");
    });
  });

  describe("upsert — capability inference", () => {
    const testCases: Array<{ type: string; expected: string[] }> = [
      { type: "light", expected: ["on/off", "brightness"] },
      { type: "switch", expected: ["on/off"] },
      { type: "sensor", expected: ["temperature"] },
      { type: "climate", expected: ["temperature", "humidity"] },
      { type: "plug", expected: ["on/off", "energy-monitoring"] },
      { type: "valve", expected: ["on/off"] },
      { type: "pump", expected: ["on/off"] },
      { type: "fan", expected: ["on/off", "speed"] },
      { type: "lock", expected: ["lock/unlock"] },
      { type: "motion", expected: ["motion-detection"] },
      { type: "unknown-type", expected: [] },
    ];

    for (const { type, expected } of testCases) {
      it(`infers capabilities for type "${type}"`, () => {
        registry.upsert({
          deviceId: `${type}-1`,
          deviceType: type,
          state: { value: 1 },
          topic: `home/${type}-1`,
          timestamp: Date.now(),
        });
        const device = registry.getById(`${type}-1`);
        expect(device!.capabilities).toEqual(expected);
      });
    }
  });

  describe("upsert — state merging on update", () => {
    it("merges state on update (preserves existing keys)", () => {
      registry.upsert({
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 22, humidity: 50 },
        topic: "home/sensor-1",
        timestamp: Date.now(),
      });
      registry.upsert({
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 25 },
        topic: "home/sensor-1",
        timestamp: Date.now(),
      });
      const device = registry.getById("sensor-1");
      expect(device!.state.temperature).toBe(25);
      expect(device!.state.humidity).toBe(50);
    });

    it("emits WS_STATE_CHANGE event on upsert", () => {
      const handler = vi.fn();
      eventBus.on("ws:state-change", handler);
      registry.upsert({
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 22 },
        topic: "home/sensor-1",
        timestamp: Date.now(),
      });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        deviceId: "sensor-1",
        state: { temperature: 22 },
      }));
    });
  });

  describe("MQTT source topics", () => {
    it("persists the exact MQTT state topic and restores it after restart", () => {
      registry.upsert({
        deviceId: "pump-well-state",
        deviceType: "pump",
        state: { running: true },
        topic: "pump/well/state",
        timestamp: Date.now(),
      });

      const stored = db.prepare(
        "SELECT topic FROM devices WHERE id = ?",
      ).get("pump-well-state") as { topic: string };
      expect(stored.topic).toBe("pump/well/state");

      const afterRestart = new DeviceRegistry(db, eventBus);
      afterRestart.loadFromDb();
      expect(afterRestart.getByMqttTopic("pump/well/state")).toMatchObject({
        id: "pump-well-state",
        topic: "pump/well/state",
      });
    });

    it("keeps both topics when their legacy topic slugs collide", () => {
      const first = registry.upsert({
        deviceId: "a-b-c",
        deviceType: "sensor",
        state: { value: 1 },
        topic: "a/b-c",
        timestamp: Date.now(),
      });
      const second = registry.upsert({
        deviceId: "a-b-c",
        deviceType: "sensor",
        state: { value: 2 },
        topic: "a-b/c",
        timestamp: Date.now(),
      });

      expect(first.id).toBe("a-b-c");
      expect(second.id).toMatch(/^mqtt-a-b-c-[a-f0-9]{12}$/);
      expect(second.id).not.toBe(first.id);
      expect(registry.getByMqttTopic("a/b-c")?.state).toEqual({ value: 1 });
      expect(registry.getByMqttTopic("a-b/c")?.state).toEqual({ value: 2 });

      registry.upsert({
        deviceId: "a-b-c",
        deviceType: "sensor",
        state: { battery: 80 },
        topic: "a-b/c",
        timestamp: Date.now(),
      });
      expect(registry.getById(second.id)?.state).toEqual({ value: 2, battery: 80 });
      expect(registry.size).toBe(2);
    });

    it("preserves an explicit MQTT command topic", () => {
      registry.registerDevice({
        id: "pump-well",
        name: "Well Pump",
        type: "pump",
        capabilities: ["on/off"],
        state: {},
        integration: "mqtt",
        lastSeen: Date.now(),
        topic: "pump/well/state",
        commandTopic: "pump/well/command",
      });

      const afterRestart = new DeviceRegistry(db, eventBus);
      afterRestart.loadFromDb();
      expect(afterRestart.getByMqttTopic("pump/well/state")?.commandTopic)
        .toBe("pump/well/command");
    });
  });

  describe("loadFromDb", () => {
    it("loads persisted devices on startup", () => {
      // Insert a device directly into the database
      db.prepare(
        "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("preloaded", "Preloaded", "sensor", '["temperature"]', '{"temp":20}', "mqtt", Date.now());

      const newRegistry = new DeviceRegistry(db, eventBus);
      newRegistry.loadFromDb();
      expect(newRegistry.size).toBe(1);
      expect(newRegistry.getById("preloaded")).toBeDefined();
      expect(newRegistry.getById("preloaded")!.name).toBe("Preloaded");
    });

    it("skips malformed rows", () => {
      // Insert a malformed row
      db.prepare(
        "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("bad", "Bad", "sensor", "not-json[[[", '{}', "mqtt", Date.now());

      const newRegistry = new DeviceRegistry(db, eventBus);
      newRegistry.loadFromDb();
      expect(newRegistry.size).toBe(0);
    });
  });

  describe("deserializeDevice", () => {
    it("returns null for null input", () => {
      expect(deserializeDevice(null as any)).toBeNull();
    });

    it("returns null when id is not a string", () => {
      expect(deserializeDevice({ id: 123, name: "test" } as any)).toBeNull();
    });

    it("returns null when name is not a string", () => {
      expect(deserializeDevice({ id: "test", name: 123 } as any)).toBeNull();
    });

    it("defaults integration to mqtt when missing", () => {
      const result = deserializeDevice({
        id: "test",
        name: "Test",
        type: "sensor",
        capabilities: "[]",
        state: "{}",
        integration: "",
        last_seen: Date.now(),
      });
      expect(result!.integration).toBe("mqtt");
    });
  });
});
