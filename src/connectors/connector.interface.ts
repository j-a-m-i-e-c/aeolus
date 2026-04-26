// src/connectors/connector.interface.ts — Core TypeScript interfaces for the Connector Framework

import type { DeviceType, Device, Action } from "../core/types.js";

/**
 * Static metadata descriptor for a Connector module.
 *
 * Every connector exports this as `metadata` from its `index.ts`.
 * The registry uses it to identify, categorise, and display connectors
 * in the dashboard without instantiating them.
 */
export interface ConnectorMetadata {
  /**
   * Unique identifier for this connector type.
   * Used as the `connector_type` column in the SQLite `connectors` table
   * and as the `integration` field on devices produced by this connector.
   * @example "hue", "kasa"
   */
  id: string;

  /**
   * Human-readable name shown in the dashboard connector cards.
   * @example "Philips Hue", "TP-Link Kasa"
   */
  displayName: string;

  /**
   * Lucide icon name rendered on the dashboard card.
   * Must correspond to a valid icon in the lucide-react package.
   * @example "lightbulb", "plug"
   */
  icon: string;

  /**
   * Short description of what this connector does.
   * Displayed beneath the display name on the connector card.
   * @example "Philips Hue smart lighting via local bridge API"
   */
  description: string;

  /**
   * Device types this connector can produce.
   * Used by the dashboard to show which device categories a connector supports.
   * @example ["light"] or ["plug", "light", "switch"]
   */
  supportedDeviceTypes: DeviceType[];

  /**
   * Whether this connector requires a multi-step setup flow before it can connect.
   * When `true`, the connector must implement `getSetupSteps()` and `executeSetupStep()`.
   * The dashboard renders a guided wizard for connectors that require setup.
   * @example true for Hue (button-press pairing), false for Kasa (auto-discovery)
   */
  requiresSetup: boolean;
}

/**
 * A single field descriptor in a connector's configuration schema.
 *
 * The dashboard uses these descriptors to render a dynamic configuration
 * form when a user enables a connector. Each field maps to a key in the
 * connector's runtime config object.
 */
export interface ConfigFieldDescriptor {
  /**
   * Unique field identifier, used as the key in the config object
   * passed to `createConnector(config)` and stored in the database.
   * @example "bridgeIp", "broadcastAddress"
   */
  id: string;

  /**
   * Human-readable label rendered next to the form input.
   * @example "Bridge IP", "Discovery Timeout (ms)"
   */
  label: string;

  /**
   * Input type that determines how the field is rendered in the dashboard.
   * - `"text"` — standard text input
   * - `"number"` — numeric input with optional min/max
   * - `"password"` — masked input, value is redacted in API responses
   * - `"boolean"` — toggle switch
   * - `"select"` — dropdown, requires the `options` array
   */
  type: "text" | "number" | "password" | "boolean" | "select";

  /**
   * Whether this field must be provided before the connector can be enabled.
   * The REST API returns 400 if a required field is missing from the config.
   */
  required: boolean;

  /**
   * Default value applied when the user does not provide one.
   * The type should match the field's `type` (string for text/password/select,
   * number for number, boolean for boolean).
   */
  default?: string | number | boolean;

  /**
   * Placeholder text shown inside the input when it is empty.
   * @example "192.168.1.100", "10000"
   */
  placeholder?: string;

  /**
   * Help text displayed below the input field to guide the user.
   * @example "UDP broadcast address for device discovery"
   */
  helpText?: string;

  /**
   * Options for `"select"` type fields.
   * Each option has a human-readable label and a machine-readable value.
   * Ignored for non-select field types.
   */
  options?: Array<{ label: string; value: string }>;
}

/**
 * The configuration schema for a connector module.
 *
 * An ordered array of {@link ConfigFieldDescriptor} entries that describes
 * every configuration field the connector accepts. Exported as `configSchema`
 * from each connector's `index.ts`. The REST API uses this schema to validate
 * incoming config objects, and the dashboard uses it to render dynamic forms.
 */
export type ConnectorConfigSchema = ConfigFieldDescriptor[];

