import { describe, it, expect } from "vitest";
import { parseTopic, prettyPrintTopic } from "./topic-parser.js";

describe("parseTopic", () => {
  describe("known-type topics parse correctly", () => {
    it("parses sensor/kitchen/temp", () => {
      expect(parseTopic("sensor/kitchen/temp")).toEqual({
        deviceId: "sensor-kitchen-temp",
        deviceType: "sensor",
        name: "Kitchen Temp",
      });
    });

    it("parses switch/bedroom", () => {
      expect(parseTopic("switch/bedroom")).toEqual({
        deviceId: "switch-bedroom",
        deviceType: "switch",
        name: "Bedroom",
      });
    });

    it("parses light/living-room", () => {
      expect(parseTopic("light/living-room")).toEqual({
        deviceId: "light-living-room",
        deviceType: "light",
        name: "Living-room",
      });
    });

    it("parses motion/hallway", () => {
      expect(parseTopic("motion/hallway")).toEqual({
        deviceId: "motion-hallway",
        deviceType: "motion",
        name: "Hallway",
      });
    });
  });

  describe("previously-rejected topics now succeed", () => {
    it("parses valve/irrigation/command", () => {
      expect(parseTopic("valve/irrigation/command")).toEqual({
        deviceId: "valve-irrigation-command",
        deviceType: "valve",
        name: "Irrigation Command",
      });
    });

    it("parses pump/well/status", () => {
      expect(parseTopic("pump/well/status")).toEqual({
        deviceId: "pump-well-status",
        deviceType: "pump",
        name: "Well Status",
      });
    });

    it("parses thermostat/living (unknown type)", () => {
      expect(parseTopic("thermostat/living")).toEqual({
        deviceId: "thermostat-living",
        deviceType: "thermostat",
        name: "Thermostat Living",
      });
    });

    it("parses climate/bedroom/temp (known type)", () => {
      expect(parseTopic("climate/bedroom/temp")).toEqual({
        deviceId: "climate-bedroom-temp",
        deviceType: "climate",
        name: "Bedroom Temp",
      });
    });
  });

  describe("single-segment topics", () => {
    it("parses heartbeat", () => {
      expect(parseTopic("heartbeat")).toEqual({
        deviceId: "heartbeat",
        deviceType: "heartbeat",
        name: "Heartbeat",
      });
    });

    it("parses status", () => {
      expect(parseTopic("status")).toEqual({
        deviceId: "status",
        deviceType: "status",
        name: "Status",
      });
    });
  });

  describe("edge cases", () => {
    it("returns null for empty string", () => {
      expect(parseTopic("")).toBeNull();
    });

    it("returns null for non-string input", () => {
      expect(parseTopic(null as unknown as string)).toBeNull();
      expect(parseTopic(undefined as unknown as string)).toBeNull();
      expect(parseTopic(42 as unknown as string)).toBeNull();
    });

    it("returns null for all-empty-segments (///)", () => {
      expect(parseTopic("///")).toBeNull();
    });
  });

  describe("name derivation", () => {
    it("known type: strips type from name", () => {
      const result = parseTopic("sensor/kitchen/temp");
      expect(result?.name).toBe("Kitchen Temp");
    });

    it("unknown type: includes all segments in name", () => {
      const result = parseTopic("thermostat/living/temp");
      expect(result?.name).toBe("Thermostat Living Temp");
    });

    it("single segment: title-cases the segment", () => {
      const result = parseTopic("heartbeat");
      expect(result?.name).toBe("Heartbeat");
    });
  });

  describe("device ID is deterministic (segments joined with hyphens)", () => {
    it("joins all segments with hyphens", () => {
      expect(parseTopic("sensor/kitchen/temp")?.deviceId).toBe("sensor-kitchen-temp");
      expect(parseTopic("valve/irrigation/command")?.deviceId).toBe("valve-irrigation-command");
      expect(parseTopic("heartbeat")?.deviceId).toBe("heartbeat");
    });

    it("produces the same ID on repeated calls", () => {
      const first = parseTopic("pump/well/status")?.deviceId;
      const second = parseTopic("pump/well/status")?.deviceId;
      expect(first).toBe(second);
    });
  });

  describe("device type is first segment lowercased", () => {
    it("lowercases the first segment", () => {
      expect(parseTopic("Sensor/kitchen/temp")?.deviceType).toBe("sensor");
      expect(parseTopic("LIGHT/bedroom")?.deviceType).toBe("light");
      expect(parseTopic("Thermostat/living")?.deviceType).toBe("thermostat");
    });
  });
});

describe("prettyPrintTopic", () => {
  it("reconstructs a multi-segment topic", () => {
    const parsed = parseTopic("sensor/kitchen/temp")!;
    expect(prettyPrintTopic(parsed)).toBe("sensor/kitchen/temp");
  });

  it("reconstructs a two-segment topic", () => {
    const parsed = parseTopic("switch/bedroom")!;
    expect(prettyPrintTopic(parsed)).toBe("switch/bedroom");
  });

  it("reconstructs a single-segment topic", () => {
    const parsed = parseTopic("heartbeat")!;
    expect(prettyPrintTopic(parsed)).toBe("heartbeat");
  });

  it("reconstructs an unknown-type topic", () => {
    const parsed = parseTopic("thermostat/living/temp")!;
    expect(prettyPrintTopic(parsed)).toBe("thermostat/living/temp");
  });
});
