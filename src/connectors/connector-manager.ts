// src/connectors/connector-manager.ts — Lifecycle management for enabled connector instances

import crypto from "node:crypto";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device, Action, NormalizedEvent, ActionResult } from "../core/types.js";
import { DEVICE_STATE_CHANGE, CONNECTOR_POLL, CONNECTOR_ERROR } from "../core/event-bus.js";
import type {
  Connector,
  ConnectorModule,
  ConnectorInstanceInfo,
  ConnectorRecord,
  SetupStepDescriptor,
  SetupStepResult,
  CapabilityDescriptor,
  AcknowledgementCapability,
} from "./connector.interface.js";
import type { ConfirmationTier } from "../automations/command-lifecycle.js";
import { computeCapabilityCeiling } from "../automations/completion-tier.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { ConnectorStore } from "./connector-store.js";
import { ActionRouter } from "./action-router.js";
import type { CommandService } from "../automations/command-service.js";
import type { ConditionRegistry } from "../automations/condition-registry.js";
import type { MqttService } from "../mqtt/mqtt-service.js";
import logger from "../logger.js";

/** Default polling interval in milliseconds for device discovery. */
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Internal tracking state for a single enabled connector instance. */
export interface ManagedInstance {
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
  /**
   * Number of enabled instances per connector type. Contributed action/condition
   * handlers are type-generic, so they are registered once when the first
   * instance of a type is enabled and torn down only when the last instance of
   * that type is disabled — a sibling instance keeps them alive.
   */
  private activeInstanceCountByType = new Map<string, number>();
  private commandService?: CommandService;
  private conditionRegistry?: ConditionRegistry;
  private readonly actionRouter: ActionRouter;

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly store: ConnectorStore,
    private readonly deviceRegistry: DeviceRegistry,
    private readonly eventBus: EventEmitter,
  ) {
    this.actionRouter = new ActionRouter(
      this.instances,
      this.deviceRegistry,
      this.registry,
      (device) => this.emitDeviceEvent(device),
    );
  }

  /**
   * Set the CommandService and ConditionRegistry dependencies.
   *
   * Called after construction to break the circular dependency between
   * ConnectorManager and CommandService. Must be called before
   * `restoreFromStore()` so contributed handlers are registered on startup.
   */
  setRegistries(commandService: CommandService, conditionRegistry: ConditionRegistry): void {
    this.commandService = commandService;
    this.conditionRegistry = conditionRegistry;
  }

  /**
   * Register a connector type's contributed action/condition handlers when its
   * first instance becomes active, and increment the per-type active count.
   * Contributions are type-generic, so a second instance of the same type does
   * not re-register them.
   */
  private registerContributions(connectorType: string, mod: ConnectorModule): void {
    const count = this.activeInstanceCountByType.get(connectorType) ?? 0;
    if (count === 0) {
      if (mod.actionHandlers && this.commandService) {
        for (const [type, contribution] of Object.entries(mod.actionHandlers)) {
          this.commandService.registerHandler(type, contribution.handler, {
            physical: contribution.physical,
          });
        }
      }
      if (mod.conditions && this.conditionRegistry) {
        for (const [type, factory] of Object.entries(mod.conditions)) {
          this.conditionRegistry.registerCondition(type, factory);
        }
      }
    }
    this.activeInstanceCountByType.set(connectorType, count + 1);
  }

  /**
   * Decrement the per-type active count and tear down the type's contributed
   * handlers only when the last instance of that type is disabled. A sibling
   * instance of the same type keeps the contributions registered.
   */
  private unregisterContributions(connectorType: string, mod: ConnectorModule): void {
    const remaining = (this.activeInstanceCountByType.get(connectorType) ?? 1) - 1;
    if (remaining <= 0) {
      if (mod.actionHandlers && this.commandService) {
        for (const type of Object.keys(mod.actionHandlers)) {
          this.commandService.unregisterHandler(type);
        }
      }
      if (mod.conditions && this.conditionRegistry) {
        for (const type of Object.keys(mod.conditions)) {
          this.conditionRegistry.unregisterCondition(type);
        }
      }
      this.activeInstanceCountByType.delete(connectorType);
    } else {
      this.activeInstanceCountByType.set(connectorType, remaining);
    }
  }

  /**
   * Set the MqttService dependency for MQTT command publishing.
   * Must be called before executeAction() is used with MQTT devices.
   */
  setMqttService(mqttService: MqttService): void {
    this.actionRouter.setMqttService(mqttService);
  }

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
        this.emitDeviceEvent(device, instanceId);
        devices.add(device.id);
      }
    } catch (err) {
      logger.error(
        { connectorType, instanceId, error: (err as Error).message },
        "discoverDevices() failed during enable",
      );
    }

    // Register contributed handlers (once per type, ref-counted across instances)
    this.registerContributions(connectorType, mod);

    // Persist to store
    this.store.save(record);

    // Start polling
    const pollingTimer = this.startPolling(instanceId, connector, devices, connectorType);

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

    // Tear down contributed handlers only if this is the last instance of the type
    const mod = this.registry.getModule(instance.record.connectorType);
    if (mod) {
      this.unregisterContributions(instance.record.connectorType, mod);
    }

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

    // Remove only the devices this instance owns — never a sibling instance's.
    // Primary signal is recorded ownership; the instance's own discovered-device
    // set covers legacy/in-flight devices that have no persisted owner yet.
    const connectorType = instance.record.connectorType;
    for (const device of this.deviceRegistry.getAll()) {
      const ownedById = device.connectorInstanceId === instanceId;
      const ownedBySet = device.connectorInstanceId === undefined && instance.devices.has(device.id);
      if (ownedById || ownedBySet) {
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
        this.emitDeviceEvent(device, instanceId);
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
   * Return the setup step descriptors for a managed connector instance.
   * Returns `[]` if the connector doesn't implement `getSetupSteps()`.
   */
  getSetupSteps(instanceId: string): SetupStepDescriptor[] {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Connector instance '${instanceId}' not found`);
    }
    return instance.connector.getSetupSteps?.() ?? [];
  }

  /**
   * Route an action to the correct connector based on the device's integration field.
   * Delegates to {@link ActionRouter}; returns an ActionResult and never throws.
   */
  async executeAction(
    deviceId: string,
    action: Action,
    correlation?: { correlationId: string; responseTopic: string },
  ): Promise<ActionResult> {
    return this.actionRouter.executeAction(deviceId, action, correlation);
  }

  /**
   * Return the acknowledgement capability declared for a device by its
   * connector, or undefined when none is declared (Dispatch tier).
   */
  getAcknowledgementCapability(deviceId: string): AcknowledgementCapability | undefined {
    return this.actionRouter.getAcknowledgementCapability(deviceId);
  }

  /**
   * Report the completion-tier capability ceiling for a device. Pure composition of
   * existing capability reads; performs no dispatch. `observationAvailable` reflects
   * a known observation source supplied by the caller (default false, matching the
   * form-rule reality of no ConfirmOptions).
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
   */
  getCompletionTierCapability(
    deviceId: string,
    observationAvailable = false,
  ): { resolved: boolean; tiers: ConfirmationTier[]; ceiling: ConfirmationTier | null } {
    const device = this.deviceRegistry.getById(deviceId);
    if (!device) return { resolved: false, tiers: [], ceiling: null }; // Req 2.8
    const ackSupported = this.getAcknowledgementCapability(deviceId)?.supported === true;
    const result = computeCapabilityCeiling({
      dispatchable: true, // a resolvable registered device can dispatch (Req 2.1)
      ackSupported,
      observationAvailable,
    });
    return { resolved: true, ...result };
  }

  /**
   * Return the action catalog for a device.
   * Used by GET /api/devices/:id/actions. Delegates to {@link ActionRouter}.
   */
  getActionCatalog(deviceId: string): CapabilityDescriptor[] {
    return this.actionRouter.getActionCatalog(deviceId);
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
   * Return the underlying Connector instance for direct method access.
   * Used by routes that need to call connector-specific methods (e.g. searchForNewLights).
   */
  getConnectorInstance(instanceId: string): Connector | undefined {
    return this.instances.get(instanceId)?.connector;
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
          this.emitDeviceEvent(device, record.id);
          devices.add(device.id);
        }
      } catch (err) {
        logger.error(
          { connectorType: record.connectorType, instanceId: record.id, error: (err as Error).message },
          "discoverDevices() failed during restore",
        );
      }

      // Register contributed handlers (once per type, ref-counted across instances)
      this.registerContributions(record.connectorType, mod);

      const pollingTimer = this.startPolling(record.id, connector, devices, record.connectorType);

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
    connectorType: string,
  ): ReturnType<typeof setInterval> {
    return setInterval(async () => {
      try {
        const discovered = await connector.discoverDevices();
        // Sync the device set — replace with current poll results, not just accumulate.
        // This ensures the device count reflects reality, not a high-water mark.
        if (discovered.length > 0) {
          devices.clear();
          for (const device of discovered) {
            this.emitDeviceEvent(device, instanceId);
            devices.add(device.id);
          }
        }
        // If discovered is empty, keep the existing set — don't wipe devices on a transient miss

        // Emit successful poll event for metrics (regardless of device count)
        this.eventBus.emit(CONNECTOR_POLL, { connectorType, instanceId, devicesDiscovered: discovered.length });
      } catch (err) {
        logger.error(
          { instanceId, error: (err as Error).message },
          "discoverDevices() failed during poll",
        );
        this.eventBus.emit(CONNECTOR_ERROR, { connectorType, instanceId, error: (err as Error).message });
      }
    }, DEFAULT_POLL_INTERVAL_MS);
  }

  /**
   * Emit a DEVICE_STATE_CHANGE event for a connector-discovered device.
   *
   * This feeds the device through the same pipeline as MQTT devices:
   * EventBus → DeviceRegistry.upsert() → SQLite persist → WS broadcast → Automations
   *
   * Uses a synthetic topic `connector/{integration}/{deviceId}` so automations
   * can match on connector device events using the standard topic pattern system.
   */
  private emitDeviceEvent(device: Device, instanceId?: string): void {
    // The owning instance is the one that discovered the device. The optimistic
    // re-emit path (ActionRouter) passes no id, so fall back to the ownership
    // already recorded on the device, preserving it across state updates.
    const connectorInstanceId = instanceId ?? device.connectorInstanceId;
    const event: NormalizedEvent = {
      deviceId: device.id,
      deviceType: device.type,
      state: device.state,
      topic: `connector/${device.integration}/${device.id}`,
      timestamp: device.lastSeen || Date.now(),
      integration: device.integration,
      capabilities: device.capabilities,
      ...(connectorInstanceId ? { connectorInstanceId } : {}),
    };
    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }
}