/**
 * Health status reported by a connector instance.
 *
 * Every enabled connector exposes its health through `getHealthStatus()`.
 * The ConnectorManager polls this and surfaces it via the REST API and
 * dashboard health indicators (green / amber / red).
 */
export interface ConnectorHealthStatus {
  /**
   * Current connection state.
   * - `"connected"` — all communication with the external system is healthy
   * - `"degraded"` — some devices are unreachable but at least one responds
   * - `"disconnected"` — no communication with the external system
   */
  status: "connected" | "degraded" | "disconnected";

  /**
   * Unix timestamp in milliseconds of the last successful communication
   * with the external device system. Updated on every successful poll,
   * discovery, or action execution.
   */
  lastSeen: number;

  /**
   * Human-readable error message explaining why the connector is not
   * fully connected. Present when `status` is `"degraded"` or `"disconnected"`.
   * @example "Bridge unreachable at 192.168.1.100"
   */
  errorMessage?: string;
}

/**
 * Descriptor for a single step in a connector's setup flow.
 *
 * Connectors that require multi-step pairing (e.g. Hue button-press)
 * return an array of these from `getSetupSteps()`. The dashboard renders
 * them as a guided wizard, and each step is executed via
 * `POST /api/connectors/:id/setup/:stepId`.
 */
export interface SetupStepDescriptor {
  /**
   * Unique step identifier used in the API path.
   * @example "discover-bridges", "press-button"
   */
  id: string;

  /**
   * Human-readable title displayed as the step heading.
   * @example "Discover Bridges", "Press Link Button"
   */
  title: string;

  /**
   * Instructions shown to the user explaining what this step does
   * and what action (if any) they need to take.
   * @example "Press the link button on your Hue bridge, then click Continue."
   */
  description: string;

  /**
   * Input fields required for this step, if any.
   * For example, a step might ask the user to select a discovered bridge
   * from a list. Uses the same {@link ConfigFieldDescriptor} shape as
   * the main config schema.
   */
  fields?: ConfigFieldDescriptor[];
}

/**
 * Result returned after executing a setup step.
 *
 * The REST API forwards this to the dashboard, which uses it to advance
 * the wizard, display messages, or store intermediate data (e.g. a
 * generated API key).
 */
export interface SetupStepResult {
  /** Whether the step completed successfully. */
  success: boolean;

  /**
   * Message to display to the user.
   * On success this is typically a confirmation; on failure it explains
   * what went wrong and what the user should try.
   * @example "Bridge paired successfully", "Press the link button and try again"
   */
  message: string;

  /**
   * Data produced by this step that may be needed by subsequent steps
   * or stored as part of the connector's configuration.
   * @example { bridges: [{ id: "001788fffe123456", ip: "192.168.1.100" }] }
   * @example { apiKey: "aBcDeFgHiJkLmNoPqRsTuVwXyZ" }
   */
  data?: Record<string, unknown>;

  /**
   * When `true`, the setup flow is complete and the connector is ready
   * to be connected. The dashboard should close the wizard and proceed
   * to enable the connector with the accumulated configuration.
   */
  complete?: boolean;
}

/**
 * The core Connector interface that all connector implementations must satisfy.
 *
 * Instances are created by the module's `createConnector(config)` factory
 * function and managed by the {@link ConnectorManager}. The manager calls
 * lifecycle methods in this order:
 *
 * 1. `connect()` — establish communication with the external system
 * 2. `discoverDevices()` — find devices and return them in Aeolus format
 * 3. `execute(action)` — handle control actions routed by the manager
 * 4. `disconnect()` — gracefully close the connection
 * 5. `dispose()` — release all resources
 *
 * Steps 2–3 repeat on a polling interval while the connector is enabled.
 */
export interface Connector {
  /**
   * Connect to the external device system.
   *
   * Called once when the connector is enabled or restored from the store.
   * Should establish any persistent connections, authenticate, and verify
   * that the external system is reachable. Throws on failure — the
   * ConnectorManager catches the error and sets health to "disconnected".
   */
  connect(): Promise<void>;

