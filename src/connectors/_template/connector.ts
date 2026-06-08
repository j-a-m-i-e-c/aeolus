// src/connectors/_template/connector.ts — Template connector implementation
//
// This file contains a skeleton Connector class with TSDoc comments explaining
// each method. Copy this file alongside index.ts when creating a new connector.
//
// Lifecycle (called by ConnectorManager in this order):
//   1. constructor(config)  — store configuration
//   2. connect()            — establish connection to external system
//   3. discoverDevices()    — find devices, called periodically (polling)
//   4. execute(action)      — handle control actions routed to this connector
//   5. disconnect()         — gracefully close connection
//   6. dispose()            — release all resources
//
// Optional (when metadata.requiresSetup = true):
//   - getSetupSteps()                  — return wizard step descriptors
//   - executeSetupStep(stepId, params) — run a single setup step

import type {
  Connector,
  ConnectorHealthStatus,
} from "../connector.interface.js";
import type { Device, Action } from "../../core/types.js";

/**
 * Template connector implementation.
 *
 * Rename this class to match your connector (e.g. `ZigbeeConnector`).
 * Each method includes inline documentation explaining when it is called,
 * what it should do, and what the ConnectorManager expects in return.
 */
export class TemplateConnector implements Connector {
  /** Store your connection client, SDK instance, or socket here. */
  private client: unknown = null;

  /** Track discovered devices for action routing. */
  private devices = new Map<string, unknown>();

  /** Timestamp of last successful communication with the external system. */
  private lastSeen = 0;

  /** Current health state — updated by connect/discover/execute methods. */
  private health: ConnectorHealthStatus = {
    status: "disconnected",
    lastSeen: 0,
  };

  /**
   * Constructor — called by the `createConnector(config)` factory in index.ts.
   *
   * Extract and store configuration values here. The `config` object keys
   * match the `id` fields in your `configSchema`. Do NOT start connections
   * here — that happens in `connect()`.
   *
   * @param config - Configuration object with keys from configSchema.
   */
  constructor(private config: Record<string, unknown>) {
    // ← Extract your config values here, e.g.:
    // this.host = (config.host as string) || "localhost";
    // this.apiKey = (config.apiKey as string) || "";
  }

  /**
   * Establish a connection to the external device system.
   *
   * Called once when the connector is enabled or restored from the store.
   * This is where you should:
   *   - Initialize SDK clients or open sockets
   *   - Authenticate with the external system
   *   - Verify the system is reachable
   *
   * If this method throws, the ConnectorManager sets health to "disconnected"
   * and the user can retry via the dashboard.
   */
  async connect(): Promise<void> {
    // TODO: Initialize your client and verify connectivity
    // Example:
    //   this.client = new MySDK({ host: this.host });
    //   await this.client.ping();

    this.lastSeen = Date.now();
    this.health = { status: "connected", lastSeen: this.lastSeen };
  }

  /**
   * Gracefully disconnect from the external system.
   *
   * Called when the connector is disabled or the system is shutting down.
   * Close network connections and stop internal timers here. Resource
   * cleanup happens in `dispose()`.
   */
  async disconnect(): Promise<void> {
    // TODO: Close connections, stop listeners
    // Example:
    //   await this.client?.close();
  }

  /**
   * Discover devices and return them in Aeolus Device format.
   *
   * Called immediately after `connect()` and then periodically by the
   * ConnectorManager's polling loop (default: every 60 seconds).
   *
   * Each returned device MUST include:
   *   - `id`          — unique, stable identifier (prefix with your connector name)
   *   - `name`        — human-readable display name
   *   - `type`        — one of: "light", "sensor", "switch", "climate", "plug"
   *   - `capabilities`— array of capability strings (e.g. ["on/off", "brightness"])
   *   - `state`       — current device state as key-value pairs
   *   - `integration` — MUST match your metadata.id (e.g. "my-connector")
   *   - `lastSeen`    — Unix timestamp in milliseconds
   *
   * @returns Array of discovered devices in Aeolus format.
   */
  async discoverDevices(): Promise<Device[]> {
    // TODO: Query your external system for devices and map them
    // Example:
    //   const rawDevices = await this.client.listDevices();
    //   return rawDevices.map(d => ({
    //     id: `my-connector-${d.id}`,
    //     name: d.name,
    //     type: "light",
    //     capabilities: ["on/off"],
    //     state: { on: d.isOn },
    //     integration: "my-connector",  // ← must match metadata.id
    //     lastSeen: Date.now(),
    //   }));

    return [];
  }

