// src/connectors/_template/index.ts — Template connector module exports
//
// HOW TO USE THIS TEMPLATE:
//   1. Copy the entire `_template/` folder to `src/connectors/<your-connector>/`
//   2. Rename this file's exports to match your connector
//   3. Update metadata, configSchema, and the createConnector factory below
//   4. Implement the Connector interface in `connector.ts`
//   5. The ConnectorRegistry will auto-discover your connector on next startup
//
// No changes to core files are required — just create the folder and implement.

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
  SnippetDescriptor,
} from "../connector.interface.js";
import { TemplateConnector } from "./connector.js";

/**
 * Static metadata for this connector.
 *
 * - `id` must be unique across all connectors (used as DB key and device integration field)
 * - `icon` must be a valid lucide-react icon name
 * - `supportedDeviceTypes` determines which device categories this connector produces
 * - `requiresSetup` — set to true if your connector needs a multi-step pairing wizard
 */
export const metadata: ConnectorMetadata = {
  id: "my-connector",                          // ← Change: unique connector identifier
  displayName: "My Connector",                 // ← Change: shown in the dashboard
  icon: "cpu",                                 // ← Change: lucide-react icon name
  description: "A short description of what this connector does", // ← Change
  supportedDeviceTypes: ["light"],             // ← Change: device types this connector produces
  requiresSetup: false,                        // ← Change: true if multi-step setup needed
};

/**
 * Configuration schema — defines the fields shown in the dashboard config form.
 *
 * Each field becomes a key in the `config` object passed to `createConnector()`.
 * Required fields are validated by the REST API before enabling the connector.
 */
export const configSchema: ConnectorConfigSchema = [
  {
    id: "host",                                // ← Change: config field key
    label: "Host Address",                     // ← Change: form label
    type: "text",                              // text | number | password | boolean | select
    required: true,
    placeholder: "192.168.1.100",              // ← Change: placeholder text
    helpText: "IP address or hostname of the device", // ← Change: help text
  },
  {
    id: "apiKey",                              // ← Change: config field key
    label: "API Key",                          // ← Change: form label
    type: "password",
    required: false,
    helpText: "Authentication key (if required)",
  },
];

/**
 * Factory function — creates a new connector instance with the given config.
 *
 * Called by the ConnectorManager when this connector is enabled.
 * The `config` object contains values matching the `configSchema` field ids,
 * with defaults applied for optional fields the user did not provide.
 */
export function createConnector(config: Record<string, unknown>): Connector {
  return new TemplateConnector(config);
}

/**
 * Code snippets for the automation script editor.
 *
 * These appear grouped under your connector's display name in the snippet picker.
 * Include snippets for common actions, conditions, and patterns specific to your
 * connector's devices. Use named functions so they work as automation() blocks.
 */
export const snippets: SnippetDescriptor[] = [
  // ← Add snippets for your connector's devices, e.g.:
  // {
  //   id: "toggle-device",
  //   name: "Toggle My Device",
  //   description: "Toggle a device managed by this connector",
  //   code: `function toggleMyDevice(ctx) {\n  devices.action("my-connector-device-1", "toggle");\n  log.info("Toggled device");\n}`,
  // },
];
