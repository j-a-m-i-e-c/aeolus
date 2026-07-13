// src/connectors/hue/capability-mapper.test.ts — Tests for uncovered branches

import { describe, it, expect } from "vitest";
import {
  mapTypeToCapabilities,
  extractDeviceState,
  clampHue,
  clampSaturation,
  clampCt,
  type RawHueLight,
} from "./capability-mapper.js";

describe("mapTypeToCapabilities", () => {
  it("Extended color light has all capabilities", () => {
    const result = mapTypeToCapabilities("Extended color light");
    expect(result.capabilities).toEqual(["on/off", "brightness", "color", "color-temperature"]);
    expect(result.hasColor).toBe(true);
    expect(result.hasColorTemp).toBe(true);
    expect(result.hasBrightness).toBe(true);
  });

  it("Color temperature light has on/off, brightness, color-temperature", () => {
    const result = mapTypeToCapabilities("Color temperature light");
    expect(result.capabilities).toEqual(["on/off", "brightness", "color-temperature"]);
    expect(result.hasColor).toBe(false);
    expect(result.hasColorTemp).toBe(true);
    expect(result.hasBrightness).toBe(true);
  });

  it("Dimmable light has on/off and brightness", () => {
    const result = mapTypeToCapabilities("Dimmable light");
    expect(result.capabilities).toEqual(["on/off", "brightness"]);
    expect(result.hasColor).toBe(false);
    expect(result.hasColorTemp).toBe(false);
    expect(result.hasBrightness).toBe(true);
  });

  it("On/Off plug-in unit has only on/off", () => {
    const result = mapTypeToCapabilities("On/Off plug-in unit");
    expect(result.capabilities).toEqual(["on/off"]);
    expect(result.hasColor).toBe(false);
    expect(result.hasColorTemp).toBe(false);
    expect(result.hasBrightness).toBe(false);
  });

  it("On/Off light has only on/off", () => {
    const result = mapTypeToCapabilities("On/Off light");
    expect(result.capabilities).toEqual(["on/off"]);
    expect(result.hasColor).toBe(false);
    expect(result.hasColorTemp).toBe(false);
    expect(result.hasBrightness).toBe(false);
  });

  it("Unknown type defaults to on/off + brightness", () => {
    const result = mapTypeToCapabilities("Some New Hue Device");
    expect(result.capabilities).toEqual(["on/off", "brightness"]);
    expect(result.hasColor).toBe(false);
    expect(result.hasColorTemp).toBe(false);
    expect(result.hasBrightness).toBe(true);
  });
});

describe("extractDeviceState", () => {
  const baseLight: RawHueLight = {
    state: { on: true, bri: 200, hue: 5000, sat: 150, ct: 300, colormode: "hs", reachable: true },
    type: "Extended color light",
    name: "Test Light",
    modelid: "LCT001",
    manufacturername: "Signify",
    uniqueid: "AA:BB:CC",
    swversion: "1.0",
    capabilities: { control: { ct: { min: 153, max: 500 }, colorgamuttype: "C" } },
    config: { archetype: "sultanbulb" },
  };

  it("extracts all fields for Extended color light", () => {
    const caps = mapTypeToCapabilities("Extended color light");
    const state = extractDeviceState(baseLight, caps);
    expect(state.on).toBe(true);
    expect(state.brightness).toBe(200);
    expect(state.hue).toBe(5000);
    expect(state.saturation).toBe(150);
    expect(state.colorMode).toBe("hs");
    expect(state.ct).toBe(300);
    expect(state.ctMin).toBe(153);
    expect(state.ctMax).toBe(500);
    expect(state.archetype).toBe("sultanbulb");
  });

  it("omits color and ct fields for Dimmable light", () => {
    const caps = mapTypeToCapabilities("Dimmable light");
    const state = extractDeviceState(baseLight, caps);
    expect(state.brightness).toBe(200);
    expect(state.hue).toBeUndefined();
    expect(state.ct).toBeUndefined();
  });

  it("omits brightness, color, ct for On/Off light", () => {
    const caps = mapTypeToCapabilities("On/Off light");
    const state = extractDeviceState(baseLight, caps);
    expect(state.brightness).toBeUndefined();
    expect(state.hue).toBeUndefined();
    expect(state.ct).toBeUndefined();
  });

  it("uses defaults when capabilities.control is absent", () => {
    const lightNoCaps: RawHueLight = {
      ...baseLight,
      capabilities: undefined,
      config: undefined,
    };
    const caps = mapTypeToCapabilities("Extended color light");
    const state = extractDeviceState(lightNoCaps, caps);
    expect(state.gamutType).toBeNull();
    expect(state.ctMin).toBe(153);
    expect(state.ctMax).toBe(500);
    expect(state.archetype).toBe("unknown");
  });
});

describe("clamp functions", () => {
  it("clampHue clamps to [0, 65535]", () => {
    expect(clampHue(-10)).toBe(0);
    expect(clampHue(70000)).toBe(65535);
    expect(clampHue(5000)).toBe(5000);
  });

  it("clampSaturation clamps to [0, 254]", () => {
    expect(clampSaturation(-1)).toBe(0);
    expect(clampSaturation(300)).toBe(254);
    expect(clampSaturation(100)).toBe(100);
  });

  it("clampCt clamps to [ctMin, ctMax]", () => {
    expect(clampCt(100, 153, 500)).toBe(153);
    expect(clampCt(600, 153, 500)).toBe(500);
    expect(clampCt(300, 153, 500)).toBe(300);
  });
});
