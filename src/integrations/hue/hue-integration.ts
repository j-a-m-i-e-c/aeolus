// src/integrations/hue/hue-integration.ts — Philips Hue bridge integration

import type { Integration } from "../integration.interface.js";
import type { Device, Action } from "../../core/types.js";
import logger from "../../logger.js";

interface HueLight {
  state: { on: boolean; bri: number; reachable: boolean };
  type: string;
  name: string;
  modelid: string;
  uniqueid: string;
}

export interface HueConfig {
  bridgeIp: string;
  apiKey: string;
}

export class HueIntegration implements Integration {
  name = "hue";
  private config: HueConfig;
  private baseUrl: string;
  private deviceMap = new Map<string, string>(); // aeolus deviceId → hue light index

  constructor(config: HueConfig) {
    this.config = config;
    this.baseUrl = `http://${config.bridgeIp}/api/${config.apiKey}`;
  }

  async connect(): Promise<void> {
    logger.info({ bridgeIp: this.config.bridgeIp }, "Connecting to Hue bridge");
    // Verify bridge is reachable
    const res = await fetch(`${this.baseUrl}/lights`);
    if (!res.ok) {
      throw new Error(`Hue bridge returned ${res.status}`);
    }
    logger.info("Hue bridge connected");
  }

  async discoverDevices(): Promise<Device[]> {
    const res = await fetch(`${this.baseUrl}/lights`);
    if (!res.ok) {
      throw new Error(`Failed to discover Hue lights: ${res.status}`);
    }

    const lights = (await res.json()) as Record<string, HueLight>;
    const devices: Device[] = [];

    for (const [index, light] of Object.entries(lights)) {
      const deviceId = `hue-light-${index}`;
      this.deviceMap.set(deviceId, index);

      devices.push({
        id: deviceId,
        name: light.name,
        type: "light",
        capabilities: ["on/off", "brightness"],
        state: {
          on: light.state.on,
          brightness: light.state.bri,
          reachable: light.state.reachable,
        },
        integration: "hue",
        lastSeen: Date.now(),
      });
    }

    logger.info({ count: devices.length }, "Discovered Hue lights");
    return devices;
  }

  async execute(action: Action): Promise<void> {
    const lightIndex = this.deviceMap.get(action.deviceId);
    if (!lightIndex) {
      throw new Error(`Unknown Hue device: ${action.deviceId}`);
    }

    const url = `${this.baseUrl}/lights/${lightIndex}/state`;

    try {
      let body: Record<string, unknown>;

      switch (action.type) {
        case "toggle": {
          // Fetch current state to toggle
          const stateRes = await fetch(`${this.baseUrl}/lights/${lightIndex}`);
          const light = (await stateRes.json()) as HueLight;
          body = { on: !light.state.on };
          break;
        }
        case "brightness": {
          const bri = Number(action.params.brightness ?? 254);
          body = { bri: Math.min(254, Math.max(0, bri)) };
          break;
        }
        default:
          throw new Error(`Unsupported action type: ${action.type}`);
      }

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Hue API returned ${res.status}`);
      }

      logger.info({ deviceId: action.deviceId, action: action.type }, "Hue action executed");
    } catch (err) {
      logger.error(
        { deviceId: action.deviceId, error: (err as Error).message },
        "Hue action failed"
      );
      throw err;
    }
  }

  async dispose(): Promise<void> {
    this.deviceMap.clear();
    logger.info("Hue integration disposed");
  }
}