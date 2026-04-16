// src/connectors/hue/hue-connector.ts — Philips Hue connector implementation

import type {
  Connector,
  ConnectorHealthStatus,
  SetupStepDescriptor,
  SetupStepResult,
} from "../connector.interface.js";
import type { Device, Action } from "../../core/types.js";
import logger from "../../logger.js";

interface HueLight {
  state: { on: boolean; bri: number; reachable: boolean };
  type: string;
  name: string;
  modelid: string;
  uniqueid: string;
}

export class HueConnector implements Connector {
  private bridgeIp: string;
  private apiKey: string;
  private deviceMap = new Map<string, string>(); // aeolus deviceId → hue light index
  private lastSuccessTimestamp = 0;
  private healthStatus: ConnectorHealthStatus = {
    status: "disconnected",
    lastSeen: 0,
  };

  constructor(config: Record<string, unknown>) {
    this.bridgeIp = (config.bridgeIp as string) || "";
    this.apiKey = (config.apiKey as string) || "";
  }

  private get baseUrl(): string {
    return `http://${this.bridgeIp}/api/${this.apiKey}`;
  }

  async connect(): Promise<void> {
    logger.info({ bridgeIp: this.bridgeIp }, "Connecting to Hue bridge");
    const res = await fetch(`${this.baseUrl}/lights`);
    if (!res.ok) {
      const msg = `Hue bridge returned ${res.status}`;
      this.healthStatus = {
        status: "disconnected",
        lastSeen: this.lastSuccessTimestamp,
        errorMessage: msg,
      };
      throw new Error(msg);
    }
    this.lastSuccessTimestamp = Date.now();
    this.healthStatus = {
      status: "connected",
      lastSeen: this.lastSuccessTimestamp,
    };
    logger.info("Hue bridge connected");
  }

  async disconnect(): Promise<void> {
    // HTTP-based — no persistent connection to close
    logger.info("Hue connector disconnected");
  }

  async discoverDevices(): Promise<Device[]> {
    const res = await fetch(`${this.baseUrl}/lights`);
    if (!res.ok) {
      const msg = `Failed to discover Hue lights: ${res.status}`;
      this.healthStatus = {
        status: "disconnected",
        lastSeen: this.lastSuccessTimestamp,
        errorMessage: msg,
      };
      throw new Error(msg);
    }

    this.lastSuccessTimestamp = Date.now();
    this.healthStatus = {
      status: "connected",
      lastSeen: this.lastSuccessTimestamp,
    };

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

    let body: Record<string, unknown>;

    switch (action.type) {
      case "toggle": {
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

    this.lastSuccessTimestamp = Date.now();
    this.healthStatus = {
      status: "connected",
      lastSeen: this.lastSuccessTimestamp,
    };

    logger.info(
      { deviceId: action.deviceId, action: action.type },
      "Hue action executed",
    );
  }

  getHealthStatus(): ConnectorHealthStatus {
    return { ...this.healthStatus };
  }

  onConfigUpdate(config: Record<string, unknown>): void {
    if (config.bridgeIp !== undefined) {
      this.bridgeIp = config.bridgeIp as string;
    }
    if (config.apiKey !== undefined) {
      this.apiKey = config.apiKey as string;
    }
    logger.info("Hue connector config updated");
  }

  async dispose(): Promise<void> {
    this.deviceMap.clear();
    this.lastSuccessTimestamp = 0;
    this.healthStatus = { status: "disconnected", lastSeen: 0 };
    logger.info("Hue connector disposed");
  }

  getSetupSteps(): SetupStepDescriptor[] {
    return [
      {
        id: "discover-bridges",
        title: "Discover Bridges",
        description:
          "Search the local network for Philips Hue bridges using the Meethue discovery service.",
      },
      {
        id: "press-button",
        title: "Pair Bridge",
        description:
          "Press the large round link button on top of your Hue bridge, then click Continue within 30 seconds. The bridge only accepts pairing requests for 30 seconds after the button is pressed.",
        fields: [
          {
            id: "bridgeIp",
            label: "Bridge IP",
            type: "text",
            required: true,
            placeholder: "192.168.1.100",
            helpText: "Auto-filled from discovery. Change only if you have multiple bridges.",
          },
        ],
      },
    ];
  }

  async executeSetupStep(
    stepId: string,
    params: Record<string, unknown>,
  ): Promise<SetupStepResult> {
    switch (stepId) {
      case "discover-bridges":
        return this.discoverBridges();
      case "press-button":
        return this.pairBridge(params);
      default:
        return {
          success: false,
          message: `Unknown setup step: ${stepId}`,
        };
    }
  }

  private async discoverBridges(): Promise<SetupStepResult> {
    try {
      const res = await fetch("https://discovery.meethue.com/");
      if (!res.ok) {
        return {
          success: false,
          message: `Bridge discovery failed: HTTP ${res.status}`,
        };
      }
      const bridges = (await res.json()) as Array<{ id: string; internalipaddress: string }>;
      logger.info(
        { count: bridges.length },
        "Hue bridges discovered",
      );

      if (bridges.length === 0) {
        return {
          success: false,
          message: "No Hue bridges found on your network. Make sure the bridge is powered on and connected.",
        };
      }

      // Auto-select the first bridge IP so step 2 is pre-filled
      const firstBridgeIp = bridges[0].internalipaddress;

      return {
        success: true,
        message: bridges.length === 1
          ? `Found your bridge at ${firstBridgeIp}. Press the link button on the bridge, then click Continue.`
          : `Found ${bridges.length} bridges. Using ${firstBridgeIp} — change the IP in the next step if needed.`,
        data: { bridges, bridgeIp: firstBridgeIp },
      };
    } catch (err) {
      return {
        success: false,
        message: `Bridge discovery failed: ${(err as Error).message}`,
      };
    }
  }

  private async pairBridge(
    params: Record<string, unknown>,
  ): Promise<SetupStepResult> {
    const bridgeIp = params.bridgeIp as string;
    if (!bridgeIp) {
      return { success: false, message: "bridgeIp is required" };
    }

    try {
      const res = await fetch(`http://${bridgeIp}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devicetype: "aeolus#dashboard" }),
      });

      const result = (await res.json()) as Record<string, unknown>[];

      if (Array.isArray(result) && result[0]) {
        const first = result[0] as Record<string, unknown>;

        if (first.success) {
          const success = first.success as { username: string };
          logger.info({ bridgeIp }, "Hue bridge paired successfully");
          return {
            success: true,
            message: "Bridge paired successfully",
            data: { apiKey: success.username, bridgeIp },
            complete: true,
          };
        }

        if (first.error) {
          const error = first.error as { type: number; description: string };
          // Type 101 = link button not pressed
          if (error.type === 101) {
            return {
              success: false,
              message: "Link button not pressed — press the button on the bridge and click Continue again within 30 seconds",
            };
          }
          return { success: false, message: error.description };
        }
      }

      return { success: false, message: "Unexpected response from bridge" };
    } catch (err) {
      return {
        success: false,
        message: `Pairing failed: ${(err as Error).message}`,
      };
    }
  }
}
