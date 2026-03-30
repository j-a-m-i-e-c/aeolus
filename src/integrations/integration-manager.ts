// src/integrations/integration-manager.ts — Manages integration lifecycle

import type { Integration } from "./integration.interface.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Action, Device } from "../core/types.js";
import logger from "../logger.js";

export class IntegrationManager {
  private integrations = new Map<string, Integration>();
  private deviceIntegrationMap = new Map<string, string>(); // deviceId → integration name
  private registry: DeviceRegistry;

  constructor(registry: DeviceRegistry) {
    this.registry = registry;
  }

  /** Register an integration */
  register(integration: Integration): void {
    this.integrations.set(integration.name, integration);
    logger.info({ integration: integration.name }, "Integration registered");
  }

  /** Connect all registered integrations */
  async connectAll(): Promise<void> {
    for (const [name, integration] of this.integrations) {
      try {
        await integration.connect();
        logger.info({ integration: name }, "Integration connected");
      } catch (err) {
        logger.error({ integration: name, error: (err as Error).message }, "Integration connect failed, skipping");
      }
    }
  }

  /** Discover devices from all connected integrations */
  async discoverAll(): Promise<Device[]> {
    const allDevices: Device[] = [];
    for (const [name, integration] of this.integrations) {
      try {
        const devices = await integration.discoverDevices();
        for (const device of devices) {
          this.deviceIntegrationMap.set(device.id, name);
          this.registry.registerDevice(device);
          allDevices.push(device);
        }
        logger.info({ integration: name, deviceCount: devices.length }, "Devices discovered");
      } catch (err) {
        logger.error({ integration: name, error: (err as Error).message }, "Device discovery failed");
      }
    }
    return allDevices;
  }

  /** Execute an action on a device via its integration */
  async execute(deviceId: string, action: Action): Promise<void> {
    const integrationName = this.deviceIntegrationMap.get(deviceId);
    if (!integrationName) {
      // Try MQTT devices — they don't have an integration handler
      logger.warn({ deviceId }, "No integration found for device, action may not be supported");
      return;
    }

    const integration = this.integrations.get(integrationName);
    if (!integration) {
      throw new Error(`Integration not found: ${integrationName}`);
    }

    await integration.execute(action);
  }

  /** Dispose all integrations */
  async disposeAll(): Promise<void> {
    for (const [name, integration] of this.integrations) {
      try {
        await integration.dispose();
        logger.info({ integration: name }, "Integration disposed");
      } catch (err) {
        logger.error({ integration: name, error: (err as Error).message }, "Integration dispose failed");
      }
    }
  }
}