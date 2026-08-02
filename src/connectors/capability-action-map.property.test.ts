// src/connectors/capability-action-map.property.test.ts
// Feature: device-action-system-uplift, Property 8: Capability-to-action mapping completeness

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { CAPABILITY_ACTION_MAP } from "./capability-action-map.js";

// Feature: device-action-system-uplift, Property 8: Capability-to-action mapping completeness
describe("CAPABILITY_ACTION_MAP — Property 8: capability-to-action mapping completeness", () => {
  const ALL_CAPABILITIES = ["on/off", "brightness", "color", "color-temp", "energy-monitoring"] as const;

  const EXPECTED_TYPES: Record<string, string[]> = {
    "on/off": ["toggle", "on", "off"],
    "brightness": ["brightness"],
    "color": ["color"],
    "color-temp": ["color-temp"],
    "energy-monitoring": ["read-energy"],
  };

  it("every capability maps to at least one descriptor", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(CAPABILITY_ACTION_MAP[cap]).toBeDefined();
      expect(CAPABILITY_ACTION_MAP[cap].length).toBeGreaterThan(0);
    }
  });

  it("Property 8: for any subset of capabilities, all expected action types appear in the derived catalog", () => {
    fc.assert(
      fc.property(
        fc.subarray([...ALL_CAPABILITIES]),
        (subset) => {
          const catalog = subset.flatMap((cap) => CAPABILITY_ACTION_MAP[cap] ?? []);
          const catalogTypes = catalog.map((d) => d.type);

          for (const cap of subset) {
            const expected = EXPECTED_TYPES[cap];
            for (const expectedType of expected) {
              expect(catalogTypes).toContain(expectedType);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("brightness descriptor has brightness param schema with range 0–100", () => {
    const descriptor = CAPABILITY_ACTION_MAP["brightness"][0];
    const props = (descriptor.params as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    expect(props.brightness.minimum).toBe(0);
    expect(props.brightness.maximum).toBe(100);
  });

  it("color descriptor has hue (0–65535) and saturation (0–254) param schemas", () => {
    const descriptor = CAPABILITY_ACTION_MAP["color"][0];
    const props = (descriptor.params as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    expect(props.hue.minimum).toBe(0);
    expect(props.hue.maximum).toBe(65535);
    expect(props.saturation.minimum).toBe(0);
    expect(props.saturation.maximum).toBe(254);
  });

  it("color-temp descriptor has ct param schema", () => {
    const descriptor = CAPABILITY_ACTION_MAP["color-temp"][0];
    const props = (descriptor.params as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    expect(props.ct).toBeDefined();
    expect(props.ct.type).toBe("number");
  });
});