  /**
   * Gracefully disconnect from the external system.
   *
   * Called when the connector is disabled or the system is shutting down.
   * Should close network connections and stop any internal timers, but
   * does not need to release all resources — that is handled by `dispose()`.
   */
  disconnect(): Promise<void>;

  /**
   * Discover devices and return them in Aeolus {@link Device} format.
   *
   * Called immediately after `connect()` and then periodically by the
   * ConnectorManager's polling loop. The returned devices are upserted
   * into the DeviceRegistry with their `integration` field set to this
   * connector's `metadata.id`.
   *
   * @returns An array of discovered devices in normalised Aeolus format.
   */
  discoverDevices(): Promise<Device[]>;

  /**
   * Execute a control action on a device managed by this connector.
   *
   * The ConnectorManager routes actions here based on the device's
   * `integration` field matching this connector's `metadata.id`.
   *
   * @param action - The action to execute, containing the target device ID,
   *   action type, and parameters.
   * @throws If the action cannot be executed (e.g. device unreachable).
   */
  execute(action: Action): Promise<void>;

  /**
   * Return the current health status of this connector.
   *
   * Called by the ConnectorManager when the REST API requests status
   * information. Should reflect the real-time state of communication
   * with the external system.
   *
   * @returns A {@link ConnectorHealthStatus} object with the current state.
   */
  getHealthStatus(): ConnectorHealthStatus;

  /**
   * Called when configuration is updated at runtime via
   * `PATCH /api/connectors/:id`.
   *
   * The connector should apply the new configuration without requiring
   * a full disconnect/reconnect cycle where possible. For changes that
   * require reconnection, the connector may throw and the manager will
   * handle the reconnect flow.
   *
   * @param config - The updated configuration object.
   */
  onConfigUpdate(config: Record<string, unknown>): void;

  /**
   * Release all resources held by this connector.
   *
   * Called after `disconnect()` when the connector is being permanently
   * disabled or the system is shutting down. Should clean up any
   * remaining timers, event listeners, or allocated memory.
   */
  dispose(): Promise<void>;

  /**
   * Return the setup flow steps for this connector.
   *
   * Only required when `metadata.requiresSetup` is `true`. The dashboard
   * renders these steps as a guided wizard before the connector can be
   * connected.
   *
   * @returns An array of {@link SetupStepDescriptor} objects defining the flow.
   */
  getSetupSteps?(): SetupStepDescriptor[];

  /**
   * Execute a single setup step.
   *
   * Only required when `metadata.requiresSetup` is `true`. Called by the
   * REST API when the user advances through the setup wizard.
   *
   * @param stepId - The unique identifier of the step to execute.
   * @param params - User-provided parameters for this step (from the wizard form).
   * @returns A {@link SetupStepResult} indicating success/failure and any produced data.
   */
  executeSetupStep?(
    stepId: string,
    params: Record<string, unknown>,
  ): Promise<SetupStepResult>;
}

/**
 * A code snippet that can be inserted into the automation script editor.
 *
 * Connectors export an array of these as `snippets` from their `index.ts`.
 * The snippet catalog aggregates connector snippets with platform-level
 * snippets and serves them via `GET /api/automations/snippets`.
 */
export interface SnippetDescriptor {
  /** Unique snippet identifier (scoped to the connector, e.g. "toggle-light"). */
  id: string;
  /** Short display name shown in the snippet picker (e.g. "Toggle Light"). */
  name: string;
  /** One-line description of what this snippet does. */
  description: string;
  /** The TypeScript code to insert at the cursor position. */
  code: string;
}

/**
 * The standard export shape for a connector module.
 *
 * Every `src/connectors/{name}/index.ts` must export these three members.
 * The {@link ConnectorRegistry} validates this shape at discovery time —
 * modules missing any of the three exports are skipped with a warning.
 *
 * Optionally, a module may export `snippets` — an array of code snippet
 * templates for the automation script editor. These appear grouped under
 * the connector's display name in the snippet picker.
 *
 * @example
 * ```typescript
 * // src/connectors/my-connector/index.ts
 * export const metadata: ConnectorMetadata = { ... };
 * export const configSchema: ConnectorConfigSchema = [ ... ];
 * export function createConnector(config: Record<string, unknown>): Connector {
 *   return new MyConnector(config);
 * }
 * export const snippets: SnippetDescriptor[] = [
 *   { id: "toggle", name: "Toggle Device", description: "Toggle a device on/off", code: "..." },
 * ];
 * ```
 */
