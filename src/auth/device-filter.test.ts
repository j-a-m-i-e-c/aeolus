// src/auth/device-filter.test.ts — unit tests for the device-selection allowlist
// Feature: resource-level-authorization

import { describe, it, expect } from "vitest";
import { matchesDeviceFilter } from "./device-filter.js";
import type { Device } from "../core/types.js";

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "d1",
    name: "Device",
    type: "light",
    capabilities: [],
    state: {},
    integration: "hue",
    lastSeen: 0,
    ...overrides,
  };
}

describe("matchesDeviceFilter", () => {
  it("matches Hue lights for a hue-control pane", () => {
    const pane = { paneType: "hue-control", config: {} };
    expect(matchesDeviceFilter(pane, device({ integration: "hue", type: "light" }))).toBe(true);
    expect(matchesDeviceFilter(pane, device({ integration: "hue", type: "sensor" }))).toBe(false);
    expect(matchesDeviceFilter(pane, device({ integration: "kasa", type: "light" }))).toBe(false);
  });

  it("matches Kasa devices for a kasa-control pane", () => {
    const pane = { paneType: "kasa-control", config: {} };
    expect(matchesDeviceFilter(pane, device({ integration: "kasa", type: "plug" }))).toBe(true);
    expect(matchesDeviceFilter(pane, device({ integration: "hue", type: "light" }))).toBe(false);
  });

  it("matches sensor-type devices for a sensor-panel pane", () => {
    const pane = { paneType: "sensor-panel", config: {} };
    expect(matchesDeviceFilter(pane, device({ type: "sensor", integration: "mqtt" }))).toBe(true);
    expect(matchesDeviceFilter(pane, device({ type: "light", integration: "hue" }))).toBe(false);
  });

  it("narrows a purposeful pane by config.deviceType", () => {
    const pane = { paneType: "kasa-control", config: { deviceType: "switch" } };
    expect(matchesDeviceFilter(pane, device({ integration: "kasa", type: "switch" }))).toBe(true);
    expect(matchesDeviceFilter(pane, device({ integration: "kasa", type: "plug" }))).toBe(false);
  });

  it("returns false by default for the device-grid pane, even with a deviceType config", () => {
    expect(matchesDeviceFilter({ paneType: "device-grid", config: {} }, device())).toBe(false);
    expect(
      matchesDeviceFilter({ paneType: "device-grid", config: { deviceType: "light" } }, device({ type: "light" })),
    ).toBe(false);
  });

  it("returns false for non-device and unknown/legacy pane types", () => {
    expect(matchesDeviceFilter({ paneType: "automation", config: {} }, device())).toBe(false);
    expect(matchesDeviceFilter({ paneType: "system-stats", config: {} }, device())).toBe(false);
    expect(matchesDeviceFilter({ paneType: "some-legacy-pane", config: {} }, device())).toBe(false);
  });
});
