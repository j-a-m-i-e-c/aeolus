// src/connectors/kasa/kasa-connector.ts — TP-Link Kasa connector implementation

import { Client } from "tplink-smarthome-api";
import type {
  Connector,
  ConnectorHealthStatus,
} from "../connector.interface.js";
import type { Device, Action } from "../../core/types.js";
import logger from "../../logger.js";

/**
 * Connector for TP-Link Kasa smart plugs, bulbs, and switches.
 *
 * Uses the `tplink-smarthome-api` package to discover and control
 * devices on the local network via UDP broadcast and TCP commands.
 */
export class KasaConnector implements Connector {
  private client: Client | null = null;
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

    await new Promise<void>((resolve) => {
      client.startDiscovery({
        broadcast: this.broadcastAddress,
        discoveryTimeout: this.discoveryTimeout,
      });

      client.on("device-new", (device: unknown) => {
        try {
          const mapped = this.mapDevice(device);
          if (mapped) {
            devices.push(mapped);
            this.discoveredDevices.set(mapped.id, device);
          }
        } catch (err) {
          logger.warn(
            { error: (err as Error).message },
            "Failed to map discovered Kasa device",
          );
        }
      });

      setTimeout(() => {
        client.stopDiscovery();
        resolve();
      }, this.discoveryTimeout);
    });

    // Update health based on discovered devices
    if (devices.length > 0) {
      this.lastSuccessTimestamp = Date.now();
      this.healthStatus = {
        status: "connected",
        lastSeen: this.lastSuccessTimestamp,
      };
    } else {
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
    const deviceId = alias
      ? `kasa-${alias.toLowerCase().replace(/\s+/g, "-")}`
      : `kasa-${host}`;

    const sysInfo = device.sysInfo as Record<string, unknown> | undefined;
    const isOn = sysInfo?.relay_state === 1 || sysInfo?.light_state
      ? ((sysInfo.light_state as Record<string, unknown>)?.on_off === 1)
      : false;

    // Determine device type based on constructor name / deviceType field
    const constructorName = device.constructor?.name || "";
    const deviceType = (device.deviceType as string) || "";

    if (constructorName === "Bulb" || deviceType === "bulb") {
      return {
        id: deviceId,
        name: alias || host,
        type: "light",
        capabilities: ["on/off", "brightness"],
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

    return {
      id: deviceId,
      name: alias || host,
      type: "plug",
      capabilities: ["on/off", "energy-monitoring"],
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
        const currentlyOn = sysInfo?.relay_state === 1;
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