export interface ConnectorModule {
  /** Static metadata describing this connector type. */
  metadata: ConnectorMetadata;

  /** Configuration schema used for form rendering and validation. */
  configSchema: ConnectorConfigSchema;

  /**
   * Factory function that creates a new connector instance.
   *
   * Called by the ConnectorManager when a connector is enabled.
   * The config object contains values matching the `configSchema` fields,
   * with defaults applied for optional fields the user did not provide.
   *
   * @param config - Configuration object with keys matching `configSchema` field ids.
   * @returns A new {@link Connector} instance ready to be connected.
   */
  createConnector: (config: Record<string, unknown>) => Connector;

  /**
   * Optional code snippets for the automation script editor.
   *
   * When provided, these snippets appear grouped under the connector's
   * display name in the snippet picker. Each snippet is a TypeScript
   * code template that can be inserted at the cursor position.
   */
  snippets?: SnippetDescriptor[];
}

/**
 * Runtime information about an enabled connector instance.
 *
 * Returned by `ConnectorManager.listEnabled()` and surfaced through
 * `GET /api/connectors`. Combines metadata, live health data, and
 * device counts into a single API-friendly shape.
 */
export interface ConnectorInstanceInfo {
  /**
   * Unique instance identifier (UUID).
   * Generated when the connector is first enabled and used as the
   * primary key in the `connectors` SQLite table.
   */
  id: string;

  /**
   * The connector type identifier, matching {@link ConnectorMetadata.id}.
   * @example "hue", "kasa"
   */
  connectorType: string;

  /**
   * Human-readable display name from the connector's metadata.
   * @example "Philips Hue", "TP-Link Kasa"
   */
  displayName: string;

  /**
   * Lucide icon name from the connector's metadata.
   * @example "lightbulb", "plug"
   */
  icon: string;

  /**
   * Current configuration for this instance.
   * Password fields are redacted (replaced with `"********"`) in API responses
   * to prevent credential leakage.
   */
  config: Record<string, unknown>;

  /**
   * Current health status of this connector instance.
   * Updated on every poll cycle and after connect/disconnect events.
   */
  health: ConnectorHealthStatus;

  /**
   * Number of devices currently discovered and registered by this connector.
   * Updated after each `discoverDevices()` poll cycle.
   */
  deviceCount: number;

  /**
   * Whether this connector instance is currently enabled.
   * Disabled connectors retain their config in the store but are not
   * connected or polling.
   */
  enabled: boolean;
}

/**
 * Persisted record for a connector instance in the SQLite `connectors` table.
 *
 * Used by the {@link ConnectorStore} to save and restore connector state
 * across restarts. The `config` field is stored as a JSON string in the
 * database and deserialised on load.
 */
export interface ConnectorRecord {
  /**
   * Unique instance identifier (UUID).
   * Serves as the PRIMARY KEY in the `connectors` table.
   */
  id: string;

  /**
   * The connector type identifier, matching {@link ConnectorMetadata.id}.
   * Used to look up the correct {@link ConnectorModule} in the registry
   * when restoring from the store.
   * @example "hue", "kasa"
   */
  connectorType: string;

  /**
   * Whether this connector instance is enabled.
   * `true` means the ConnectorManager should instantiate and connect it
   * on startup. `false` means the config is preserved but the connector
   * is not active.
   */
  enabled: boolean;

  /**
   * Configuration object with keys matching the connector's
   * {@link ConnectorConfigSchema} field ids.
   * Stored as a JSON string in the database.
   */
  config: Record<string, unknown>;

  /**
   * Unix timestamp in milliseconds when this record was first created.
   */
  createdAt: number;

  /**
   * Unix timestamp in milliseconds when this record was last updated.
   * Updated on config changes and enable/disable transitions.
   */
  updatedAt: number;
}
