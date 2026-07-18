// src/connectors/action-router.test.ts — Tests targeting uncovered branches in ActionRouter

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActionRouter } from "./action-router.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { Connector, CapabilityDescriptor, ConnectorRecord } from "./connector.interface.js";
import type { ManagedInstance } from "./connector-manager.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "test-device-1",
    name: "Test Device",
    type: "plug",
    capabilities: ["on/off"],
    state: { on: false },
    integration: "test-connector",
    lastSeen: Date.now(),
    ...overrides,
  };
}

function createMockConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    discoverDevices: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    getHealthStatus: vi.fn().mockReturnValue({ status: "connected", lastSeen: Date.now() }),
    onConfigUpdate: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockInstance(connectorType: string, connector: Connector): ManagedInstance {
  return {
    connector,
    record: {
      id: "instance-1",
      connectorType,
      enabled: true,
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as ConnectorRecord,
    pollTimer: null as any,
  };
}

describe("ActionRouter", () => {
  let instances: Map<string, ManagedInstance>;
  let deviceRegistry: { getById: ReturnType<typeof vi.fn> };
  let connectorRegistry: { getModule: ReturnType<typeof vi.fn> };
  let emitDeviceEvent: ReturnType<typeof vi.fn>;
  let router: ActionRouter;

  beforeEach(() => {
    instances = new Map();
    deviceRegistry = { getById: vi.fn() };
    connectorRegistry = { getModule: vi.fn().mockReturnValue(null) };
    emitDeviceEvent = vi.fn();
    router = new ActionRouter(
      instances,
      deviceRegistry as unknown as DeviceRegistry,
      connectorRegistry as unknown as ConnectorRegistry,
      emitDeviceEvent,
    );
  });

  describe("executeAction — device not found", () => {
    it("returns error when device does not exist", async () => {
      deviceRegistry.getById.mockReturnValue(undefined);
      const result = await router.executeAction("nonexistent", { type: "on", deviceId: "nonexistent", params: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("executeAction — pre-flight validation", () => {
    it("rejects unsupported action type when catalog exists", async () => {
      const device = createMockDevice({ capabilities: ["on/off"] });
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          { type: "on", label: "On", description: "Turn on", params: {} },
          { type: "off", label: "Off", description: "Turn off", params: {} },
        ]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", { type: "dim", deviceId: "test-device-1", params: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain("unsupported action 'dim'");
      expect(result.error).toContain("Supported: on, off");
    });

    it("rejects missing required params", async () => {
      const device = createMockDevice({ capabilities: ["on/off", "brightness"] });
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          {
            type: "setBrightness",
            label: "Set Brightness",
            description: "Set brightness",
            params: {
              required: ["brightness"],
              properties: { brightness: { minimum: 0, maximum: 100 } },
            },
          },
        ]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "setBrightness", deviceId: "test-device-1", params: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("required field missing");
    });

    it("rejects param below minimum", async () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          {
            type: "setBrightness",
            label: "Set Brightness",
            description: "desc",
            params: {
              required: ["brightness"],
              properties: { brightness: { minimum: 0, maximum: 100 } },
            },
          },
        ]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "setBrightness", deviceId: "test-device-1", params: { brightness: -5 },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("below minimum");
    });

    it("rejects param above maximum", async () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          {
            type: "setBrightness",
            label: "Set Brightness",
            description: "desc",
            params: {
              required: ["brightness"],
              properties: { brightness: { minimum: 0, maximum: 100 } },
            },
          },
        ]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "setBrightness", deviceId: "test-device-1", params: { brightness: 150 },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("exceeds maximum");
    });
  });

  describe("executeAction — MQTT path", () => {
    it("returns error when MQTT service not connected", async () => {
      const device = createMockDevice({ integration: "mqtt", state: { on: false, topic: "home/light/status" } });
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = { isConnected: vi.fn().mockReturnValue(false), publish: vi.fn() } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: "ON" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("MQTT broker not connected");
    });

    it("publishes to derived command topic when no explicit commandTopic", async () => {
      const device = createMockDevice({
        integration: "mqtt",
        state: { on: false, topic: "home/light/status" },
      });
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: "ON" },
      });
      expect(result.success).toBe(true);
      expect(mqttService.publish).toHaveBeenCalledWith("home/light/set", "ON");
    });

    it("uses explicit commandTopic from device when present", async () => {
      const device = createMockDevice({
        integration: "mqtt",
        state: { on: false, topic: "home/light/status" },
        commandTopic: "home/light/cmd",
      });
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: "ON" },
      });
      expect(result.success).toBe(true);
      expect(mqttService.publish).toHaveBeenCalledWith("home/light/cmd", "ON");
    });

    it("uses state.commandTopic as fallback", async () => {
      const device = createMockDevice({
        integration: "mqtt",
        state: { on: false, topic: "home/light/status", commandTopic: "home/light/command" },
      });
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: "test" },
      });
      expect(result.success).toBe(true);
      expect(mqttService.publish).toHaveBeenCalledWith("home/light/command", "test");
    });

    it("uses device.id/set when no topic is derivable", async () => {
      const device = createMockDevice({
        integration: "mqtt",
        state: { on: false },
      });
      // Remove topic property
      delete (device as any).topic;
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: "ON" },
      });
      expect(result.success).toBe(true);
      expect(mqttService.publish).toHaveBeenCalledWith("test-device-1/set", "ON");
    });

    it("JSON.stringifies payload when it is not a string", async () => {
      const device = createMockDevice({
        integration: "mqtt",
        state: { on: false, topic: "home/light/status" },
      });
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: { state: "ON", brightness: 100 } },
      });
      expect(result.success).toBe(true);
      expect(mqttService.publish).toHaveBeenCalledWith(
        "home/light/set",
        JSON.stringify({ state: "ON", brightness: 100 }),
      );
    });

    it("JSON.stringifies params when no payload field", async () => {
      const device = createMockDevice({
        integration: "mqtt",
        state: { on: false, topic: "home/light/status" },
      });
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { brightness: 50 },
      });
      expect(result.success).toBe(true);
      expect(mqttService.publish).toHaveBeenCalledWith(
        "home/light/set",
        JSON.stringify({ brightness: 50 }),
      );
    });

    it("returns error when mqttService is not set", async () => {
      const device = createMockDevice({ integration: "mqtt", state: { on: false, topic: "x/y" } });
      deviceRegistry.getById.mockReturnValue(device);
      // No mqttService set

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: "ON" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("MQTT broker not connected");
    });

    it("catches publish error and returns failure", async () => {
      const device = createMockDevice({
        integration: "mqtt",
        state: { on: false, topic: "home/light/status" },
      });
      deviceRegistry.getById.mockReturnValue(device);

      const mqttService = {
        isConnected: vi.fn().mockReturnValue(true),
        publish: vi.fn().mockImplementation(() => { throw new Error("publish failed"); }),
      } as unknown as MqttService;
      router.setMqttService(mqttService);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: { payload: "ON" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("publish failed");
    });
  });

  describe("executeAction — connector path", () => {
    it("executes through connector and emits optimistic state for toggle", async () => {
      const device = createMockDevice({ state: { on: true } });
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector();
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "toggle", deviceId: "test-device-1", params: {},
      });
      expect(result.success).toBe(true);
      expect(emitDeviceEvent).toHaveBeenCalledWith(expect.objectContaining({
        state: expect.objectContaining({ on: false }),
      }));
    });

    it("emits optimistic state with merged params for non-toggle", async () => {
      const device = createMockDevice({ state: { on: false, brightness: 50 } });
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          { type: "setBrightness", label: "Set Brightness", description: "desc", params: {} },
        ]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "setBrightness", deviceId: "test-device-1", params: { brightness: 80 },
      });
      expect(result.success).toBe(true);
      expect(emitDeviceEvent).toHaveBeenCalledWith(expect.objectContaining({
        state: expect.objectContaining({ brightness: 80 }),
      }));
    });

    it("handles delete action — removes device from registry", async () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const mockRemove = vi.fn();
      (deviceRegistry as any).remove = mockRemove;
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          { type: "delete", label: "Delete", description: "Delete device", params: {} },
        ]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "delete", deviceId: "test-device-1", params: {},
      });
      expect(result.success).toBe(true);
      expect(mockRemove).toHaveBeenCalledWith("test-device-1");
    });

    it("handles rename action — triggers re-discovery", async () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          { type: "rename", label: "Rename", description: "Rename device", params: {} },
        ]),
        discoverDevices: vi.fn().mockResolvedValue([createMockDevice({ name: "Renamed" })]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "rename", deviceId: "test-device-1", params: { name: "Renamed" },
      });
      expect(result.success).toBe(true);
      expect(emitDeviceEvent).toHaveBeenCalled();
    });

    it("handles rename action when re-discovery fails", async () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          { type: "rename", label: "Rename", description: "Rename device", params: {} },
        ]),
        discoverDevices: vi.fn().mockRejectedValue(new Error("discovery failed")),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "rename", deviceId: "test-device-1", params: { name: "Renamed" },
      });
      expect(result.success).toBe(true); // still succeeds
    });

    it("catches connector.execute error and returns failure", async () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          { type: "on", label: "On", description: "Turn on", params: {} },
        ]),
        execute: vi.fn().mockRejectedValue(new Error("connector error")),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("connector error");
    });

    it("returns error when no enabled connector matches device integration", async () => {
      const device = createMockDevice({ integration: "unknown-connector" });
      deviceRegistry.getById.mockReturnValue(device);

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No enabled connector found");
    });
  });

  describe("getActionCatalog", () => {
    it("returns empty array for unknown device", () => {
      deviceRegistry.getById.mockReturnValue(undefined);
      expect(router.getActionCatalog("nonexistent")).toEqual([]);
    });

    it("returns catalog from connector instance getActionCatalog", () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const catalog: CapabilityDescriptor[] = [
        { type: "on", label: "On", description: "Turn on", params: {} },
      ];
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue(catalog),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      expect(router.getActionCatalog("test-device-1")).toEqual(catalog);
    });

    it("falls back to module-level getActionCatalog", () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const moduleCatalog: CapabilityDescriptor[] = [
        { type: "toggle", label: "Toggle", description: "Toggle", params: {} },
      ];
      const connector = createMockConnector();
      // connector has no getActionCatalog
      instances.set("inst-1", createMockInstance("test-connector", connector));
      connectorRegistry.getModule.mockReturnValue({
        getActionCatalog: vi.fn().mockReturnValue(moduleCatalog),
      });

      expect(router.getActionCatalog("test-device-1")).toEqual(moduleCatalog);
    });

    it("falls back to CAPABILITY_ACTION_MAP for devices with capabilities", () => {
      const device = createMockDevice({ integration: "other", capabilities: ["on/off"] });
      deviceRegistry.getById.mockReturnValue(device);
      // No connector instances match

      const result = router.getActionCatalog("test-device-1");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns MQTT command descriptor for MQTT devices", () => {
      const device = createMockDevice({ integration: "mqtt", capabilities: ["on/off"] });
      deviceRegistry.getById.mockReturnValue(device);

      const result = router.getActionCatalog("test-device-1");
      expect(result.some((d) => d.type === "command")).toBe(true);
    });

    it("returns empty when device has no capabilities and no connector catalog", () => {
      const device = createMockDevice({ integration: "other", capabilities: [] });
      deviceRegistry.getById.mockReturnValue(device);

      expect(router.getActionCatalog("test-device-1")).toEqual([]);
    });
  });

  describe("getAcknowledgementCapability", () => {
    it("returns undefined for unknown device", () => {
      deviceRegistry.getById.mockReturnValue(undefined);
      expect(router.getAcknowledgementCapability("nonexistent")).toBeUndefined();
    });

    it("returns connector-declared capability when connector matches", () => {
      const device = createMockDevice({ integration: "test-connector" });
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getAcknowledgementCapability: vi.fn().mockReturnValue({ supported: true }),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      expect(router.getAcknowledgementCapability("test-device-1")).toEqual({ supported: true });
    });

    it("returns undefined when connector declares no capability and device has no ackCapable", () => {
      const device = createMockDevice({ integration: "mqtt" });
      deviceRegistry.getById.mockReturnValue(device);

      expect(router.getAcknowledgementCapability("test-device-1")).toBeUndefined();
    });

    it("returns { supported: true } when device has ackCapable flag and no connector match", () => {
      const device = createMockDevice({ integration: "mqtt", ackCapable: true });
      deviceRegistry.getById.mockReturnValue(device);

      expect(router.getAcknowledgementCapability("test-device-1")).toEqual({ supported: true });
    });

    it("does not use ackCapable fallback when connector provides a result", () => {
      const device = createMockDevice({ integration: "test-connector", ackCapable: true });
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getAcknowledgementCapability: vi.fn().mockReturnValue({ supported: false }),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      expect(router.getAcknowledgementCapability("test-device-1")).toEqual({ supported: false });
    });
  });

  describe("validateParams — edge cases", () => {
    it("passes when descriptor has no params schema", async () => {
      const device = createMockDevice();
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector({
        getActionCatalog: vi.fn().mockReturnValue([
          { type: "on", label: "On", description: "Turn on", params: {} },
        ]),
      });
      instances.set("inst-1", createMockInstance("test-connector", connector));

      const result = await router.executeAction("test-device-1", {
        type: "on", deviceId: "test-device-1", params: {},
      });
      expect(result.success).toBe(true);
    });

    it("passes when no catalog is derivable (no pre-flight check)", async () => {
      const device = createMockDevice({ integration: "test-connector", capabilities: [] });
      deviceRegistry.getById.mockReturnValue(device);
      const connector = createMockConnector();
      instances.set("inst-1", createMockInstance("test-connector", connector));
      connectorRegistry.getModule.mockReturnValue(null);

      const result = await router.executeAction("test-device-1", {
        type: "custom-action", deviceId: "test-device-1", params: {},
      });
      expect(result.success).toBe(true);
    });
  });
});
