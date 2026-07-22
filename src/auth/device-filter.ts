// src/auth/device-filter.ts — Pure device-selection matching for live device exposure

import type { Device } from "../core/types.js";

/**
 * Minimal pane shape needed to evaluate device exposure. Mirrors the parsed
 * `panes` row: the pane type and its config (only `deviceType` is consulted for
 * narrowing).
 */
export interface DeviceFilterPane {
  paneType: string;
  config: Record<string, unknown>;
}

/**
 * The allowlist of purposeful, scoped device panes. These are the ONLY pane
 * types that expose devices for authorization. Every other pane type — including
 * the `device-grid` ("all devices") pane, which is being removed from the
 * product, and any unknown or legacy pane type — is non-exposing by default.
 */
const PURPOSEFUL_DEVICE_PANES = new Set([
  "hue-control",
  "kasa-control",
  "sensor-panel",
]);

/**
 * Does this pane's device-selection filter include this device?
 *
 * This is an allowlist: it returns `true` only for the purposeful scoped device
 * panes and `false` by default for every other pane type, regardless of config.
 * Because it is default-`false`, a `device-grid` pane and any unknown or legacy
 * pane type never match a device, so they contribute no device exposure. This is
 * the device counterpart to the automation extractor, but its output is never
 * persisted — it is evaluated live against the current device inventory.
 *
 * Per-pane scope (mirrors the frontend pane components):
 * - `hue-control`  → Hue lights (`integration === "hue" && type === "light"`)
 * - `kasa-control` → Kasa devices (`integration === "kasa"`)
 * - `sensor-panel` → sensor-type devices (`type === "sensor"`)
 *
 * For these purposeful panes only, a string `config.deviceType` further narrows
 * the match by additionally requiring `device.type === config.deviceType`. A
 * config that cannot be interpreted is treated conservatively (it never widens
 * the pane's base scope).
 */
export function matchesDeviceFilter(pane: DeviceFilterPane, device: Device): boolean {
  if (!PURPOSEFUL_DEVICE_PANES.has(pane.paneType)) {
    return false;
  }

  let matches: boolean;
  switch (pane.paneType) {
    case "hue-control":
      matches = device.integration === "hue" && device.type === "light";
      break;
    case "kasa-control":
      matches = device.integration === "kasa";
      break;
    case "sensor-panel":
      matches = device.type === "sensor";
      break;
    default:
      // Unreachable given the allowlist guard above; fail closed.
      return false;
  }

  if (!matches) {
    return false;
  }

  // Optional narrowing by device type on purposeful panes.
  const deviceType = pane.config?.deviceType;
  if (typeof deviceType === "string" && deviceType.length > 0) {
    return device.type === deviceType;
  }

  return matches;
}
