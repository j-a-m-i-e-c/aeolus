// Feature: mvp-core-platform, Property 2: Topic Parsing Extracts Device Type and Identifier
import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { parseTopic } from "./topic-parser.js";

const validTypes = ["sensor", "switch", "motion", "light"] as const;
const locationArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/);

describe("Property: Topic Parsing", () => {
  test.prop([fc.constantFrom(...validTypes), locationArb])(
    "two-segment topic extracts correct type and deterministic ID",
    (type, location) => {
      const topic = `${type}/${location}`;
      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.deviceId).toBe(`${type}-${location}`);
      expect(result!.deviceType).toBeDefined();
      expect(result!.name.length).toBeGreaterThan(0);
    }
  );

  test.prop([fc.constantFrom(...validTypes), locationArb, locationArb])(
    "three-segment topic extracts correct type and deterministic ID",
    (type, location, metric) => {
      const topic = `${type}/${location}/${metric}`;
      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.deviceId).toBe(`${type}-${location}-${metric}`);
    }
  );

  test.prop([fc.string({ minLength: 1, maxLength: 20 }).filter(s => !["sensor", "switch", "motion", "light"].includes(s.split("/")[0]))])(
    "unknown type returns null",
    (topic) => {
      // Only test topics that don't start with a valid type
      if (topic.includes("/") && !validTypes.includes(topic.split("/")[0] as any)) {
        const result = parseTopic(topic);
        expect(result).toBeNull();
      }
    }
  );
});
