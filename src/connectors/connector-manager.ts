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
import { CONNECTOR_POLL_DEFAULT_MS, CONNECTOR_POLL_MAX_MS, CONNECTOR_POLL_MIN_MS } from "./connector.interface.js";
import { resolveConfigUpdate, resolveNewConfig } from "./connector-config.js";
import type { ConfirmationTier } from "../automations/command-lifecycle.js";
import { computeCapabilityCeiling } from "../automations/completion-tier.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { ConnectorStore } from "./connector-store.js";
import { ActionRouter } from "./action-router.js";
import type { CommandService } from "../automations/command-service.js";
import type { ConditionRegistry } from "../automations/condition-registry.js";
import type { MqttService } from "../mqtt/mqtt-service.js";
import logger from "../logger.js";

/**
 * Polling state of one instance. Polls are chained, never overlapping: the next is
 * scheduled only when the current one settles, so a stalled request cannot pile up
 * concurrent polls. `abort` is signalled when the instance is disabled or disposed.
 */
export interface PollSchedule {
  timer?: ReturnType<typeof setTimeout>;
  /** The poll now running, if any. */
  current?: Promise<void>;
  /** Run another poll as soon as the current one settles (config changed mid-poll). */
  again: boolean;
  stopped: boolean;
  abort: AbortController;
}

/** Internal tracking state for a single enabled connector instance. */
export interface ManagedInstance {
  connector: Connector;
  record: ConnectorRecord;
  poll: PollSchedule;
  devices: Set<string>;
}

/** The delay before an instance's next poll, clamped to the manager's bounds. */
export function pollDelayMs(connector: Connector): number {
  const asked = connector.getPollIntervalMs?.();
  if (asked === undefined || !Number.isFinite(asked)) return CONNECTOR_POLL_DEFAULT_MS;
  return Math.min(CONNECTOR_POLL_MAX_MS, Math.max(CONNECTOR_POLL_MIN_MS, Math.round(asked)));
}

function newPollSchedule(): PollSchedule {
  return { again: false, stopped: false, abort: new AbortController() };
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

    // Refuses the password-mask placeholder and any invalid config before anything runs.
    config = resolveNewConfig(config, mod);
    const instanceId = crypto.randomUUID();
    const connector = mod.createConnector(config, { instanceId });
    const now = Date.now();
    const poll = newPollSchedule();

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
      const discovered = await connector.discoverDevices(poll.abort.signal);
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

    const instance: ManagedInstance = { connector, record, poll, devices };
    this.instances.set(instanceId, instance);
    this.schedulePoll(instanceId, instance, pollDelayMs(connector));

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

    // Stop polling and cancel a poll still in flight, before its result can
    // re-register a device this disable is about to remove.
    this.stopPolling(instance);

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

    const mod = this.registry.getModule(instance.record.connectorType);
    if (!mod) {
      throw new Error(`Connector type '${instance.record.connectorType}' not found in registry`);
    }

    // Resolve the mask to the stored secret and validate. Nothing is applied or
    // persisted unless this and the connector's own update both succeed.
    const resolved = resolveConfigUpdate(instance.record.config, config, mod);
    instance.connector.onConfigUpdate(resolved);

    instance.record.config = resolved;
    instance.record.updatedAt = Date.now();
    this.store.save(instance.record);

    // Poll promptly with the new config: now, or straight after a poll in flight.
    if (instance.poll.current) {
      instance.poll.again = true;
    } else {
      this.schedulePoll(instanceId, instance, 0);
    }

    logger.info({ instanceId, fields: Object.keys(config) }, "Connector config updated");
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

    // Through the scheduler, so a retry cannot run alongside a scheduled poll.
    if (instance.poll.current) {
      instance.poll.again = true;
      await instance.poll.current;
    } else {
      if (instance.poll.timer) clearTimeout(instance.poll.timer);
      await this.runPoll(instanceId, instance);
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

      const connector = mod.createConnector(record.config, { instanceId: record.id });
      const devices = new Set<string>();
      const poll = newPollSchedule();

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
        const discovered = await connector.discoverDevices(poll.abort.signal);
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

      const instance: ManagedInstance = { connector, record, poll, devices };
      this.instances.set(record.id, instance);
      this.schedulePoll(record.id, instance, pollDelayMs(connector));

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
      this.stopPolling(instance);

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

  /** Schedule the instance's next poll after `delayMs`, replacing any pending one. */
  private schedulePoll(instanceId: string, instance: ManagedInstance, delayMs: number): void {
    const { poll } = instance;
    if (poll.stopped) return;
    if (poll.timer) clearTimeout(poll.timer);
    poll.timer = setTimeout(() => {
      poll.timer = undefined;
      void this.runPoll(instanceId, instance);
    }, delayMs);
  }

  /** Stop scheduling, and abort a poll in flight where the connector supports it. */
  private stopPolling(instance: ManagedInstance): void {
    instance.poll.stopped = true;
    if (instance.poll.timer) clearTimeout(instance.poll.timer);
    instance.poll.timer = undefined;
    instance.poll.abort.abort();
  }

  /**
   * One poll. Only one runs per instance at a time; when it settles the next is
   * scheduled with the connector's current delay. A poll that settles after the
   * instance was stopped reports nothing, so it cannot resurrect removed devices.
   */
  private runPoll(instanceId: string, instance: ManagedInstance): Promise<void> {
    const { poll, connector, devices } = instance;
    if (poll.stopped) return Promise.resolve();
    if (poll.current) return poll.current;
    const connectorType = instance.record.connectorType;
    const run = (async () => {
      try {
        const discovered = await connector.discoverDevices(poll.abort.signal);
        if (poll.stopped) return;
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
        if (poll.stopped) return;
        logger.error(
          { instanceId, error: (err as Error).message },
          "discoverDevices() failed during poll",
        );
        this.eventBus.emit(CONNECTOR_ERROR, { connectorType, instanceId, error: (err as Error).message });
      }
    })().finally(() => {
      poll.current = undefined;
      if (poll.stopped) return;
      const delay = poll.again ? 0 : pollDelayMs(connector);
      poll.again = false;
      this.schedulePoll(instanceId, instance, delay);
    });
    poll.current = run;
    return run;
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
      name: device.name,
      timestamp: device.lastSeen || Date.now(),
      integration: device.integration,
      capabilities: device.capabilities,
      ...(connectorInstanceId ? { connectorInstanceId } : {}),
    };
    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }
}
