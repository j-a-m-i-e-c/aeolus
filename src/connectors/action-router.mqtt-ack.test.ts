// src/connectors/action-router.mqtt-ack.test.ts
// phase-1-runtime-foundations Task 5 — generic MQTT acknowledgement capability
// and configurable QoS resolved from a device's persisted MQTT command profile.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActionRouter } from "./action-router.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { Connector, ConnectorRecord } from "./connector.interface.js";
import type { ManagedInstance } from "./connector-manager.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function mqttDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "esp32-relay",
    name: "ESP32 Relay",
    type: "switch",
    capabilities: ["on/off"],
    state: {},
    integration: "mqtt",
    lastSeen: Date.now(),
    topic: "esp32/relay/state",
    commandTopic: "esp32/relay/set",
    ...overrides,
  };
}

describe("ActionRouter — generic MQTT acknowledgement capability (Req 2.4)", () => {
  let instances: Map<string, ManagedInstance>;
  let deviceRegistry: { getById: ReturnType<typeof vi.fn> };
  let connectorRegistry: { getModule: ReturnType<typeof vi.fn> };
  let mqttService: { isConnected: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn> };
  let router: ActionRouter;

  beforeEach(() => {
    instances = new Map();
    deviceRegistry = { getById: vi.fn() };
    connectorRegistry = { getModule: vi.fn().mockReturnValue(null) };
    mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() };
    router = new ActionRouter(
      instances,
      deviceRegistry as unknown as DeviceRegistry,
      connectorRegistry as unknown as ConnectorRegistry,
      vi.fn(),
    );
    router.setMqttService(mqttService as unknown as MqttService);
  });

  it("translates an ack-capable MQTT profile into an AcknowledgementCapability", () => {
    deviceRegistry.getById.mockReturnValue(
      mqttDevice({
        mqttCommandProfile: {
          acknowledgement: {
            supported: true,
            responseTopic: "aeolus/acks/esp32-relay",
            ackIndicatorField: "status",
            ackIndicatorValues: ["ok"],
          },
        },
      }),
    );

    expect(router.getAcknowledgementCapability("esp32-relay")).toEqual({
      supported: true,
      responseTopic: "aeolus/acks/esp32-relay",
      ackIndicatorField: "status",
      ackIndicatorValues: ["ok"],
    });
  });

  it("returns undefined (dispatch-only) for an MQTT device with no profile", () => {
    deviceRegistry.getById.mockReturnValue(mqttDevice());
    expect(router.getAcknowledgementCapability("esp32-relay")).toBeUndefined();
  });

  it("returns undefined when the profile disables acknowledgement", () => {
    deviceRegistry.getById.mockReturnValue(
      mqttDevice({ mqttCommandProfile: { acknowledgement: { supported: false } } }),
    );
    expect(router.getAcknowledgementCapability("esp32-relay")).toBeUndefined();
  });

  it("leaves connector-owned acknowledgement capability unchanged", () => {
    const connector: Partial<Connector> = {
      getAcknowledgementCapability: vi.fn().mockReturnValue({ supported: true, responseTopic: "hue/acks" }),
    };
    instances.set("bridge-a", {
      connector: connector as Connector,
      record: { id: "bridge-a", connectorType: "hue", enabled: true, config: {}, createdAt: 0, updatedAt: 0 } as ConnectorRecord,
      pollingTimer: null as unknown as ReturnType<typeof setInterval>,
      devices: new Set<string>(),
    } as unknown as ManagedInstance);
    deviceRegistry.getById.mockReturnValue(
      mqttDevice({ id: "hue-1", integration: "hue", connectorInstanceId: "bridge-a" }),
    );

    expect(router.getAcknowledgementCapability("hue-1")).toEqual({ supported: true, responseTopic: "hue/acks" });
    expect(connector.getAcknowledgementCapability).toHaveBeenCalledWith("hue-1");
  });
});

describe("ActionRouter — MQTT command QoS (Req 2.8)", () => {
  let instances: Map<string, ManagedInstance>;
  let deviceRegistry: { getById: ReturnType<typeof vi.fn> };
  let mqttService: { isConnected: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn> };
  let router: ActionRouter;

  beforeEach(() => {
    instances = new Map();
    deviceRegistry = { getById: vi.fn() };
    mqttService = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() };
    router = new ActionRouter(
      instances,
      deviceRegistry as unknown as DeviceRegistry,
      { getModule: vi.fn().mockReturnValue(null) } as unknown as ConnectorRegistry,
      vi.fn(),
    );
    router.setMqttService(mqttService as unknown as MqttService);
  });

  it("passes the configured QoS on a correlated command publish", async () => {
    deviceRegistry.getById.mockReturnValue(mqttDevice({ mqttCommandProfile: { qos: 1 } }));

    await router.executeAction(
      "esp32-relay",
      { type: "command", deviceId: "esp32-relay", params: { on: true } },
      { correlationId: "K1", responseTopic: "aeolus/acks/esp32-relay" },
    );

    expect(mqttService.publish).toHaveBeenCalledTimes(1);
    const [topic, , options] = mqttService.publish.mock.calls[0];
    expect(topic).toBe("esp32/relay/set");
    expect(options).toMatchObject({ qos: 1, responseTopic: "aeolus/acks/esp32-relay" });
  });

  it("omits QoS (default behaviour) when no profile QoS is configured", async () => {
    deviceRegistry.getById.mockReturnValue(mqttDevice());

    await router.executeAction("esp32-relay", { type: "command", deviceId: "esp32-relay", params: { on: true } });

    expect(mqttService.publish).toHaveBeenCalledTimes(1);
    const options = mqttService.publish.mock.calls[0][2];
    // Either no options object, or one without an explicit qos.
    expect(options?.qos).toBeUndefined();
  });
});
