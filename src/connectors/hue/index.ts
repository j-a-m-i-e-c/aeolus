// src/connectors/hue/index.ts — Philips Hue connector module exports

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
  SnippetDescriptor,
} from "../connector.interface.js";
import type { ActionHandler } from "../../automations/action-executor.js";
import type { ConditionFactory } from "../../automations/condition-registry.js";
import { HueConnector } from "./hue-connector.js";

export const metadata: ConnectorMetadata = {
  id: "hue",
  displayName: "Philips Hue",
  icon: "lightbulb",
  description: "Philips Hue smart lighting via local bridge API. Pair your bridge with one button press, then add new lights directly from Aeolus using Zigbee search — no Hue app needed.",
  supportedDeviceTypes: ["light"],
  requiresSetup: true,
};

export const configSchema: ConnectorConfigSchema = [
  {
    id: "bridgeIp",
    label: "Bridge IP",
    type: "text",
    required: false,
    placeholder: "192.168.1.100",
    helpText: "IP address of your Hue bridge (discovered during setup)",
  },
  {
    id: "apiKey",
    label: "API Key",
    type: "password",
    required: false,
    helpText: "API key obtained during bridge pairing (generated during setup)",
  },
];

export function createConnector(config: Record<string, unknown>): Connector {
  return new HueConnector(config);
}

export const snippets: SnippetDescriptor[] = [
  {
    id: "toggle-light",
    name: "Toggle Hue Light",
    description: "Toggle a specific Hue light on or off",
    code: `function toggleHueLight(context) {
  devices.action("hue-light-1", "toggle");
  log.info("Toggled Hue light");
  state.set("lastToggled", "hue-light-1");
}`,
  },
  {
    id: "set-brightness",
    name: "Set Brightness",
    description: "Set a Hue light to a specific brightness (0-254)",
    code: `function setHueBrightness(context) {
  devices.action("hue-light-1", "brightness", { brightness: 128 });
  log.info("Set Hue light brightness to 50%");
  state.set("brightness", 128);
}`,
  },
  {
    id: "dim-all-lights",
    name: "Dim All Hue Lights",
    description: "Set all Hue lights to a low brightness",
    code: `function dimAllHueLights(context) {
  const hueLights = devices.filter(d => d.integration === "hue" && d.type === "light");
  for (const light of hueLights) {
    devices.action(light.id, "brightness", { brightness: 60 });
  }
  log.info(\`Dimmed \${hueLights.length} Hue lights\`);
  state.set("dimmedCount", hueLights.length);
}`,
  },
  {
    id: "lights-off",
    name: "All Hue Lights Off",
    description: "Turn off every Hue light in the system",
    code: `function allHueLightsOff(context) {
  const hueLights = devices.filter(d => d.integration === "hue" && d.type === "light");
  for (const light of hueLights) {
    if (light.state.on) {
      devices.action(light.id, "toggle");
    }
  }
  log.info(\`Turned off \${hueLights.length} Hue lights\`);
  state.set("allOff", true);
}`,
  },
  {
    id: "is-light-on",
    name: "Condition: Hue Light Is On",
    description: "Check if a specific Hue light is currently on",
    code: `function isHueLightOn(context) {
  const light = devices.get("hue-light-1");
  return light !== undefined && light.state.on === true;
}`,
  },
  // ── UI snippets ──
  {
    id: "ui-light-toggle",
    name: "Light Toggle Card",
    description: "Card with on/off toggle for a Hue light",
    mode: "ui",
    code: `const hueLights = props.devices.filter(d => d.integration === "hue");
// In JSX:
// {hueLights.map(light => (
//   <div key={light.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0F14] border border-[#2A3441]">
//     <span className="text-sm text-[#E6EDF3]">{light.name}</span>
//     <button
//       onClick={() => props.deviceAction(light.id, "toggle")}
//       className={\`px-3 py-1 rounded text-xs font-medium \${light.state.on ? "bg-[#F59E0B]/20 text-[#F59E0B]" : "bg-[#6B7785]/20 text-[#6B7785]"}\`}
//     >
//       {light.state.on ? "On" : "Off"}
//     </button>
//   </div>
// ))}`,
  },
  {
    id: "ui-brightness-slider",
    name: "Brightness Slider",
    description: "Range input to control Hue light brightness",
    mode: "ui",
    code: `<input
  type="range"
  min={0}
  max={254}
  defaultValue={128}
  onChange={(e) => props.deviceAction("hue-light-1", "brightness", { brightness: Number(e.target.value) })}
  className="w-full accent-[#F59E0B]"
/>`,
  },
  {
    id: "ui-all-lights-off",
    name: "All Lights Off Button",
    description: "Button to turn off all Hue lights at once",
    mode: "ui",
    code: `<button
  onClick={() => {
    const hueLights = props.devices.filter(d => d.integration === "hue");
    hueLights.forEach(light => {
      if (light.state.on) props.deviceAction(light.id, "toggle");
    });
  }}
  className="px-4 py-2 rounded-lg text-xs font-medium bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444]/30 transition-colors"
>
  All Lights Off
</button>`,
  },
  {
    id: "set-color",
    name: "Set Color",
    description: "Set a Hue light to a specific color (hue 0-65535, saturation 0-254)",
    code: `function setHueColor(context) {
  devices.action("hue-light-1", "color", { hue: 21845, saturation: 254 });
  log.info("Set Hue light to green");
  state.set("lastColor", "green");
}`,
  },
  {
    id: "set-color-temp",
    name: "Set Color Temperature",
    description: "Set a Hue light to a specific color temperature (mirek value, 153=cool to 500=warm)",
    code: `function setHueColorTemp(context) {
  devices.action("hue-light-1", "color-temp", { ct: 300 });
  log.info("Set Hue light to neutral white (300 mirek)");
  state.set("colorTemp", 300);
}`,
  },
  {
    id: "ui-color-temp-slider",
    name: "Color Temperature Slider",
    description: "Range input to control Hue light color temperature",
    mode: "ui",
    code: `<div className="space-y-1">
  <label className="text-[10px] text-[#6B7785]">Color Temperature</label>
  <input
    type="range"
    min={153}
    max={500}
    defaultValue={300}
    onChange={(e) => props.deviceAction("hue-light-1", "color-temp", { ct: Number(e.target.value) })}
    className="w-full"
    style={{ background: "linear-gradient(to right, #A6C8FF, #FFD580, #FF9F43)" }}
  />
  <div className="flex justify-between text-[9px] text-[#6B7785]">
    <span>Cool</span>
    <span>Warm</span>
  </div>
</div>`,
  },
];

