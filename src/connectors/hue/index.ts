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
    required: true,
    placeholder: "192.168.1.100",
    helpText: "IP address of your Hue bridge",
  },
  {
    id: "apiKey",
    label: "API Key",
    type: "password",
    required: true,
    helpText: "API key obtained during bridge pairing",
  },
];

export function createConnector(config: Record<string, unknown>): Connector {
  return new HueConnector(config);
}
