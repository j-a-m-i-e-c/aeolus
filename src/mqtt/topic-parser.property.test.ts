// Feature: mqtt-topic-overhaul — Property-based tests for the universal topic parser
import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { KNOWN_TYPES, parseTopic, prettyPrintTopic } from "./topic-parser.js";

// --- Generators ---

/** A single topic segment: 1–15 chars from [a-zA-Z0-9_] (no hyphens, safe for round-trip) */
const segmentArb = fc.stringMatching(/^[a-zA-Z0-9_]{1,15}$/);

/** A valid MQTT topic: 1–10 segments joined with "/" */
const validTopicArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 10 })
  .map((segs) => segs.join("/"));

/** Pick a known type from the KNOWN_TYPES set */
const knownTypesArray = [...KNOWN_TYPES];
const knownTypeArb = fc.constantFrom(...knownTypesArray);

/** A segment whose lowercase form is NOT in KNOWN_TYPES */
const unknownTypeSegmentArb = segmentArb.filter(
  (s) => !KNOWN_TYPES.has(s.toLowerCase())
);

/** Multi-segment topic (≥2 segments) where the first segment is a known type */
const knownTypeMultiSegmentTopicArb = fc
  .tuple(knownTypeArb, fc.array(segmentArb, { minLength: 1, maxLength: 9 }))
  .map(([type, rest]) => [type, ...rest].join("/"));

/** Multi-segment topic (≥2 segments) where the first segment is NOT a known type */
const unknownTypeMultiSegmentTopicArb = fc
  .tuple(unknownTypeSegmentArb, fc.array(segmentArb, { minLength: 1, maxLength: 9 }))
  .map(([type, rest]) => [type, ...rest].join("/"));

/** Single-segment topic */
const singleSegmentTopicArb = segmentArb;

/** Title-case helper matching the implementation */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Property Tests ---

describe("Feature: mqtt-topic-overhaul — Property-Based Tests", () => {
  // Property 1: Universal Acceptance
  // **Validates: Requirements 1.1, 1.2**
  test.prop([validTopicArb], { numRuns: 100 })(
    "Property 1: Universal Acceptance — parseTopic returns non-null ParsedTopic with all fields populated for any valid topic",
    (topic) => {
      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.deviceId).toBeTruthy();
      expect(result!.deviceType).toBeTruthy();
      expect(result!.name).toBeTruthy();
      expect(typeof result!.deviceId).toBe("string");
      expect(typeof result!.deviceType).toBe("string");
      expect(typeof result!.name).toBe("string");
    }
  );

  // Property 2: Device Type Equals First Segment — Unknown Types
  // **Validates: Requirements 1.3**
  test.prop([unknownTypeMultiSegmentTopicArb], { numRuns: 100 })(
    "Property 2: Device Type Equals First Segment (Unknown Types) — deviceType equals first segment lowercased",
    (topic) => {
      const firstSegment = topic.split("/")[0];
      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.deviceType).toBe(firstSegment.toLowerCase());
    }
  );

  // Property 3: Device Type Equals First Segment — Known Types
  // **Validates: Requirements 1.4**
  test.prop([knownTypeMultiSegmentTopicArb], { numRuns: 100 })(
    "Property 3: Device Type Equals First Segment (Known Types) — deviceType equals the known type string",
    (topic) => {
      const firstSegment = topic.split("/")[0];
      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.deviceType).toBe(firstSegment.toLowerCase());
      expect(KNOWN_TYPES.has(result!.deviceType)).toBe(true);
    }
  );

  // Property 4: Deterministic Device ID from Segments
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
  test.prop([validTopicArb], { numRuns: 100 })(
    "Property 4: Deterministic Device ID — deviceId equals segments joined with hyphens and is stable across parses",
    (topic) => {
      const segments = topic.split("/").filter((s) => s.length > 0);
      const expectedId = segments.join("-");

      const result1 = parseTopic(topic);
      const result2 = parseTopic(topic);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1!.deviceId).toBe(expectedId);
      expect(result1!.deviceId).toBe(result2!.deviceId);
    }
  );

  // Property 5: Name Derivation — Known Type Multi-Segment
  // **Validates: Requirements 3.1**
  test.prop([knownTypeMultiSegmentTopicArb], { numRuns: 100 })(
    "Property 5: Name Derivation (Known Type Multi-Segment) — name equals remaining segments title-cased joined with spaces",
    (topic) => {
      const segments = topic.split("/").filter((s) => s.length > 0);
      const expectedName = segments.slice(1).map(titleCase).join(" ");

      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.name).toBe(expectedName);
    }
  );

  // Property 6: Name Derivation — Unknown Type Multi-Segment
  // **Validates: Requirements 3.2**
  test.prop([unknownTypeMultiSegmentTopicArb], { numRuns: 100 })(
    "Property 6: Name Derivation (Unknown Type Multi-Segment) — name equals ALL segments title-cased joined with spaces",
    (topic) => {
      const segments = topic.split("/").filter((s) => s.length > 0);
      const expectedName = segments.map(titleCase).join(" ");

      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.name).toBe(expectedName);
    }
  );

  // Property 7: Name Derivation — Single Segment
  // **Validates: Requirements 3.3**
  test.prop([singleSegmentTopicArb], { numRuns: 100 })(
    "Property 7: Name Derivation (Single Segment) — name equals the segment title-cased",
    (topic) => {
      const expectedName = titleCase(topic);

      const result = parseTopic(topic);
      expect(result).not.toBeNull();
      expect(result!.name).toBe(expectedName);
    }
  );

  // Property 9: Parse–Print Round Trip
  // **Validates: Requirements 5.1, 5.2, 5.3**
  test.prop([validTopicArb], { numRuns: 100 })(
    "Property 9: Parse–Print Round Trip — parse(prettyPrint(parse(topic))) deeply equals parse(topic)",
    (topic) => {
      const firstParse = parseTopic(topic);
      expect(firstParse).not.toBeNull();

      const printed = prettyPrintTopic(firstParse!);
      const secondParse = parseTopic(printed);

      expect(secondParse).not.toBeNull();
      expect(secondParse).toEqual(firstParse);
    }
  );
});
