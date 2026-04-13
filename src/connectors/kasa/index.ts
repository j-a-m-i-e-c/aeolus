// src/connectors/kasa/index.ts — TP-Link Kasa connector module exports

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
} from "../connector.interface.js";
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
