// src/mqtt/topic-parser.ts — Parse MQTT topic strings into device metadata

/** Result of parsing an MQTT topic */
export interface ParsedTopic {
  /** Deterministic ID: all topic segments joined with hyphens */
  deviceId: string;
  /** Device type: first segment, lowercased */
  deviceType: string;
  /** Human-readable name derived from topic segments */
  name: string;
}

/**
 * Recognized device type strings used as a heuristic hint for:
 * 1. Name derivation (known types strip the type from the display name)
 * 2. Capability inference in the device registry
 *
 * NOT used as a gate — topics with unknown types are still fully parsed.
 */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "sensor",
  "switch",
  "light",
  "climate",
  "plug",
  "valve",
  "pump",
  "motion",
  "fan",
  "lock",
  "cover",
]);

/** Title-case a single string segment: uppercase first char, rest unchanged */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse any valid MQTT topic into structured device metadata.
 * Returns null ONLY for invalid inputs (empty string, non-string, or
 * all-empty-segments after splitting on `/`).
 * Never rejects a topic based on its content.
 */
export function parseTopic(topic: string): ParsedTopic | null {
  if (!topic || typeof topic !== "string") return null;

  const segments = topic.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  // Device ID: all segments joined with hyphens, casing preserved
  const deviceId = segments.join("-");

  // Device type: first segment, lowercased
  const deviceType = segments[0].toLowerCase();

  // Name derivation
  let name: string;
  if (segments.length === 1) {
    // Single segment → title-case that segment
    name = titleCase(segments[0]);
  } else if (KNOWN_TYPES.has(deviceType)) {
    // Known type with ≥2 segments → title-case remaining segments, join with spaces
    name = segments.slice(1).map(titleCase).join(" ");
  } else {
    // Unknown type with ≥2 segments → title-case ALL segments, join with spaces
    name = segments.map(titleCase).join(" ");
  }

  return { deviceId, deviceType, name };
}

/**
 * Reconstruct a canonical MQTT topic string from a ParsedTopic.
 * Uses the deviceId (hyphen-separated) split back into segments joined with "/".
 */
export function prettyPrintTopic(parsed: ParsedTopic): string {
  return parsed.deviceId.split("-").join("/");
}
