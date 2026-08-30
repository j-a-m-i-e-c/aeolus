// src/connectors/_template/index.ts — Template connector module exports
//
// HOW TO USE THIS TEMPLATE:
//   1. Copy the entire `_template/` folder to `src/connectors/<your-connector>/`
//   2. Rename this file's exports to match your connector
//   3. Update metadata, configSchema, and the createConnector factory below
//   4. Implement the Connector interface in `connector.ts`
//   5. Register the module in the production connector list in src/index.ts
//
// Directory discovery is used by development/tests; production bundles use
// explicit registration so shipped connector code is deliberate and auditable.

import type {
  ConnectorMetadata,
  ConnectorConfigSchema,
  Connector,
  SnippetDescriptor,
  ConnectorActionContribution,
} from "../connector.interface.js";

import type { ConditionFactory } from "../../automations/condition-registry.js";
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
 * Code snippets for the automation editor.
 *
 * These appear grouped under your connector's display name in the snippet picker.
 * Include both logic snippets (for the Logic tab) and UI snippets (for the UI tab).
 *
 * - Logic snippets: use sandbox globals (devices, mqtt, log, state, etc.)
 * - UI snippets: use aeolus.* (control, publish, devices, read, etc.)
 *
 * Set `mode: "ui"` for UI snippets. Logic snippets default to "logic" when omitted.
 */
export const snippets: SnippetDescriptor[] = [
  // ← Add logic snippets for your connector's devices, e.g.:
  // {
  //   id: "toggle-device",
  //   name: "Toggle My Device",
  //   description: "Toggle a device managed by this connector",
  //   code: `const result = await devices.action("my-connector-device-1", "toggle");\nif (!result.success) throw new Error(result.error ?? "Command failed");`,
  // },
  //
  // ← Add UI snippets for custom component controls, e.g.:
  // {
  //   id: "ui-device-card",
  //   name: "Device Status Card",
  //   description: "Card showing device state with toggle button",
  //   mode: "ui",
  //   code: `const myDevices = aeolus.devices.filter(d => d.integration === "my-connector");\n// In JSX:\n// {myDevices.map(d => <div key={d.id}>{d.name}</div>)}`,
  // },
];

/**
 * Custom action handlers contributed by this connector.
 *
 * These are registered with the CommandService when the connector is enabled
 * and unregistered when it is disabled. This is an advanced extension point for
 * connector-specific command types. Normal Automation Project Logic should use
 * devices.action(), which routes ordinary device actions through execute().
 *
 * Each key is the action type string (e.g. "my_connector_special_action").
 * Prefix with your connector name to avoid collisions with other connectors.
 *
 * The handler receives:
 *   - action: { type, target (deviceId), params }
 *   - ruleId: the automation rule that triggered this action
 *   - deps: { mqttService, connectorManager, logger }
 */
export const actionHandlers: Record<string, ConnectorActionContribution> = {
  // ← Add action handlers for your connector, e.g.:
  // my_connector_special_action: {
  //   physical: true, // false for reporting/logging helpers that do not command hardware
  //   handler: async (action, ruleId, deps) => {
  //     deps.logger.info({ ruleId, deviceId: action.target }, "Executing special action");
  //     return deps.connectorManager.executeAction(action.target, {
  //       type: "special",
  //       deviceId: action.target,
  //       params: action.params,
  //     });
  //   },
  // },
};

/**
 * Custom condition factories contributed by this connector.
 *
 * These are registered with the ConditionRegistry when the connector is enabled
 * and unregistered when it is disabled. They exist for retained legacy form-rule
 * compatibility; new Automation Projects express guards directly in Logic.
 *
 * Each key is the condition type string (e.g. "my_connector_value_check").
 * Prefix with your connector name to avoid collisions.
 *
 * A ConditionFactory receives the condition_value string from the rule config
 * and returns a predicate function: (ctx: EventContext) => boolean.
 */
export const conditions: Record<string, ConditionFactory> = {
  // ← Add condition factories for your connector, e.g.:
  // my_connector_value_check: (conditionValue: string) => {
  //   const threshold = Number(conditionValue);
  //   return (ctx) => Number(ctx.state.someField) > threshold;
  // },
};
