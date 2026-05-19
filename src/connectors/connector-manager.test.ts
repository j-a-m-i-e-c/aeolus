// src/connectors/connector-manager.test.ts — Unit tests for ConnectorManager lifecycle

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ConnectorManager } from "./connector-manager.js";
import { DEVICE_STATE_CHANGE, CONNECTOR_POLL, CONNECTOR_ERROR } from "../core/event-bus.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockConnector(overrides?: Partial<any>) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    discoverDevices: vi.fn().mockResolvedValue([
      { id: "device-1", type: "light", state: { on: true }, integration: "mock", lastSeen: Date.now(), capabilities: [] },
    ]),
    execute: vi.fn().mockResolvedValue(undefined),
    getHealthStatus: vi.fn().mockReturnValue({ status: "connected", lastActivity: Date.now() }),
    onConfigUpdate: vi.fn(),
    getSetupSteps: vi.fn().mockReturnValue([]),
    executeSetupStep: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function createMockRegistry(connector = createMockConnector()) {
  return {
    getModule: vi.fn().mockReturnValue({
      metadata: { displayName: "Mock Connector", icon: "plug" },
      configSchema: [],
      createConnector: vi.fn().mockReturnValue(connector),
      actionHandlers: undefined,
      conditions: undefined,
    }),
    listAvailable: vi.fn().mockReturnValue([]),
  };
}

function createMockStore() {
  return {
    save: vi.fn(),
    disable: vi.fn(),
    loadEnabled: vi.fn().mockReturnValue([]),
    loadAll: vi.fn().mockReturnValue([]),
  };
}

