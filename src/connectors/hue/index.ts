// src/connectors/hue/index.ts — Philips Hue connector module exports

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
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
