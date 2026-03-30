import { describe, it, expect } from "vitest";
import { parseTopic } from "./topic-parser.js";

describe("parseTopic", () => {
  it("parses a three-segment sensor topic", () => {
    const result = parseTopic("sensor/kitchen/temp");
    expect(result).toEqual({
      deviceId: "sensor-kitchen-temp",
      deviceType: "sensor",
      name: "Kitchen Temp",
    });
  });

  it("parses a two-segment switch topic", () => {
    const result = parseTopic("switch/bedroom");
    expect(result).toEqual({
      deviceId: "switch-bedroom",
      deviceType: "switch",
      name: "Bedroom",
    });
  });

  it("maps motion to sensor type", () => {
    const result = parseTopic("motion/hallway");
    expect(result).toEqual({
      deviceId: "motion-hallway",
      deviceType: "sensor",
      name: "Hallway",
    });
  });

  it("parses a light topic", () => {
    const result = parseTopic("light/living-room");
    expect(result).toEqual({
      deviceId: "light-living-room",
      deviceType: "light",
      name: "Living-room",
    });
  });

  it("returns null for empty string", () => {
    expect(parseTopic("")).toBeNull();
  });

  it("returns null for single segment", () => {
    expect(parseTopic("sensor")).toBeNull();
  });

  it("returns null for unknown device type", () => {
    expect(parseTopic("thermostat/living")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseTopic(null as unknown as string)).toBeNull();
    expect(parseTopic(undefined as unknown as string)).toBeNull();
  });
});