// ── Contributed action handlers ─────────────────────────────────────────────

export const actionHandlers: Record<string, ActionHandler> = {
  /** Activate a Hue scene by name. */
  hue_scene: async (action, ruleId, deps) => {
    const sceneName = typeof action.params.sceneName === "string"
      ? action.params.sceneName
      : "unknown";
    deps.logger.info(
      { ruleId, sceneName },
      `Activating Hue scene: ${sceneName}`,
    );
    await deps.connectorManager.executeAction(action.target, {
      type: "scene",
      deviceId: action.target,
      params: { sceneName },
    });
  },

  /** Start or stop a color loop on a Hue light. */
  hue_color_loop: async (action, ruleId, deps) => {
    const enable = action.params.enable === true;
    const deviceId = action.target;
    deps.logger.info(
      { ruleId, deviceId, enable },
      `${enable ? "Starting" : "Stopping"} color loop on Hue light: ${deviceId}`,
    );
    await deps.connectorManager.executeAction(deviceId, {
      type: "color_loop",
      deviceId,
      params: { enable },
    });
  },
};

// ── Contributed condition factories ─────────────────────────────────────────

export const conditions: Record<string, ConditionFactory> = {
  /** Check if a Hue light's brightness exceeds a threshold. */
  brightness_above: (conditionValue: string) => {
    const threshold = Number(conditionValue);
    return (context) => Number(context.state.brightness) > threshold;
  },
};
