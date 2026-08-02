// src/connectors/hue/hue-connector.ts — Philips Hue connector implementation

import type {
  Connector,
  ConnectorHealthStatus,
  SetupStepDescriptor,
  SetupStepResult,
  CapabilityDescriptor,
} from "../connector.interface.js";
import type { Device, Action } from "../../core/types.js";
import logger from "../../logger.js";
import {
  mapTypeToCapabilities,
  extractDeviceState,
  clampHue,
  clampSaturation,
  clampCt,
} from "./capability-mapper.js";
import type { RawHueLight, CapabilitySet } from "./capability-mapper.js";

interface ZigbeeSearchState {
  active: boolean;
  startedAt: number | null;
  newLights: Array<{ id: string; name: string }>;
  error: string | null;
}

/**
 * Build a stable, globally-unique Aeolus device id for a Hue light.
 *
 * Prefers the light's immutable `uniqueid` (Zigbee MAC + endpoint), sanitised
 * for use as an id. Falls back to the bridge-local index only when `uniqueid`
 * is absent (rare/old bridges), which is not globally unique — logged so it is
 * visible. See H7.
 */
export function hueDeviceId(uniqueId: string | undefined, index: string): string {
  if (uniqueId && uniqueId.trim() !== "") {
    const sanitised = uniqueId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (sanitised !== "") {
      return `hue-${sanitised}`;
    }
  }
  logger.warn(
    { index },
    "Hue light has no uniqueid — falling back to bridge-local index id, which is not unique across bridges",
  );
  return `hue-light-${index}`;
}

export class HueConnector implements Connector {
  private bridgeIp: string;
  private apiKey: string;
  private deviceMap = new Map<string, string>(); // aeolus deviceId → hue light index
  private capabilityMap = new Map<string, CapabilitySet>(); // deviceId → CapabilitySet
  private deviceStateMap = new Map<string, Record<string, unknown>>(); // deviceId → last known state
  private lastSuccessTimestamp = 0;
  private healthStatus: ConnectorHealthStatus = {
    status: "disconnected",
    lastSeen: 0,
  };
  private updatesAvailable = false;
  private updateType: "bridge" | "lights" | "both" | undefined = undefined;
  private searchState: ZigbeeSearchState = {
    active: false,
    startedAt: null,
    newLights: [],
    error: null,
  };
  private searchPollTimer: ReturnType<typeof setInterval> | null = null;

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

    // Fetch firmware update status from bridge config
    await this.fetchFirmwareStatus();

