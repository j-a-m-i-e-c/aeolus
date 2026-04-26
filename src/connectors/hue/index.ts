// src/connectors/hue/index.ts — Philips Hue connector module exports

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
  SnippetDescriptor,
} from "../connector.interface.js";
import { HueConnector } from "./hue-connector.js";

export const metadata: ConnectorMetadata = {
  id: "hue",
  displayName: "Philips Hue",
  icon: "lightbulb",
  description: "Philips Hue smart lighting via local bridge API",
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
    code: `function toggleHueLight(ctx) {
  devices.action("hue-light-1", "toggle");
  log.info("Toggled Hue light");
}`,
  },
  {
    id: "set-brightness",
    name: "Set Brightness",
    description: "Set a Hue light to a specific brightness (0-254)",
    code: `function setHueBrightness(ctx) {
  devices.action("hue-light-1", "brightness", { brightness: 128 });
  log.info("Set Hue light brightness to 50%");
}`,
  },
  {
    id: "dim-all-lights",
    name: "Dim All Hue Lights",
    description: "Set all Hue lights to a low brightness",
    code: `function dimAllHueLights(ctx) {
  const hueLights = devices.filter(d => d.integration === "hue" && d.type === "light");
  for (const light of hueLights) {
    devices.action(light.id, "brightness", { brightness: 60 });
  }
  log.info(\`Dimmed \${hueLights.length} Hue lights\`);
}`,
  },
  {
    id: "lights-off",
    name: "All Hue Lights Off",
    description: "Turn off every Hue light in the system",
    code: `function allHueLightsOff(ctx) {
  const hueLights = devices.filter(d => d.integration === "hue" && d.type === "light");
  for (const light of hueLights) {
    if (light.state.on) {
      devices.action(light.id, "toggle");
    }
  }
  log.info(\`Turned off \${hueLights.length} Hue lights\`);
}`,
  },
  {
    id: "is-light-on",
    name: "Condition: Hue Light Is On",
    description: "Check if a specific Hue light is currently on",
    code: `function isHueLightOn(ctx) {
  const light = devices.get("hue-light-1");
  return light !== undefined && light.state.on === true;
}`,
  },
];
