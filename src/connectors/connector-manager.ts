// src/connectors/connector-manager.ts — Lifecycle management for enabled connector instances

import crypto from "node:crypto";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device, Action } from "../core/types.js";
import type {
  Connector,
  ConnectorInstanceInfo,
  ConnectorRecord,
  ConnectorHealthStatus,
  SetupStepResult,
} from "./connector.interface.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { ConnectorStore } from "./connector-store.js";
import logger from "../logger.js";

/** Default polling interval in milliseconds for device discovery. */
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Internal tracking state for a single enabled connector instance. */
interface ManagedInstance {
  connector: Connector;
  record: ConnectorRecord;
  pollingTimer: ReturnType<typeof setInterval>;
  devices: Set<string>;
}

/**
 * Manages the full lifecycle of enabled connector instances.
 *
 * Responsibilities:
 * - Enable / disable connectors at runtime
 * - Periodic device discovery via polling
 * - Action routing to the correct connector
 * - Persist state through ConnectorStore
 * - Restore previously enabled connectors on startup
 */
export class ConnectorManager {
  private instances = new Map<string, ManagedInstance>();

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly store: ConnectorStore,
    private readonly deviceRegistry: DeviceRegistry,
    private readonly eventBus: EventEmitter,
  ) {}

  /**
   * Enable a connector: validate type, instantiate via factory, connect,
   * discover devices, persist to store, and start polling.
   *
   * @returns The generated instance UUID.
   */
  async enable(
    connectorType: string,
    config: Record<string, unknown>,
  ): Promise<string> {
    const mod = this.registry.getModule(connectorType);
    if (!mod) {
      throw new Error(`Connector type '${connectorType}' not found in registry`);
    }

    const connector = mod.createConnector(config);
    const instanceId = crypto.randomUUID();
    const now = Date.now();

    const record: ConnectorRecord = {
      id: instanceId,
      connectorType,
      enabled: true,
      config,
      createdAt: now,
      updatedAt: now,
    };

    // Attempt connection — on failure, mark disconnected but keep instance
    try {
      await connector.connect();
    } catch (err) {
      logger.error(
        { connectorType, instanceId, error: (err as Error).message },
        "Connector connect() failed during enable",
      );
    }

    // Discover devices (only if connected)
    const devices = new Set<string>();
    try {
      const discovered = await connector.discoverDevices();
      for (const device of discovered) {
        this.deviceRegistry.registerDevice(device);
        devices.add(device.id);
      }
    } catch (err) {
      logger.error(
        { connectorType, instanceId, error: (err as Error).message },
        "discoverDevices() failed during enable",
      );
    }

    // Persist to store
    this.store.save(record);

    // Start polling
    const pollingTimer = this.startPolling(instanceId, connector, devices);

    this.instances.set(instanceId, { connector, record, pollingTimer, devices });

    logger.info(
      { connectorType, instanceId, deviceCount: devices.size },
      "Connector enabled",
    );

    return instanceId;
  }

  /**
   * Disable a connector: stop polling, disconnect, dispose, remove devices,
   * and update the store (disable, don't delete).
   */
  async disable(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Connector instance '${instanceId}' not found`);
    }

    // Stop polling
    clearInterval(instance.pollingTimer);

    // Disconnect and dispose
    try {
      await instance.connector.disconnect();
    } catch (err) {
      logger.error(
        { instanceId, error: (err as Error).message },
        "Error during connector disconnect",
      );
    }

    try {
      await instance.connector.dispose();
    } catch (err) {
      logger.error(
        { instanceId, error: (err as Error).message },
        "Error during connector dispose",
      );
    }

    // Remove devices from DeviceRegistry that belong to this connector
    const connectorType = instance.record.connectorType;
    const allDevices = this.deviceRegistry.getAll();
    for (const device of allDevices) {
      if (device.integration === connectorType) {
        this.deviceRegistry.remove(device.id);
      }
    }

    // Update store (disable, don't delete)
    this.store.disable(instanceId);

    this.instances.delete(instanceId);

    logger.info({ instanceId, connectorType }, "Connector disabled");
  }

  /**
   * Update configuration on a running connector instance.
   */
  async updateConfig(
    instanceId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Connector instance '${instanceId}' not found`);
    }

    instance.connector.onConfigUpdate(config);

    // Update the record and persist
    instance.record.config = { ...instance.record.config, ...config };
    instance.record.updatedAt = Date.now();
    this.store.save(instance.record);

    logger.info({ instanceId }, "Connector config updated");
  }

  /**
   * Retry connection for a disconnected connector, then re-discover devices.
   */
  async retry(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Connector instance '${instanceId}' not found`);
    }

    try {
      await instance.connector.connect();
    } catch (err) {
      logger.error(
        { instanceId, error: (err as Error).message },
        "Connector retry connect() failed",
      );
      return;
    }

    try {
      const discovered = await instance.connector.discoverDevices();
      for (const device of discovered) {
        this.deviceRegistry.registerDevice(device);
        instance.devices.add(device.id);
      }
    } catch (err) {
      logger.error(
        { instanceId, error: (err as Error).message },
        "discoverDevices() failed during retry",
      );
    }

    logger.info({ instanceId }, "Connector retry completed");
  }

  /**
   * Delegate a setup step to the connector instance.
   */
  async executeSetupStep(
    instanceId: string,
    stepId: string,
    params: Record<string, unknown>,
  ): Promise<SetupStepResult> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Connector instance '${instanceId}' not found`);
    }

    if (!instance.connector.executeSetupStep) {
      throw new Error(
        `Connector instance '${instanceId}' does not support setup steps`,
      );
    }

    return instance.connector.executeSetupStep(stepId, params);
  }

  /**
   * Route an action to the correct connector based on the device's integration field.
   */
  async executeAction(deviceId: string, action: Action): Promise<void> {
    const device = this.deviceRegistry.getById(deviceId);
    if (!device) {
      throw new Error(`Device '${deviceId}' not found`);
    }

    // MQTT devices are not routed to any connector
    if (device.integration === "mqtt") {
      return;
    }

    // Find the connector instance that manages this device
    for (const instance of this.instances.values()) {
      if (instance.record.connectorType === device.integration) {
        await instance.connector.execute(action);
        return;
      }
    }

    throw new Error(
      `No enabled connector found for device '${deviceId}' with integration '${device.integration}'`,
    );
  }

  /**
   * Return ConnectorInstanceInfo[] for all enabled instances.
   */
  listEnabled(): ConnectorInstanceInfo[] {
    const result: ConnectorInstanceInfo[] = [];

    for (const [id, instance] of this.instances) {
      const mod = this.registry.getModule(instance.record.connectorType);
      const health = instance.connector.getHealthStatus();

      result.push({
        id,
        connectorType: instance.record.connectorType,
        displayName: mod?.metadata.displayName ?? instance.record.connectorType,
        icon: mod?.metadata.icon ?? "plug",
        config: instance.record.config,
        health,
        deviceCount: instance.devices.size,
        enabled: true,
      });
    }

    return result;
  }

  /**
   * Return ConnectorInstanceInfo for a specific instance.
   */
  getStatus(instanceId: string): ConnectorInstanceInfo | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance) return undefined;

    const mod = this.registry.getModule(instance.record.connectorType);
    const health = instance.connector.getHealthStatus();

    return {
      id: instanceId,
      connectorType: instance.record.connectorType,
      displayName: mod?.metadata.displayName ?? instance.record.connectorType,
      icon: mod?.metadata.icon ?? "plug",
      config: instance.record.config,
      health,
      deviceCount: instance.devices.size,
      enabled: true,
    };
  }

  /**
   * Restore previously enabled connectors from the store on startup.
   * For each enabled record: get module from registry, instantiate, connect
   * (catch errors → set health disconnected), discoverDevices.
   */
  async restoreFromStore(): Promise<void> {
    const records = this.store.loadEnabled();

    for (const record of records) {
      const mod = this.registry.getModule(record.connectorType);
      if (!mod) {
        logger.warn(
          { connectorType: record.connectorType, instanceId: record.id },
          "Connector module not found in registry during restore — skipping",
        );
        continue;
      }

      const connector = mod.createConnector(record.config);
      const devices = new Set<string>();

      // Attempt connection
      try {
        await connector.connect();
      } catch (err) {
        logger.error(
          { connectorType: record.connectorType, instanceId: record.id, error: (err as Error).message },
          "Connector connect() failed during restore",
        );
      }

      // Discover devices
      try {
        const discovered = await connector.discoverDevices();
        for (const device of discovered) {
          this.deviceRegistry.registerDevice(device);
          devices.add(device.id);
        }
      } catch (err) {
        logger.error(
          { connectorType: record.connectorType, instanceId: record.id, error: (err as Error).message },
          "discoverDevices() failed during restore",
        );
      }

      const pollingTimer = this.startPolling(record.id, connector, devices);

      this.instances.set(record.id, { connector, record, pollingTimer, devices });

      logger.info(
        { connectorType: record.connectorType, instanceId: record.id, deviceCount: devices.size },
        "Connector restored from store",
      );
    }
  }

  /**
   * Stop all polling, disconnect and dispose all instances.
   */
  async disposeAll(): Promise<void> {
    for (const [instanceId, instance] of this.instances) {
      clearInterval(instance.pollingTimer);

      try {
        await instance.connector.disconnect();
      } catch (err) {
        logger.error(
          { instanceId, error: (err as Error).message },
          "Error during connector disconnect in disposeAll",
        );
      }

      try {
        await instance.connector.dispose();
      } catch (err) {
        logger.error(
          { instanceId, error: (err as Error).message },
          "Error during connector dispose in disposeAll",
        );
      }
    }

    this.instances.clear();
    logger.info("All connectors disposed");
  }

  /**
   * Start a polling interval for a connector that periodically calls discoverDevices.
   */
  private startPolling(
    instanceId: string,
    connector: Connector,
    devices: Set<string>,
  ): ReturnType<typeof setInterval> {
    return setInterval(async () => {
      try {
        const discovered = await connector.discoverDevices();
        for (const device of discovered) {
          this.deviceRegistry.registerDevice(device);
          devices.add(device.id);
        }
      } catch (err) {
        logger.error(
          { instanceId, error: (err as Error).message },
          "discoverDevices() failed during poll",
        );
      }
    }, DEFAULT_POLL_INTERVAL_MS);
  }
}
