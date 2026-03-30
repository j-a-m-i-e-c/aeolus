// src/mqtt/topic-parser.ts — Parse MQTT topic strings into device metadata

import type { DeviceType } from "../core/types.js";

/** Result of parsing an MQTT topic */
export interface ParsedTopic {
  deviceId: string;
  deviceType: DeviceType;
  name: string;
}

/** Map first topic segment to a DeviceType */
const TYPE_MAP: Record<string, DeviceType> = {
  sensor: "sensor",
  switch: "switch",
  motion: "sensor",
  light: "light",
};

/**
 * Parse an MQTT topic string following the convention:
 *   {type}/{location} or {type}/{location}/{metric}
 *
 * Returns parsed metadata or null if the topic is invalid.
 */
export function parseTopic(topic: string): ParsedTopic | null {
  if (!topic || typeof topic !== "string") return null;

  const segments = topic.split("/").filter((s) => s.length > 0);

  // Need at least two segments: type + location
  if (segments.length < 2) return null;

  const [typeSegment, ...rest] = segments;
  const deviceType = TYPE_MAP[typeSegment.toLowerCase()];

  if (!deviceType) return null;

  // Deterministic device ID: all segments joined with hyphens
  const deviceId = segments.join("-");

  // Human-readable name from location/metric segments (title-cased)
  const name = rest
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");

  return { deviceId, deviceType, name };
}
