// src/connectors/kasa/index.ts — TP-Link Kasa connector module exports

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
  SnippetDescriptor,
  ConnectorActionContribution,
} from "../connector.interface.js";

import type { ConditionFactory } from "../../automations/condition-registry.js";
import { KasaConnector } from "./kasa-connector.js";

export const metadata: ConnectorMetadata = {
  id: "kasa",
  displayName: "TP-Link Kasa",
  icon: "plug",
  description: "TP-Link Kasa smart plugs and switches via local Wi-Fi",
  supportedDeviceTypes: ["plug", "switch"],
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
    code: `const result = await devices.action("kasa-my-plug", "toggle");
if (!result.success) throw new Error(result.error ?? "Kasa command failed");
state.set("lastToggled", "kasa-my-plug");`,
  },
  {
    id: "turn-on-plug",
    name: "Turn On Kasa Plug",
    description: "Turn on a specific Kasa smart plug",
    code: `const result = await devices.action("kasa-my-plug", "on");
if (!result.success) throw new Error(result.error ?? "Kasa command failed");
state.set("plugState", "on");`,
  },
  {
    id: "turn-off-plug",
    name: "Turn Off Kasa Plug",
    description: "Turn off a specific Kasa smart plug",
    code: `const result = await devices.action("kasa-my-plug", "off");
if (!result.success) throw new Error(result.error ?? "Kasa command failed");
state.set("plugState", "off");`,
  },
  {
    id: "check-energy",
    name: "Condition: High Power Draw",
    description: "Check if a Kasa plug is drawing more than a threshold wattage",
    code: `const plug = devices.get("kasa-my-plug");
const power = Number(plug?.state?.power ?? 0);
if (power <= 100) return; // watts`,
  },
  {
    id: "all-plugs-off",
    name: "All Kasa Plugs Off",
    description: "Turn off every Kasa plug in the system",
    code: `const result = await devices.actionAll(
  (device) => device.integration === "kasa" && device.type === "plug" && device.state.on === true,
  "off",
);
log.info(\`Turned off \${result.succeeded} Kasa plugs; \${result.failed} failed\`);`,
  },
  // ── UI snippets ──
  {
    id: "ui-plug-toggle",
    name: "Plug Toggle Card",
    description: "Card with on/off toggle for a Kasa plug",
    mode: "ui",
    code: `const kasaPlugs = aeolus.devices.filter(d => d.integration === "kasa" && d.type === "plug");
// In JSX:
// {kasaPlugs.map(plug => (
//   <div key={plug.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0F14] border border-[#2A3441]">
//     <span className="text-sm text-[#E6EDF3]">{plug.name}</span>
//     <button
//       onClick={() => aeolus.control(plug.id, "toggle")}
//       className={\`px-3 py-1 rounded text-xs font-medium \${plug.state.on ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#6B7785]/20 text-[#6B7785]"}\`}
//     >
//       {plug.state.on ? "On" : "Off"}
//     </button>
//   </div>
// ))}`,
  },
  {
    id: "ui-energy-stats",
    name: "Energy Stats Display",
    description: "Show power, voltage, and current for a Kasa plug",
    mode: "ui",
    code: `const plug = aeolus.devices.find(d => d.id === "kasa-my-plug");
// In JSX:
// {plug && (
//   <div className="grid grid-cols-3 gap-2">
//     <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
//       <div className="text-[10px] text-[#6B7785]">Power</div>
//       <div className="text-sm font-bold text-[#E6EDF3]">{plug.state.power ?? 0}W</div>
//     </div>
//     <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
//       <div className="text-[10px] text-[#6B7785]">Voltage</div>
//       <div className="text-sm font-bold text-[#E6EDF3]">{plug.state.voltage ?? 0}V</div>
//     </div>
//     <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
//       <div className="text-[10px] text-[#6B7785]">Current</div>
//       <div className="text-sm font-bold text-[#E6EDF3]">{plug.state.current ?? 0}A</div>
//     </div>
//   </div>
// )}`,
  },
  {
    id: "ui-all-plugs-off",
    name: "All Plugs Off Button",
    description: "Button to turn off all Kasa plugs at once",
    mode: "ui",
    code: `<button
  onClick={() => {
    const plugs = aeolus.devices.filter(d => d.integration === "kasa" && d.type === "plug");
    plugs.forEach(plug => {
      if (plug.state.on) aeolus.control(plug.id, "off");
    });
  }}
  className="px-4 py-2 rounded-lg text-xs font-medium bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444]/30 transition-colors"
>
  All Plugs Off
</button>`,
  },
];

// ── Contributed action handlers ─────────────────────────────────────────────

export const actionHandlers: Record<string, ConnectorActionContribution> = {
  /** Log current energy usage; reporting does not change a physical device. */
  kasa_energy_report: {
    physical: false,
    handler: (action, ruleId, deps) => {
    const deviceId = action.target;
    const energy = action.params.energy ?? "no energy data available";
    deps.logger.info(
      { ruleId, deviceId, energy },
      `Kasa energy report for ${deviceId}: ${JSON.stringify(energy)}`,
    );
    },
  },
};

// ── Contributed condition factories ─────────────────────────────────────────

export const conditions: Record<string, ConditionFactory> = {
  /** Check if a Kasa plug's power draw exceeds a threshold. */
  power_above: (conditionValue: string) => {
    const threshold = Number(conditionValue);
    return (context) => Number(context.state.power) > threshold;
  },
};
