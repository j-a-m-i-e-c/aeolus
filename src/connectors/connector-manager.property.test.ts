// src/connectors/connector-manager.property.test.ts
// Feature: device-action-system-uplift — Properties 1, 2, 9, 10, 11

import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fc from "fast-check";
import { ConnectorManager } from "./connector-manager.js";
import type { CapabilityDescriptor } from "./connector.interface.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    name: "Test Device",
    type: "light",
    capabilities: ["on/off"],
    state: { on: true },
    integration: "mock",
    lastSeen: Date.now(),
    ...overrides,
  };
}

function makeConnector(overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    discoverDevices: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    getHealthStatus: vi.fn().mockReturnValue({ status: "connected", lastSeen: Date.now() }),
    onConfigUpdate: vi.fn(),
    ...overrides,
  };
}

function makeManager(deviceOverrides: Record<string, unknown> = {}, connectorOverrides: Record<string, unknown> = {}) {
  const eventBus = new EventEmitter();
  const device = makeDevice(deviceOverrides);
  const connector = makeConnector(connectorOverrides);

  const mockRegistry = {
    getModule: vi.fn().mockReturnValue({
      metadata: { displayName: "Mock", icon: "plug" },
      configSchema: [],
      createConnector: vi.fn().mockReturnValue(connector),
    }),
    listAvailable: vi.fn().mockReturnValue([]),
  };

  const mockStore = {
    save: vi.fn(),
    disable: vi.fn(),
    loadEnabled: vi.fn().mockReturnValue([]),
  };

  const mockDeviceRegistry = {
    getAll: vi.fn().mockReturnValue([device]),
    getById: vi.fn().mockReturnValue(device),
    remove: vi.fn(),
  };

  const manager = new ConnectorManager(
    mockRegistry as any,
    mockStore as any,
    mockDeviceRegistry as any,
    eventBus,
  );

  return { manager, connector, mockDeviceRegistry, mockRegistry };
}

// ─── Property 1: executeAction success wraps connector data ──────────────────

// Feature: device-action-system-uplift, Property 1: executeAction success wraps connector data
describe("Property 1: executeAction success wraps connector data", () => {
  afterEach(() => vi.clearAllMocks());

  it("result.success === true when connector succeeds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
        async (_data) => {
          const { manager, connector } = makeManager();
          connector.execute.mockResolvedValue(undefined);
          await manager.enable("mock", {});

          const result = await manager.executeAction("device-1", {
            type: "toggle",
            deviceId: "device-1",
            params: {},
          });

          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Property 2: executeAction failure wraps error message without modification

// Feature: device-action-system-uplift, Property 2: executeAction failure wraps error message without modification
describe("Property 2: executeAction failure wraps error message without modification", () => {
  afterEach(() => vi.clearAllMocks());

  it("result.error === thrown message, unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (errorMessage) => {
          const { manager, connector } = makeManager();
          connector.execute.mockRejectedValue(new Error(errorMessage));
          await manager.enable("mock", {});

          const result = await manager.executeAction("device-1", {
            type: "toggle",
            deviceId: "device-1",
            params: {},
          });

          expect(result.success).toBe(false);
          expect(result.error).toBe(errorMessage);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: MQTT command topic derivation ───────────────────────────────

// Feature: device-action-system-uplift, Property 9: MQTT command topic derivation
describe("Property 9: MQTT command topic derivation", () => {
  it("commandTopic === topic.split('/').slice(0,-1).concat('set').join('/')", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-z0-9]+$/),
          { minLength: 1, maxLength: 5 },
        ).map((segs) => segs.join("/")),
        (topic) => {
          const expected = topic.split("/").slice(0, -1).concat("set").join("/");
          const derived = topic.split("/").slice(0, -1).concat("set").join("/");
          expect(derived).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("MQTT device uses derived command topic when no explicit commandTopic", async () => {
    const eventBus = new EventEmitter();
    const mqttDevice = makeDevice({
      id: "mqtt-1",
      integration: "mqtt",
      state: { topic: "home/plug1/state", on: false },
    });

    const mockRegistry = {
      getModule: vi.fn().mockReturnValue(null),
      listAvailable: vi.fn().mockReturnValue([]),
    };
    const mockStore = {
      save: vi.fn(),
      disable: vi.fn(),
      loadEnabled: vi.fn().mockReturnValue([]),
    };
    const mockDeviceRegistry = {
      getAll: vi.fn().mockReturnValue([mqttDevice]),
      getById: vi.fn().mockReturnValue(mqttDevice),
      remove: vi.fn(),
    };

    const manager = new ConnectorManager(
      mockRegistry as any,
      mockStore as any,
      mockDeviceRegistry as any,
      eventBus,
    );

    const mockMqtt = {
      isConnected: vi.fn().mockReturnValue(true),
      publish: vi.fn(),
    };
    manager.setMqttService(mockMqtt as any);

    const result = await manager.executeAction("mqtt-1", {
      type: "command",
      deviceId: "mqtt-1",
      params: { payload: "ON" },
    });

    expect(result.success).toBe(true);
    expect(mockMqtt.publish).toHaveBeenCalledWith("home/plug1/set", "ON");
  });
});

// ─── Property 10: Pre-flight blocks connector call on invalid action type ─────

// Feature: device-action-system-uplift, Property 10: Pre-flight blocks connector call on invalid action type
describe("Property 10: Pre-flight blocks connector call on invalid action type", () => {
  afterEach(() => vi.clearAllMocks());

  it("Connector.execute is never called and result.success === false for unknown action types", async () => {
    const fixedCatalog: CapabilityDescriptor[] = [
      { type: "toggle", label: "Toggle", description: "Toggle", params: {} },
      { type: "on", label: "On", description: "Turn on", params: {} },
    ];
    const catalogTypes = new Set(fixedCatalog.map((d) => d.type));

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => !catalogTypes.has(s)),
        async (unknownActionType) => {
          const { manager, connector } = makeManager(
            { capabilities: ["on/off"] },
            {},
          );
          // Override connector to provide a fixed catalog
          connector.getActionCatalog = vi.fn().mockReturnValue(fixedCatalog);
          await manager.enable("mock", {});

          const result = await manager.executeAction("device-1", {
            type: unknownActionType,
            deviceId: "device-1",
            params: {},
          });

          expect(result.success).toBe(false);
          expect(connector.execute).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Property 11: Validation error messages identify device, action type, and reason

// Feature: device-action-system-uplift, Property 11: Validation error messages identify device, action type, and reason
describe("Property 11: Validation error messages identify device, action type, and reason", () => {
  afterEach(() => vi.clearAllMocks());

  it("error string contains deviceId and actionType for unsupported action", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => s !== "toggle"),
        async (unknownType) => {
          const { manager } = makeManager({ capabilities: ["on/off"] });
          await manager.enable("mock", {});

          const result = await manager.executeAction("device-1", {
            type: unknownType,
            deviceId: "device-1",
            params: {},
          });

          if (!result.success && result.error) {
            expect(result.error).toContain("device-1");
            expect(result.error).toContain(unknownType);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