  /**
   * Execute a control action on a device managed by this connector.
   *
   * The ConnectorManager routes actions here when a device's `integration`
   * field matches this connector's `metadata.id`. Common action types:
   *   - "toggle" — flip the current on/off state
   *   - "on" / "off" — set explicit power state
   *   - "brightness" — set brightness level (params.brightness)
   *
   * @param action - Contains deviceId, action type, and params.
   * @throws If the device is unknown or the action fails.
   */
  async execute(_action: Action): Promise<void> {
    // TODO: Route the action to the correct device
    // Example:
    //   const device = this.devices.get(action.deviceId);
    //   if (!device) throw new Error(`Unknown device: ${action.deviceId}`);
    //   switch (action.type) {
    //     case "toggle": await device.toggle(); break;
    //     case "on":     await device.setPower(true); break;
    //     case "off":    await device.setPower(false); break;
    //   }

    this.lastSeen = Date.now();
    this.health = { status: "connected", lastSeen: this.lastSeen };
  }

  /**
   * Return the current health status of this connector.
   *
   * Called by the ConnectorManager when the REST API requests status.
   * Return a copy to prevent external mutation.
   *
   * Health rules:
   *   - "connected"    — all communication is healthy
   *   - "degraded"     — some devices unreachable but at least one responds
   *   - "disconnected" — no communication with external system
   */
  getHealthStatus(): ConnectorHealthStatus {
    return { ...this.health };
  }

  /**
   * Handle runtime configuration updates.
   *
   * Called when the user updates config via `PATCH /api/connectors/:id`.
   * Apply changes without a full disconnect/reconnect where possible.
   * If reconnection is required, throw and the manager handles it.
   *
   * @param config - The updated configuration object.
   */
  onConfigUpdate(config: Record<string, unknown>): void {
    this.config = config;
    // TODO: Apply config changes to your client
    // Example:
    //   if (config.host !== undefined) this.host = config.host as string;
  }

  /**
   * Release all resources held by this connector.
   *
   * Called after `disconnect()` when the connector is permanently disabled
   * or the system is shutting down. Clean up timers, event listeners,
   * caches, and any allocated memory.
   */
  async dispose(): Promise<void> {
    this.client = null;
    this.devices.clear();
    this.lastSeen = 0;
    this.health = { status: "disconnected", lastSeen: 0 };
  }

  // ─── Optional: Setup Flow ──────────────────────────────────────────
  // Uncomment the methods below if your connector requires a multi-step
  // setup wizard (e.g. device pairing, OAuth flow). Set requiresSetup: true
  // in your metadata to enable the dashboard wizard.

  /*
  getSetupSteps(): SetupStepDescriptor[] {
    return [
      {
        id: "step-1",
        title: "Step 1 Title",
        description: "Instructions for the user.",
        // Optional: fields the user must fill in for this step
        // fields: [{ id: "someField", label: "Some Field", type: "text", required: true }],
      },
      {
        id: "step-2",
        title: "Step 2 Title",
        description: "More instructions.",
      },
    ];
  }

  async executeSetupStep(
    stepId: string,
    params: Record<string, unknown>,
  ): Promise<SetupStepResult> {
    switch (stepId) {
      case "step-1":
        // TODO: Perform step 1 logic (e.g. discover devices on network)
        return { success: true, message: "Step 1 complete", data: {} };

      case "step-2":
        // TODO: Perform step 2 logic (e.g. pair with device)
        // Set complete: true on the final step to close the wizard
        return { success: true, message: "Setup complete", data: {}, complete: true };

      default:
        return { success: false, message: `Unknown step: ${stepId}` };
    }
  }
  */
}
