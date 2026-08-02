// src/connectors/kasa/kasa-connector.ts — TP-Link Kasa connector implementation

import pkg from "tplink-smarthome-api";
const { Client } = pkg;
import type {
  Connector,
  ConnectorHealthStatus,
  CapabilityDescriptor,
} from "../connector.interface.js";
import type { Device, Action } from "../../core/types.js";
import { kasaPowerState } from "./kasa-power-state.js";
import logger from "../../logger.js";

/**
 * Connector for TP-Link Kasa smart plugs, bulbs, and switches.
 *
 * Uses the `tplink-smarthome-api` package to discover and control
 * devices on the local network via UDP broadcast and TCP commands.
 */
export class KasaConnector implements Connector {
  private client: InstanceType<typeof Client> | null = null;
  private broadcastAddress: string;
  private discoveryTimeout: number;
  private discoveredDevices = new Map<string, unknown>();
  private lastSuccessTimestamp = 0;
  private healthStatus: ConnectorHealthStatus = {
    status: "disconnected",
    lastSeen: 0,
  };

  constructor(config: Record<string, unknown>) {
    this.broadcastAddress =
      (config.broadcastAddress as string) || "255.255.255.255";
    this.discoveryTimeout =
      (config.discoveryTimeout as number) || 10000;
  }