    logger.info("Hue bridge connected");
  }

  private async fetchFirmwareStatus(): Promise<void> {
    try {
      const configRes = await fetch(`${this.baseUrl}/config`);
      if (!configRes.ok) {
        // Non-critical — treat as no updates
        this.updatesAvailable = false;
        this.updateType = undefined;
        return;
      }

      const config = (await configRes.json()) as Record<string, unknown>;
      const swupdate2 = config.swupdate2 as
        | {
            state?: string;
            bridge?: { state?: string };
          }
        | undefined;

      if (!swupdate2) {
        this.updatesAvailable = false;
        this.updateType = undefined;
        return;
      }

      const overallState = swupdate2.state;
      const hasUpdates =
        overallState === "anyreadytoinstall" ||
        overallState === "allreadytoinstall";

      if (!hasUpdates) {
        this.updatesAvailable = false;
        this.updateType = undefined;
        return;
      }

      this.updatesAvailable = true;

      const bridgeReady =
        swupdate2.bridge?.state === "readytoinstall" ||
        swupdate2.bridge?.state === "anyreadytoinstall" ||
        swupdate2.bridge?.state === "allreadytoinstall";

      // If bridge is ready and overall is ready, we need to determine if it's bridge-only,
      // lights-only, or both. The overall state being ready means at least something is ready.
      // If bridge.state indicates readiness, bridge has updates.
      // If overall state is ready but bridge is not, it's device/light updates only.
      if (bridgeReady && overallState === "allreadytoinstall") {
        this.updateType = "both";
      } else if (bridgeReady) {
        this.updateType = "bridge";
      } else {
        this.updateType = "lights";
      }
    } catch {
      // Network error fetching config — non-critical
      this.updatesAvailable = false;
      this.updateType = undefined;
    }
  }

  async disconnect(): Promise<void> {
    // HTTP-based — no persistent connection to close
    if (this.searchPollTimer) {
      clearInterval(this.searchPollTimer);
      this.searchPollTimer = null;
    }
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

    const lights = (await res.json()) as Record<string, RawHueLight>;
    const devices: Device[] = [];

    for (const [index, light] of Object.entries(lights)) {
      // Derive a globally-unique, stable identity from the light's immutable
      // Zigbee uniqueid rather than the bridge-local index, so two bridges
      // cannot both expose `hue-light-1` (see H7). The index is bridge-local
      // and can change; uniqueid is the device's MAC + endpoint.
      const deviceId = hueDeviceId(light.uniqueid, index);
      this.deviceMap.set(deviceId, index);

      const capabilitySet = mapTypeToCapabilities(light.type);
      this.capabilityMap.set(deviceId, capabilitySet);

      const state = extractDeviceState(light, capabilitySet);
      this.deviceStateMap.set(deviceId, state);

      devices.push({
        id: deviceId,
        name: light.name,
        type: "light",
        capabilities: capabilitySet.capabilities as string[],
        state,
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

    const capabilitySet = this.capabilityMap.get(action.deviceId);
    const url = `${this.baseUrl}/lights/${lightIndex}/state`;

    let body: Record<string, unknown>;

    switch (action.type) {
      case "toggle": {
        // Toggle always works — on/off is always present
        const stateRes = await fetch(`${this.baseUrl}/lights/${lightIndex}`);
        const light = (await stateRes.json()) as RawHueLight;
        body = { on: !light.state.on };
        break;
      }
      case "on": {
        // Explicit on/off — advertised by the on/off capability and now
        // implemented so the catalog is truthful (see H5).
        body = { on: true };
        break;
      }
      case "off": {
        body = { on: false };
        break;
      }
      case "brightness": {
        if (capabilitySet && !capabilitySet.hasBrightness) {
          throw new Error(
            `Light '${action.deviceId}' does not support brightness (type: ${this.getLightType(action.deviceId)})`,
          );
        }
        // Canonical contract is brightness 0–100 (percentage). Translate to the
        // Hue-native 0–254 scale (pre-promotion-release-gates gate 4, Req 4.3).
        const pct = Number(action.params.brightness ?? 100);
        const bri = Math.round(Math.min(100, Math.max(0, pct)) / 100 * 254);
        body = { bri };
        break;
      }
      case "color": {
        if (!capabilitySet || !capabilitySet.hasColor) {
          throw new Error(
            `Light '${action.deviceId}' does not support color (type: ${this.getLightType(action.deviceId)})`,
          );
        }
        const hue = clampHue(Number(action.params.hue ?? 0));
        const sat = clampSaturation(Number(action.params.saturation ?? 0));
        body = { hue, sat };
        break;
      }
      case "color-temp": {
        if (!capabilitySet || !capabilitySet.hasColorTemp) {
          throw new Error(
            `Light '${action.deviceId}' does not support color temperature (type: ${this.getLightType(action.deviceId)})`,
          );
        }
        const deviceState = this.deviceStateMap.get(action.deviceId);
        const ctMin = (deviceState?.ctMin as number) ?? 153;
        const ctMax = (deviceState?.ctMax as number) ?? 500;
        const ct = clampCt(Number(action.params.ct ?? ctMin), ctMin, ctMax);
        body = { ct };
        break;
      }
      case "rename": {
        const newName = String(action.params.name ?? "").trim();
        if (!newName) {
          throw new Error("Rename requires a non-empty 'name' parameter");
        }
        const renameRes = await fetch(`${this.baseUrl}/lights/${lightIndex}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        if (!renameRes.ok) {
          throw new Error(`Hue API returned ${renameRes.status} on rename`);
        }
        this.lastSuccessTimestamp = Date.now();
        this.healthStatus = { status: "connected", lastSeen: this.lastSuccessTimestamp };
        logger.info({ deviceId: action.deviceId, newName }, "Hue light renamed");
        return; // Early return — rename doesn't use /state endpoint
      }
      case "delete": {
        const deleteRes = await fetch(`${this.baseUrl}/lights/${lightIndex}`, {
          method: "DELETE",
        });
        if (!deleteRes.ok) {
          throw new Error(`Hue API returned ${deleteRes.status} on delete`);
        }
        this.deviceMap.delete(action.deviceId);
        this.capabilityMap.delete(action.deviceId);
        this.deviceStateMap.delete(action.deviceId);
        this.lastSuccessTimestamp = Date.now();
        this.healthStatus = { status: "connected", lastSeen: this.lastSuccessTimestamp };
        logger.info({ deviceId: action.deviceId }, "Hue light deleted from bridge");
        return; // Early return — delete doesn't use /state endpoint
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

  private getLightType(deviceId: string): string {
    const state = this.deviceStateMap.get(deviceId);
    return (state?.lightType as string) ?? "unknown";
  }

  /**
   * Explicit per-device action catalog (see H5). Built from the device's
   * discovered `CapabilitySet` plus the bridge-management actions the connector
   * implements. This makes the connector the source of truth and avoids the
   * generic `CAPABILITY_ACTION_MAP` fallback, which is keyed `color-temp` while
   * Hue advertises the `color-temperature` capability (so `color-temp` was
   * being rejected before it reached `execute()`), and which has no
   * `rename`/`delete` entries.
   *
   * An action is advertised if and only if `execute()` implements it for the
   * device's capability set.
   */
  getActionCatalog(deviceId: string): CapabilityDescriptor[] | undefined {
    const capabilitySet = this.capabilityMap.get(deviceId);
    if (!capabilitySet) {
      return undefined;
    }

    const descriptors: CapabilityDescriptor[] = [
      { type: "toggle", label: "Toggle", description: "Toggle the light on or off", params: {} },
      { type: "on", label: "Turn On", description: "Turn the light on", params: {} },
      { type: "off", label: "Turn Off", description: "Turn the light off", params: {} },
    ];

    if (capabilitySet.hasBrightness) {
      descriptors.push({
        type: "brightness",
        label: "Set Brightness",
        description: "Set brightness level as a percentage (0–100)",
        params: {
          type: "object",
          required: ["brightness"],
          properties: {
            brightness: { type: "number", minimum: 0, maximum: 100 },
          },
        },
      });
    }

    if (capabilitySet.hasColor) {
      descriptors.push({
        type: "color",
        label: "Set Color",
        description: "Set hue and saturation",
        params: {
          type: "object",
          required: ["hue", "saturation"],
          properties: {
            hue: { type: "number", minimum: 0, maximum: 65535 },
            saturation: { type: "number", minimum: 0, maximum: 254 },
          },
        },
      });
    }

    if (capabilitySet.hasColorTemp) {
      descriptors.push({
        type: "color-temp",
        label: "Set Color Temperature",
        description: "Set color temperature in mireds",
        params: {
          type: "object",
          required: ["ct"],
          properties: {
            ct: { type: "number" },
          },
        },
      });
    }

    // Bridge-management actions the connector always implements.
    descriptors.push(
      {
        type: "rename",
        label: "Rename",
        description: "Rename the light on the bridge",
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
      },
      {
        type: "delete",
        label: "Delete",
        description: "Remove the light from the bridge",
        params: {},
      },
    );

    return descriptors;
  }

  getHealthStatus(): ConnectorHealthStatus & {
    updatesAvailable?: boolean;
    updateType?: "bridge" | "lights" | "both";
  } {
    return {
      ...this.healthStatus,
      ...(this.updatesAvailable
        ? { updatesAvailable: true, updateType: this.updateType }
        : {}),
    };
  }

  async searchForNewLights(): Promise<ZigbeeSearchState> {
    if (this.searchState.active) {
      return this.searchState;
    }

    // Start the Zigbee scan
    try {
      const res = await fetch(`${this.baseUrl}/lights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const error = `Could not start light search: HTTP ${res.status}`;
        this.searchState = {
          active: false,
          startedAt: null,
          newLights: [],
          error,
        };
        return this.searchState;
      }
    } catch (err) {
      const error = `Could not start light search: ${(err as Error).message}`;
      this.searchState = {
        active: false,
        startedAt: null,
        newLights: [],
        error,
      };
      return this.searchState;
    }

    this.searchState = {
      active: true,
      startedAt: Date.now(),
      newLights: [],
      error: null,
    };

    // Poll for new lights every 5 seconds, stop after ~40 seconds
    const maxDuration = 40_000;
    const pollInterval = 5_000;

    this.searchPollTimer = setInterval(async () => {
      const elapsed = Date.now() - (this.searchState.startedAt ?? Date.now());

      try {
        const pollRes = await fetch(`${this.baseUrl}/lights/new`);
        if (pollRes.ok) {
          const data = (await pollRes.json()) as Record<string, unknown>;
          const newLights: Array<{ id: string; name: string }> = [];

          for (const [id, value] of Object.entries(data)) {
            if (id === "lastscan") continue;
            if (typeof value === "object" && value !== null) {
              const light = value as { name?: string };
              newLights.push({ id, name: light.name ?? `Light ${id}` });
            }
          }

          this.searchState.newLights = newLights;

          // Check if scan is complete
          const lastScan = data.lastscan;
          if (lastScan === "active" && elapsed < maxDuration) {
            // Still scanning, continue polling
            return;
          }
        }
      } catch (err) {
        logger.warn(
          { error: (err as Error).message },
          "Error polling for new lights",
        );
        // Continue polling on error
        if (elapsed < maxDuration) {
          return;
        }
      }

      // Scan complete or timed out — stop polling and refresh devices
      if (this.searchPollTimer) {
        clearInterval(this.searchPollTimer);
        this.searchPollTimer = null;
      }

      try {
        await this.discoverDevices();
      } catch (err) {
        logger.warn(
          { error: (err as Error).message },
          "Error refreshing devices after search",
        );
      }

      this.searchState = {
        ...this.searchState,
        active: false,
      };
    }, pollInterval);

    return this.searchState;
  }

  getSearchStatus(): ZigbeeSearchState {
    return { ...this.searchState };
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
    if (this.searchPollTimer) {
      clearInterval(this.searchPollTimer);
      this.searchPollTimer = null;
    }
    this.deviceMap.clear();
    this.capabilityMap.clear();
    this.deviceStateMap.clear();
    this.lastSuccessTimestamp = 0;
    this.healthStatus = { status: "disconnected", lastSeen: 0 };
    this.updatesAvailable = false;
    this.updateType = undefined;
    this.searchState = { active: false, startedAt: null, newLights: [], error: null };
    logger.info("Hue connector disposed");
  }

  getSetupSteps(): SetupStepDescriptor[] {
    return [
      {
        id: "discover-bridges",
        title: "Discover Bridges",
        description:
          "Search the local network for Philips Hue bridges using the Meethue discovery service.\n\n" +
          "**Prerequisites:**\n" +
          "• A Philips Hue bridge powered on and connected to the same LAN\n" +
          "• New lights powered on and within Zigbee range of the bridge\n" +
          "• The bridge must be reachable from the device running Aeolus (same subnet or routable)\n\n" +
          "**What Aeolus handles:**\n" +
          "• Discovers the bridge automatically on the local network\n" +
          "• Pairs with the bridge via the link button (no Hue app needed)\n" +
          "• Searches for and pairs new unpaired lights via Zigbee scan (no Hue app needed)\n" +
          "• Controls all lights on the bridge (toggle, brightness, color, color temperature)\n" +
          "• Polls for state changes every 60 seconds\n\n" +
          "**What Aeolus does NOT handle:**\n" +
          "• Factory-resetting a light paired to a different bridge (requires the Hue app or a Zigbee touchlink reset device)\n" +
          "• Firmware updates to lights or the bridge (use the Hue app)\n" +
          "• Creating or editing Hue Entertainment zones (use the Hue app)",
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
