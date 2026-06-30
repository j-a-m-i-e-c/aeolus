// frontend/src/store/device-store.test.ts — Unit tests for the device Zustand store

import { describe, it, expect, beforeEach } from "vitest";
import { useDeviceStore, type Device } from "./device-store";

function makeDevice(id: string, state: Record<string, unknown> = {}): Device {
  return {
    id,
    name: id,
    type: "sensor",
    capabilities: [],
    state,
    integration: "mqtt",
    lastSeen: 0,
  };
}

describe("device-store", () => {
  beforeEach(() => {
    useDeviceStore.setState({
      devices: {},
      health: null,
      wsConnected: false,
      mqttMessages: [],
      automationEvents: [],
      deviceHistory: {},
    });
  });

  const s = () => useDeviceStore.getState();

  it("setDevices replaces the device map", () => {
    s().setDevices({ "d-1": makeDevice("d-1") });
    expect(Object.keys(s().devices)).toEqual(["d-1"]);
  });

  it("updateDevice merges into existing device state", () => {
    s().setDevices({ "d-1": makeDevice("d-1", { on: false, level: 10 }) });
    s().updateDevice("d-1", { on: true });
    expect(s().devices["d-1"].state).toEqual({ on: true, level: 10 });
  });

  it("updateDevice is a no-op for an unknown device", () => {
    const before = s().devices;
    s().updateDevice("ghost", { on: true });
    expect(s().devices).toBe(before);
  });

  it("removeDevice drops only the targeted device", () => {
    s().setDevices({ "d-1": makeDevice("d-1"), "d-2": makeDevice("d-2") });
    s().removeDevice("d-1");
    expect(Object.keys(s().devices)).toEqual(["d-2"]);
  });

  it("addMqttMessage prepends and caps the buffer at 30", () => {
    for (let i = 0; i < 35; i++) {
      s().addMqttMessage({ topic: `t/${i}`, payload: "x", timestamp: i });
    }
    const msgs = s().mqttMessages;
    expect(msgs).toHaveLength(30);
    expect(msgs[0].topic).toBe("t/34"); // newest first
    expect(msgs[29].topic).toBe("t/5");
  });

  it("addAutomationEvent prepends and caps the buffer at 20", () => {
    for (let i = 0; i < 25; i++) {
      s().addAutomationEvent({ ruleId: `r${i}`, ruleName: "n", topic: "t", deviceId: "d", timestamp: i });
    }
    expect(s().automationEvents).toHaveLength(20);
    expect(s().automationEvents[0].ruleId).toBe("r24");
  });

  it("addDeviceValue appends per device and keeps the last 20", () => {
    for (let i = 0; i < 25; i++) s().addDeviceValue("d-1", i);
    const series = s().deviceHistory["d-1"];
    expect(series).toHaveLength(20);
    expect(series[0]).toBe(5);
    expect(series[19]).toBe(24);
  });

  it("clear actions empty their buffers", () => {
    s().addMqttMessage({ topic: "t", payload: "p", timestamp: 1 });
    s().addAutomationEvent({ ruleId: "r", ruleName: "n", topic: "t", deviceId: "d", timestamp: 1 });
    s().clearMqttMessages();
    s().clearAutomationEvents();
    expect(s().mqttMessages).toEqual([]);
    expect(s().automationEvents).toEqual([]);
  });

  it("setHealth and setWsConnected update connection state", () => {
    s().setWsConnected(true);
    s().setHealth({ mqtt: "connected", deviceCount: 3, ruleCount: 2, uptime: 100, timestamp: "now" });
    expect(s().wsConnected).toBe(true);
    expect(s().health?.deviceCount).toBe(3);
  });
});
