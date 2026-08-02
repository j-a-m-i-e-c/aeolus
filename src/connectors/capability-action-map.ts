// src/connectors/capability-action-map.ts
// Fallback mapping from capability strings to CapabilityDescriptor arrays.
// Used when a connector does not provide explicit descriptors for a device.

import type { CapabilityDescriptor } from "./connector.interface.js";

/**
 * Maps each known capability string to the action descriptors it enables.
 *
 * When a connector does not implement `getActionCatalog()`, ConnectorManager
 * derives the Action_Catalog for a device by looking up each entry in
 * `device.capabilities` against this map and flattening the results.
 *
 * Requirements: 4.1, 4.4, 4.5, 4.6, 4.7, 4.8
 */
export const CAPABILITY_ACTION_MAP: Record<string, CapabilityDescriptor[]> = {
  /** Requirement 4.4 — on/off → toggle, on, off */
  "on/off": [
    {
      type: "toggle",
      label: "Toggle",
      description: "Toggle the device on or off",
      params: {},
    },
    {
      type: "on",
      label: "Turn On",
      description: "Turn the device on",
      params: {},
    },
    {
      type: "off",
      label: "Turn Off",
      description: "Turn the device off",
      params: {},
    },
  ],

  /** Requirement 4.5 — brightness → brightness with value param (0–100 canonical percentage) */
  brightness: [
    {
      type: "brightness",
      label: "Set Brightness",
      description: "Set brightness level as a percentage (0–100). Connectors translate to their device-native scale.",
      params: {
        type: "object",
        required: ["brightness"],
        properties: {
          brightness: { type: "number", minimum: 0, maximum: 100 },
        },
      },
    },
  ],

  /** Requirement 4.6 — color → color with hue (0–65535) and saturation (0–254) params */
  color: [
    {
      type: "color",
      label: "Set Color",
      description: "Set hue and saturation",
      params: {
        type: "object",
        required: ["hue", "saturation"],
        properties: {
          hue: { type: "number", minimum: 0, maximum: 65535 },
          saturation: { type: "number", minimum: 0, maximum: 254 },
        },
      },
    },
  ],

  /** Requirement 4.7 — color-temp → color-temp with ct param */
  "color-temp": [
    {
      type: "color-temp",
      label: "Set Color Temperature",
      description: "Set color temperature in mireds",
      params: {
        type: "object",
        required: ["ct"],
        properties: {
          ct: { type: "number" },
        },
      },
    },
  ],

  /** Requirement 4.8 — energy-monitoring → read-energy */
  "energy-monitoring": [
    {
      type: "read-energy",
      label: "Read Energy",
      description: "Read current power consumption data",
      params: {},
    },
  ],
};

/**
 * MQTT command descriptor — always included in the Action_Catalog for
 * devices whose `integration` field equals `"mqtt"`.
 *
 * Requirement: 5.7
 */
export const MQTT_COMMAND_DESCRIPTOR: CapabilityDescriptor = {
  type: "command",
  label: "Send Command",
  description: "Publish a command payload to the device's command topic",
  params: {
    type: "object",
    properties: {
      payload: { type: ["string", "object"] },
    },
  },
};
