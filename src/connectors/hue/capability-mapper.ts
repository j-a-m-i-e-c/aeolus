// src/connectors/hue/capability-mapper.ts — Pure module for mapping Hue light types to capability sets

/**
 * The set of capabilities a Hue light can have.
 */
export type HueCapability = "on/off" | "brightness" | "color" | "color-temperature";

/**
 * Describes the capabilities of a Hue light, derived from its type string.
 */
export interface CapabilitySet {
  capabilities: HueCapability[];
  hasColor: boolean;
  hasColorTemp: boolean;
  hasBrightness: boolean;
}

/**
 * Shape returned by GET /api/{key}/lights/{id} from the Hue bridge.
 */
export interface RawHueLight {
  state: {
    on: boolean;
    bri: number;
    hue?: number;
    sat?: number;
    ct?: number;
    colormode?: "hs" | "ct" | "xy";
    reachable: boolean;
  };
  type: string;
  name: string;
  modelid: string;
  manufacturername: string;
  uniqueid: string;
  swversion: string;
  capabilities?: {
    control?: {
      ct?: { min: number; max: number };
      colorgamuttype?: "A" | "B" | "C";
    };
  };
  config?: {
    archetype?: string;
  };
}

/**
 * Maps a Hue bridge light `type` string to a CapabilitySet.
 *
 * Known types are mapped to their exact capability sets.
 * Unknown/unrecognized types default to on/off + brightness as a safe fallback.
 */
export function mapTypeToCapabilities(type: string): CapabilitySet {
  let capabilities: HueCapability[];

  switch (type) {
    case "Extended color light":
      capabilities = ["on/off", "brightness", "color", "color-temperature"];
      break;
    case "Color temperature light":
      capabilities = ["on/off", "brightness", "color-temperature"];
      break;
    case "Dimmable light":
      capabilities = ["on/off", "brightness"];
      break;
    case "On/Off plug-in unit":
    case "On/Off light":
      capabilities = ["on/off"];
      break;
    default:
      // Safe default: assume at least dimmable
      capabilities = ["on/off", "brightness"];
      break;
  }

  return {
    capabilities,
    hasColor: capabilities.includes("color"),
    hasColorTemp: capabilities.includes("color-temperature"),
    hasBrightness: capabilities.includes("brightness"),
  };
}

/**
 * Extracts capability-appropriate state fields from a raw Hue light object.
 * Only includes color/ct fields when the capability set permits.
 */
export function extractDeviceState(
  rawLight: RawHueLight,
  capabilitySet: CapabilitySet,
): Record<string, unknown> {
  const state: Record<string, unknown> = {
    on: rawLight.state.on,
    reachable: rawLight.state.reachable,
    lightType: rawLight.type,
    modelId: rawLight.modelid,
    manufacturer: rawLight.manufacturername,
    archetype: rawLight.config?.archetype ?? "unknown",
  };

  if (capabilitySet.hasBrightness) {
    // Store Canonical_Brightness (0–100), converted from the Hue-native 0–254
    // `bri` scale, so normalized state and the command contract share one
    // representation end-to-end (see H6). The connector translates back to
    // 0–254 only at the Hue API boundary in execute().
    state.brightness = Math.round((rawLight.state.bri / 254) * 100);
  }

  if (capabilitySet.hasColor) {
    state.hue = rawLight.state.hue;
    state.saturation = rawLight.state.sat;
    state.colorMode = rawLight.state.colormode;
    state.gamutType = rawLight.capabilities?.control?.colorgamuttype ?? null;
  }

  if (capabilitySet.hasColorTemp) {
    state.ct = rawLight.state.ct;
    state.ctMin = rawLight.capabilities?.control?.ct?.min ?? 153;
    state.ctMax = rawLight.capabilities?.control?.ct?.max ?? 500;
  }

  return state;
}

/**
 * Clamps a hue value to the valid range [0, 65535].
 */
export function clampHue(value: number): number {
  return Math.max(0, Math.min(value, 65535));
}

/**
 * Clamps a saturation value to the valid range [0, 254].
 */
export function clampSaturation(value: number): number {
  return Math.max(0, Math.min(value, 254));
}

/**
 * Clamps a color temperature value to the light's supported range [ctMin, ctMax].
 */
export function clampCt(value: number, ctMin: number, ctMax: number): number {
  return Math.max(ctMin, Math.min(value, ctMax));
}
