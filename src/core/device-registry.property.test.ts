// Feature: mqtt-topic-overhaul, Property 8: Registry Accepts Any Device Type
// Feature: mvp-core-platform, Property 4: Device Registry Upsert Invariant
// Feature: mvp-core-platform, Property 20: Device Serialization Round-Trip
// Feature: mvp-core-platform, Property 21: Malformed JSON Deserialization Safety
import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { serializeDevice, deserializeDevice, DeviceRegistry } from "./device-registry.js";
import type { NormalizedEvent, DeviceType } from "./types.js";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const deviceTypeArb = fc.constantFrom<DeviceType>("light", "sensor", "switch", "climate");
const deviceArb = fc.record({
  id: fc.stringMatching(/^[a-z][a-z0-9-]{1,30}$/),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  type: deviceTypeArb,
  capabilities: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
  state: fc.dictionary(fc.stringMatching(/^[a-z]+$/), fc.oneof(fc.integer(), fc.boolean(), fc.string({ maxLength: 20 }))),
  integration: fc.stringMatching(/^[a-z]+$/),
  lastSeen: fc.nat({ max: 2000000000000 }),
});

describe("Property: Device Serialization Round-Trip", () => {
  test.prop([deviceArb])(
    "serialize then deserialize is identity",
    (device) => {
      const serialized = serializeDevice(device);
      const row: Record<string, unknown> = {
        id: serialized.id,
        name: serialized.name,
        type: serialized.type,
        capabilities: serialized.capabilities,
        state: serialized.state,
        integration: serialized.integration,
        last_seen: serialized.last_seen,
      };
      const result = deserializeDevice(row);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(device.id);
      expect(result!.name).toBe(device.name);
      expect(result!.type).toBe(device.type);
      expect(result!.capabilities).toEqual(device.capabilities);
      expect(result!.state).toEqual(device.state);
      expect(result!.integration).toBe(device.integration);
      expect(result!.lastSeen).toBe(device.lastSeen);
    }
  );
});

describe("Property: Malformed JSON Deserialization Safety", () => {
  test.prop([fc.string()])(
    "malformed data returns null without throwing",
    (garbage) => {
      const result = deserializeDevice({ id: garbage, name: null as any, capabilities: "not json[" });
      // Should either return null or a valid device — never throw
      expect(result === null || typeof result === "object").toBe(true);
    }
  );
});

describe("Property: Device Registry Upsert Invariant", () => {
  const eventArb = fc.record({
    deviceId: fc.stringMatching(/^[a-z]+-[a-z]+$/),
    deviceType: deviceTypeArb,
    state: fc.dictionary(fc.stringMatching(/^[a-z]+$/), fc.oneof(fc.integer(), fc.boolean())),
    topic: fc.stringMatching(/^[a-z]+\/[a-z]+$/),
    timestamp: fc.nat({ max: 2000000000000 }),
  });

  test.prop([fc.array(eventArb, { minLength: 1, maxLength: 10 })])(
    "upsert creates new devices and updates existing ones correctly",
    (events) => {
      const db = new Database(":memory:");
      db.exec(`CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT '{}',
        integration TEXT NOT NULL DEFAULT 'mqtt', last_seen INTEGER NOT NULL
      )`);
      const bus = new EventEmitter();
      const registry = new DeviceRegistry(db, bus);

      const seenIds = new Set<string>();
      for (const event of events) {
        const sizeBefore = registry.size;
        const isNew = !seenIds.has(event.deviceId);
        seenIds.add(event.deviceId);

        registry.upsert(event as NormalizedEvent);

        if (isNew) {
          expect(registry.size).toBe(sizeBefore + 1);
        } else {
          expect(registry.size).toBe(sizeBefore);
        }

        const device = registry.getById(event.deviceId);
        expect(device).toBeDefined();
        // State should contain the event's state values
        for (const [key, value] of Object.entries(event.state)) {
          expect(device!.state[key]).toBe(value);
        }
      }

      expect(registry.size).toBe(seenIds.size);
      db.close();
    }
  );
});

// --- Property 8: Registry Accepts Any Device Type ---
// **Validates: Requirements 4.2, 4.3**
describe("Feature: mqtt-topic-overhaul — Property 8: Registry Accepts Any Device Type", () => {
  /** Arbitrary non-empty device type string (any printable chars, 1–30 length) */
  const deviceTypeStringArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,30}$/);

  test.prop([deviceTypeStringArb, fc.stringMatching(/^[a-z]+-[a-z]+$/)], { numRuns: 100 })(
    "Property 8: Registry stores any device type and retrieves it with the exact type string",
    (deviceType, deviceId) => {
      const db = new Database(":memory:");
      db.exec(`CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT '{}',
        integration TEXT NOT NULL DEFAULT 'mqtt', last_seen INTEGER NOT NULL
      )`);
      const bus = new EventEmitter();
      const registry = new DeviceRegistry(db, bus);

      const event: NormalizedEvent = {
        deviceId,
        deviceType,
        state: { value: 42 },
        topic: `${deviceType}/${deviceId}`,
        timestamp: Date.now(),
      };

      registry.upsert(event);

      const device = registry.getById(deviceId);
      expect(device).toBeDefined();
      expect(device!.type).toBe(deviceType);
      expect(device!.id).toBe(deviceId);

      db.close();
    }
  );
});
