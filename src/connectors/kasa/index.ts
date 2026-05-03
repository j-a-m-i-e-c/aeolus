// src/connectors/kasa/index.ts — TP-Link Kasa connector module exports

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
  SnippetDescriptor,
} from "../connector.interface.js";
import type { ActionHandler } from "../../automations/action-executor.js";
import type { ConditionFactory } from "../../automations/condition-registry.js";
import { KasaConnector } from "./kasa-connector.js";

export const metadata: ConnectorMetadata = {
  id: "kasa",
  displayName: "TP-Link Kasa",
  icon: "plug",
  description: "TP-Link Kasa smart plugs and switches via local Wi-Fi",
  supportedDeviceTypes: ["plug", "light", "switch"],
  requiresSetup: false,
};

export const configSchema: ConnectorConfigSchema = [
  {
    id: "broadcastAddress",
    label: "Broadcast Address",
    type: "text",
    required: false,
    default: "255.255.255.255",
    helpText: "UDP broadcast address for device discovery",
  },
  {
    id: "discoveryTimeout",
    label: "Discovery Timeout (ms)",
    type: "number",
    required: false,
    default: 10000,
    helpText: "How long to scan for devices (milliseconds)",
  },
];

export function createConnector(config: Record<string, unknown>): Connector {
  return new KasaConnector(config);
}

export const snippets: SnippetDescriptor[] = [
  {
    id: "toggle-plug",
    name: "Toggle Kasa Plug",
    description: "Toggle a specific Kasa smart plug on or off",
    code: `function toggleKasaPlug(ctx) {
  devices.action("kasa-my-plug", "toggle");
  log.info("Toggled Kasa plug");
}`,
  },
  {
    id: "turn-on-plug",
    name: "Turn On Kasa Plug",
    description: "Turn on a specific Kasa smart plug",
    code: `function turnOnKasaPlug(ctx) {
  devices.action("kasa-my-plug", "on");
  log.info("Turned on Kasa plug");
}`,
  },
  {
    id: "turn-off-plug",
    name: "Turn Off Kasa Plug",
    description: "Turn off a specific Kasa smart plug",
    code: `function turnOffKasaPlug(ctx) {
  devices.action("kasa-my-plug", "off");
  log.info("Turned off Kasa plug");
}`,
  },
  {
    id: "check-energy",
    name: "Condition: High Power Draw",
    description: "Check if a Kasa plug is drawing more than a threshold wattage",
    code: `function isHighPowerDraw(ctx) {
  const plug = devices.get("kasa-my-plug");
  const power = (plug?.state?.power as number) ?? 0;
  return power > 100; // watts
}`,
  },
  {
    id: "all-plugs-off",
    name: "All Kasa Plugs Off",
    description: "Turn off every Kasa plug in the system",
    code: `function allKasaPlugsOff(ctx) {
  const plugs = devices.filter(d => d.integration === "kasa" && d.type === "plug");
  for (const plug of plugs) {
    if (plug.state.on) {
      devices.action(plug.id, "off");
    }
  }
  log.info(\`Turned off \${plugs.length} Kasa plugs\`);
}`,
  },
];

// ── Contributed action handlers ─────────────────────────────────────────────

export const actionHandlers: Record<string, ActionHandler> = {
  /** Log current energy usage for a Kasa device. */
  kasa_energy_report: (action, ruleId, deps) => {
    const deviceId = action.target;
    const energy = action.params.energy ?? "no energy data available";
    deps.logger.info(
      { ruleId, deviceId, energy },
      `Kasa energy report for ${deviceId}: ${JSON.stringify(energy)}`,
    );
  },
};

// ── Contributed condition factories ─────────────────────────────────────────

export const conditions: Record<string, ConditionFactory> = {
  /** Check if a Kasa plug's power draw exceeds a threshold. */
  power_above: (conditionValue: string) => {
    const threshold = Number(conditionValue);
    return (ctx) => Number(ctx.state.power) > threshold;
  },
};