function createMockDeviceRegistry() {
  return {
    getAll: vi.fn().mockReturnValue([]),
    getById: vi.fn().mockReturnValue(null),
    remove: vi.fn(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ConnectorManager", () => {
  let eventBus: EventEmitter;
  let manager: ConnectorManager;
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let mockStore: ReturnType<typeof createMockStore>;
  let mockDeviceRegistry: ReturnType<typeof createMockDeviceRegistry>;
  let mockConnector: ReturnType<typeof createMockConnector>;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventEmitter();
    mockConnector = createMockConnector();
    mockRegistry = createMockRegistry(mockConnector);
    mockStore = createMockStore();
    mockDeviceRegistry = createMockDeviceRegistry();
    manager = new ConnectorManager(
      mockRegistry as any,
      mockStore as any,
      mockDeviceRegistry as any,
      eventBus,
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    await manager.disposeAll();
  });

  describe("enable", () => {
    it("creates connector, connects, discovers devices, and returns instance ID", async () => {
      const id = await manager.enable("mock", { host: "192.168.1.1" });

      expect(id).toBeDefined();
      expect(mockConnector.connect).toHaveBeenCalled();
      expect(mockConnector.discoverDevices).toHaveBeenCalled();
      expect(mockStore.save).toHaveBeenCalled();
    });

    it("emits DEVICE_STATE_CHANGE for discovered devices", async () => {
      const events: any[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (e) => events.push(e));

      await manager.enable("mock", {});

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].deviceId).toBe("device-1");
      expect(events[0].integration).toBe("mock");
    });

    it("throws when connector type not found in registry", async () => {
      mockRegistry.getModule.mockReturnValue(null);
      await expect(manager.enable("unknown", {})).rejects.toThrow("not found");
    });

    it("handles connect failure gracefully", async () => {
      mockConnector.connect.mockRejectedValue(new Error("connection refused"));
      // Should not throw — just logs the error
      const id = await manager.enable("mock", {});
      expect(id).toBeDefined();
    });

    it("handles discoverDevices failure gracefully", async () => {
      mockConnector.discoverDevices.mockRejectedValue(new Error("timeout"));
      const id = await manager.enable("mock", {});
      expect(id).toBeDefined();
    });

    it("registers action handlers from module", async () => {
      const mockExecutor = { registerHandler: vi.fn(), unregisterHandler: vi.fn() };
      const mockConditionReg = { registerCondition: vi.fn(), unregisterCondition: vi.fn() };
      manager.setRegistries(mockExecutor as any, mockConditionReg as any);

      mockRegistry.getModule.mockReturnValue({
        metadata: { displayName: "Test", icon: "plug" },
        configSchema: [],
        createConnector: vi.fn().mockReturnValue(mockConnector),
        actionHandlers: { custom_action: vi.fn() },
        conditions: { custom_condition: vi.fn() },
      });

      await manager.enable("mock", {});
      expect(mockExecutor.registerHandler).toHaveBeenCalledWith("custom_action", expect.any(Function));
      expect(mockConditionReg.registerCondition).toHaveBeenCalledWith("custom_condition", expect.any(Function));
    });
  });

  describe("disable", () => {
    it("stops polling, disconnects, disposes, and updates store", async () => {
      const id = await manager.enable("mock", {});
      await manager.disable(id);

      expect(mockConnector.disconnect).toHaveBeenCalled();
      expect(mockConnector.dispose).toHaveBeenCalled();
      expect(mockStore.disable).toHaveBeenCalledWith(id);
    });

    it("removes devices from device registry", async () => {
      mockDeviceRegistry.getAll.mockReturnValue([
        { id: "device-1", integration: "mock" },
        { id: "device-2", integration: "other" },
      ]);

      const id = await manager.enable("mock", {});
      await manager.disable(id);

      expect(mockDeviceRegistry.remove).toHaveBeenCalledWith("device-1");
      expect(mockDeviceRegistry.remove).not.toHaveBeenCalledWith("device-2");
    });

    it("throws when instance not found", async () => {
      await expect(manager.disable("nonexistent")).rejects.toThrow("not found");
    });

    it("handles disconnect error gracefully", async () => {
      mockConnector.disconnect.mockRejectedValue(new Error("already closed"));
      const id = await manager.enable("mock", {});
      // Should not throw
      await manager.disable(id);
    });

    it("unregisters contributed action handlers", async () => {
      const mockExecutor = { registerHandler: vi.fn(), unregisterHandler: vi.fn() };
      const mockConditionReg = { registerCondition: vi.fn(), unregisterCondition: vi.fn() };
      manager.setRegistries(mockExecutor as any, mockConditionReg as any);

      mockRegistry.getModule.mockReturnValue({
        metadata: { displayName: "Test", icon: "plug" },
        configSchema: [],
        createConnector: vi.fn().mockReturnValue(mockConnector),
        actionHandlers: { custom_action: vi.fn() },
        conditions: { custom_cond: vi.fn() },
      });

      const id = await manager.enable("mock", {});
      await manager.disable(id);

      expect(mockExecutor.unregisterHandler).toHaveBeenCalledWith("custom_action");
      expect(mockConditionReg.unregisterCondition).toHaveBeenCalledWith("custom_cond");
    });
  });

  describe("updateConfig", () => {
    it("calls onConfigUpdate on the connector and persists", async () => {
      const id = await manager.enable("mock", { host: "old" });
      await manager.updateConfig(id, { host: "new" });

      expect(mockConnector.onConfigUpdate).toHaveBeenCalledWith({ host: "new" });
      expect(mockStore.save).toHaveBeenCalledTimes(2); // enable + update
    });

    it("throws when instance not found", async () => {
      await expect(manager.updateConfig("nonexistent", {})).rejects.toThrow("not found");
    });
  });

  describe("retry", () => {
    it("reconnects and re-discovers devices", async () => {
      mockConnector.connect.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const id = await manager.enable("mock", {});

      mockConnector.connect.mockClear();
      mockConnector.discoverDevices.mockClear();

      await manager.retry(id);

      expect(mockConnector.connect).toHaveBeenCalled();
      expect(mockConnector.discoverDevices).toHaveBeenCalled();
    });

    it("throws when instance not found", async () => {
      await expect(manager.retry("nonexistent")).rejects.toThrow("not found");
    });
  });

  describe("listEnabled", () => {
    it("returns info for all enabled instances", async () => {
      await manager.enable("mock", {});
      const list = manager.listEnabled();

      expect(list).toHaveLength(1);
      expect(list[0].connectorType).toBe("mock");
      expect(list[0].displayName).toBe("Mock Connector");
      expect(list[0].enabled).toBe(true);
      expect(list[0].deviceCount).toBe(1);
    });
  });

  describe("getStatus", () => {
    it("returns status for a specific instance", async () => {
      const id = await manager.enable("mock", {});
      const status = manager.getStatus(id);

      expect(status).toBeDefined();
      expect(status!.id).toBe(id);
      expect(status!.connectorType).toBe("mock");
    });

    it("returns undefined for non-existent instance", () => {
      expect(manager.getStatus("nonexistent")).toBeUndefined();
    });
  });

  describe("getConnectorInstance", () => {
    it("returns the underlying connector", async () => {
      const id = await manager.enable("mock", {});
      const connector = manager.getConnectorInstance(id);
      expect(connector).toBe(mockConnector);
    });

    it("returns undefined for non-existent instance", () => {
      expect(manager.getConnectorInstance("nonexistent")).toBeUndefined();
    });
  });

  describe("executeAction", () => {
    it("routes action to correct connector", async () => {
      mockDeviceRegistry.getById.mockReturnValue({
        id: "device-1",
        integration: "mock",
        state: { on: true },
      });

      await manager.enable("mock", {});
      await manager.executeAction("device-1", { type: "toggle", params: {} });

      expect(mockConnector.execute).toHaveBeenCalledWith({ type: "toggle", params: {} });
    });

    it("throws when device not found", async () => {
      mockDeviceRegistry.getById.mockReturnValue(null);
      await expect(manager.executeAction("unknown", { type: "toggle", params: {} })).rejects.toThrow("not found");
    });

    it("skips MQTT devices", async () => {
      mockDeviceRegistry.getById.mockReturnValue({
        id: "mqtt-device",
        integration: "mqtt",
        state: {},
      });

      await manager.enable("mock", {});
      await manager.executeAction("mqtt-device", { type: "toggle", params: {} });
      expect(mockConnector.execute).not.toHaveBeenCalled();
    });

    it("throws when no connector matches device integration", async () => {
      mockDeviceRegistry.getById.mockReturnValue({
        id: "device-1",
        integration: "other-connector",
        state: {},
      });

      await manager.enable("mock", {});
      await expect(manager.executeAction("device-1", { type: "toggle", params: {} })).rejects.toThrow("No enabled connector");
    });
  });

  describe("executeSetupStep", () => {
    it("delegates to connector's executeSetupStep", async () => {
      const id = await manager.enable("mock", {});
      const result = await manager.executeSetupStep(id, "step-1", { key: "value" });
      expect(result).toEqual({ success: true });
      expect(mockConnector.executeSetupStep).toHaveBeenCalledWith("step-1", { key: "value" });
    });

    it("throws when instance not found", async () => {
      await expect(manager.executeSetupStep("nonexistent", "step-1", {})).rejects.toThrow("not found");
    });

    it("throws when connector doesn't support setup steps", async () => {
      mockConnector.executeSetupStep = undefined;
      const id = await manager.enable("mock", {});
      await expect(manager.executeSetupStep(id, "step-1", {})).rejects.toThrow("does not support");
    });
  });

  describe("getSetupSteps", () => {
    it("returns setup steps from connector", async () => {
      mockConnector.getSetupSteps.mockReturnValue([{ id: "step-1", label: "Configure" }]);
      const id = await manager.enable("mock", {});
      const steps = manager.getSetupSteps(id);
      expect(steps).toEqual([{ id: "step-1", label: "Configure" }]);
    });

    it("throws when instance not found", () => {
      expect(() => manager.getSetupSteps("nonexistent")).toThrow("not found");
    });
  });

  describe("restoreFromStore", () => {
    it("restores enabled connectors from store", async () => {
      mockStore.loadEnabled.mockReturnValue([
        { id: "restored-1", connectorType: "mock", enabled: true, config: { host: "192.168.1.1" }, createdAt: 1000, updatedAt: 2000 },
      ]);

      await manager.restoreFromStore();

      const list = manager.listEnabled();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe("restored-1");
    });

    it("skips connectors with unknown type", async () => {
      mockStore.loadEnabled.mockReturnValue([
        { id: "unknown-1", connectorType: "unknown", enabled: true, config: {}, createdAt: 1000, updatedAt: 2000 },
      ]);
      mockRegistry.getModule.mockReturnValue(null);

      await manager.restoreFromStore();
      expect(manager.listEnabled()).toHaveLength(0);
    });
  });

  describe("disposeAll", () => {
    it("disconnects and disposes all instances", async () => {
      await manager.enable("mock", {});
      await manager.disposeAll();

      expect(mockConnector.disconnect).toHaveBeenCalled();
      expect(mockConnector.dispose).toHaveBeenCalled();
      expect(manager.listEnabled()).toHaveLength(0);
    });

    it("handles disconnect error during disposeAll gracefully", async () => {
      mockConnector.disconnect.mockRejectedValue(new Error("disconnect failed"));
      await manager.enable("mock", {});
      // Should not throw
      await manager.disposeAll();
      expect(manager.listEnabled()).toHaveLength(0);
    });

    it("handles dispose error during disposeAll gracefully", async () => {
      mockConnector.dispose.mockRejectedValue(new Error("dispose failed"));
      await manager.enable("mock", {});
      // Should not throw
      await manager.disposeAll();
      expect(manager.listEnabled()).toHaveLength(0);
    });
  });

  describe("polling", () => {
    it("polls for devices on interval", async () => {
      await manager.enable("mock", {});
      mockConnector.discoverDevices.mockClear();

      // Advance timer and flush microtasks
      vi.advanceTimersByTime(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockConnector.discoverDevices).toHaveBeenCalled();
    });

    it("emits CONNECTOR_POLL event on successful poll", async () => {
      const events: any[] = [];
      eventBus.on(CONNECTOR_POLL, (e) => events.push(e));

      await manager.enable("mock", {});

      // Use advanceTimersByTimeAsync to handle async setInterval callbacks
      await vi.advanceTimersByTimeAsync(60_000);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].connectorType).toBe("mock");
    });

    it("emits CONNECTOR_ERROR on poll failure", async () => {
      const errors: any[] = [];
      eventBus.on(CONNECTOR_ERROR, (e) => errors.push(e));

      mockConnector.discoverDevices
        .mockResolvedValueOnce([{ id: "d1", type: "light", state: {}, integration: "mock", lastSeen: Date.now(), capabilities: [] }])
        .mockRejectedValueOnce(new Error("network error"));

      await manager.enable("mock", {});
      await vi.advanceTimersByTimeAsync(60_000);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].error).toContain("network error");
    });
  });
});