  async connect(): Promise<void> {
    logger.info("Initializing TP-Link Kasa client");
    this.client = new Client();
    this.lastSuccessTimestamp = Date.now();
    this.healthStatus = {
      status: "connected",
      lastSeen: this.lastSuccessTimestamp,
    };
    logger.info("Kasa client initialized");
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.stopDiscovery();
    }
    logger.info("Kasa connector disconnected");
  }

  async discoverDevices(): Promise<Device[]> {
    if (!this.client) {
      throw new Error("Kasa client not initialized — call connect() first");
    }

    const devices: Device[] = [];
    const client = this.client;

    const handleDevice = (device: unknown) => {
      try {
        const mapped = this.mapDevice(device);
        if (mapped) {
          // Avoid duplicates within the same scan
          if (!devices.some((d) => d.id === mapped.id)) {
            devices.push(mapped);
          }
          this.discoveredDevices.set(mapped.id, device);
        }
      } catch (err) {
        logger.warn(
          { error: (err as Error).message },
          "Failed to map discovered Kasa device",
        );
      }
    };

    // Register scan-local listeners and guarantee their removal when the scan
    // settles, so repeated polls never accumulate handlers (see H4).
    client.on("device-new", handleDevice);
    client.on("device-online", handleDevice);
    try {
      await new Promise<void>((resolve) => {
        client.startDiscovery({
          broadcast: this.broadcastAddress,
          discoveryTimeout: this.discoveryTimeout,
        });

        setTimeout(() => {
          client.stopDiscovery();
          resolve();
        }, this.discoveryTimeout);
      });
    } finally {
      client.off("device-new", handleDevice);
      client.off("device-online", handleDevice);
    }

    // Update health — the client is still functional even if no devices were found on this cycle.
    // Only mark disconnected if we've NEVER found any devices. If we previously found devices
    // but this poll came back empty, mark as degraded (transient UDP broadcast miss).
    if (devices.length > 0) {
      this.lastSuccessTimestamp = Date.now();
      this.healthStatus = {
        status: "connected",
        lastSeen: this.lastSuccessTimestamp,
      };
    } else if (this.discoveredDevices.size > 0) {
      // We've found devices before but this poll was empty — likely a transient issue
      this.healthStatus = {
        status: "degraded",
        lastSeen: this.lastSuccessTimestamp,
        errorMessage: "No devices found on last scan — previously discovered devices may still be reachable",
      };
    } else {
      // Never found any devices at all
      this.healthStatus = {
        status: "disconnected",
        lastSeen: this.lastSuccessTimestamp,
        errorMessage: "No Kasa devices found on the network",
      };
    }

    logger.info({ count: devices.length }, "Discovered Kasa devices");
    return devices;
  }

  /**
   * Map a tplink-smarthome-api device to an Aeolus Device object.
   */
  private mapDevice(rawDevice: unknown): Device | null {
    const device = rawDevice as Record<string, unknown>;
    const alias = (device.alias as string) || "";
    const host = (device.host as string) || "unknown";
    // Identity comes from the immutable native device id / MAC, not the
    // user-editable alias, so renaming a device does not change its Aeolus
    // identity and two devices/instances cannot collide on the same alias
    // (see H7). Fall back to host only when no native id is available.
    const nativeId =
      (device.deviceId as string) || (device.id as string) || (device.mac as string) || "";
    let deviceId: string;
    if (nativeId && nativeId.trim() !== "") {
      deviceId = `kasa-${nativeId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
    } else {
      logger.warn(
        { host },
        "Kasa device has no native deviceId/MAC — falling back to host-based id, which is not stable across IP changes",
      );
      deviceId = `kasa-${host}`;
    }

    const sysInfo = device.sysInfo as Record<string, unknown> | undefined;
    const isOn = kasaPowerState(sysInfo);

    // Determine device type based on constructor name / deviceType field
    const constructorName = device.constructor?.name || "";
    const deviceType = (device.deviceType as string) || "";

    if (constructorName === "Bulb" || deviceType === "bulb") {
      // Only on/off is advertised: the connector implements toggle/on/off and
      // does not (yet) implement brightness. Advertising "brightness" here would
      // surface a control that fails (see H3).
      return {
        id: deviceId,
        name: alias || host,
        type: "light",
        capabilities: ["on/off"],
        state: { on: isOn, online: true },
        integration: "kasa",
        lastSeen: Date.now(),
      };
    }

    // Default to plug (Plug class or unknown)
    const state: Record<string, unknown> = { on: isOn, online: true };

    // Try to read energy monitoring data if available
    const emeter = device.emeter as Record<string, unknown> | undefined;
    if (emeter?.realtime) {
      const realtime = emeter.realtime as Record<string, unknown>;
      state.voltage = realtime.voltage ?? 0;
      state.current = realtime.current ?? 0;
      state.power = realtime.power ?? 0;
      state.totalConsumption = realtime.total ?? realtime.total_wh ?? 0;
    }

    // Energy telemetry (voltage/current/power) is exposed as device state for
    // display, but "energy-monitoring" is not advertised as a capability: the
    // connector implements no `read-energy` action, so advertising it would
    // surface an action that fails (see H3). Only on/off is a real action.
    return {
      id: deviceId,
      name: alias || host,
      type: "plug",
      capabilities: ["on/off"],
      state,
      integration: "kasa",
      lastSeen: Date.now(),
    };
  }

  async execute(action: Action): Promise<void> {
    const device = this.discoveredDevices.get(action.deviceId) as
      | Record<string, unknown>
      | undefined;
    if (!device) {
      throw new Error(`Unknown Kasa device: ${action.deviceId}`);
    }

    const setPowerState = device.setPowerState as
      | ((state: boolean) => Promise<unknown>)
      | undefined;
    if (!setPowerState) {
      throw new Error(
        `Device ${action.deviceId} does not support power state control`,
      );
    }

    switch (action.type) {
      case "toggle": {
        const sysInfo = device.sysInfo as Record<string, unknown> | undefined;
        // Use the canonical helper so bulbs (light_state.on_off) toggle
        // correctly, not just plugs (relay_state) — see H2.
        const currentlyOn = kasaPowerState(sysInfo);
        await setPowerState.call(device, !currentlyOn);
        break;
      }
      case "on":
        await setPowerState.call(device, true);
        break;
      case "off":
        await setPowerState.call(device, false);
        break;
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }

    this.lastSuccessTimestamp = Date.now();
    this.healthStatus = {
      status: "connected",
      lastSeen: this.lastSuccessTimestamp,
    };

    logger.info(
      { deviceId: action.deviceId, action: action.type },
      "Kasa action executed",
    );
  }

  /**
   * Explicit action catalog. Kasa implements only the on/off family
   * (`toggle`, `on`, `off`) for every device, so the connector advertises
   * exactly those and nothing more (see H3). If brightness or energy reading is
   * implemented later, it must be added here and in `execute()` together.
   */
  getActionCatalog(deviceId: string): CapabilityDescriptor[] | undefined {
    if (!this.discoveredDevices.has(deviceId)) {
      return undefined;
    }
    return [
      {
        type: "toggle",
        label: "Toggle",
        description: "Toggle the device on or off",
        params: {},
      },
      {
        type: "on",
        label: "Turn On",
        description: "Turn the device on",
        params: {},
      },
      {
        type: "off",
        label: "Turn Off",
        description: "Turn the device off",
        params: {},
      },
    ];
  }

  getHealthStatus(): ConnectorHealthStatus {
    return { ...this.healthStatus };
  }

  onConfigUpdate(config: Record<string, unknown>): void {
    if (config.broadcastAddress !== undefined) {
      this.broadcastAddress = config.broadcastAddress as string;
    }
    if (config.discoveryTimeout !== undefined) {
      this.discoveryTimeout = config.discoveryTimeout as number;
    }
    logger.info("Kasa connector config updated");
  }

  async dispose(): Promise<void> {
    if (this.client) {
      this.client.stopDiscovery();
      this.client = null;
    }
    this.discoveredDevices.clear();
    this.lastSuccessTimestamp = 0;
    this.healthStatus = { status: "disconnected", lastSeen: 0 };
    logger.info("Kasa connector disposed");
  }
}
