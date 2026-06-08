// src/connectors/connector-manager.ts — Lifecycle management for enabled connector instances

import crypto from "node:crypto";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device, Action, NormalizedEvent, ActionResult } from "../core/types.js";
import { DEVICE_STATE_CHANGE, CONNECTOR_POLL, CONNECTOR_ERROR } from "../core/event-bus.js";
import type {
  Connector,
  ConnectorInstanceInfo,
  ConnectorRecord,
  SetupStepDescriptor,
  SetupStepResult,
  CapabilityDescriptor,
} from "./connector.interface.js";
import { CAPABILITY_ACTION_MAP, MQTT_COMMAND_DESCRIPTOR } from "./capability-action-map.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { ConnectorStore } from "./connector-store.js";
import type { ActionExecutor } from "../automations/action-executor.js";
import type { ConditionRegistry } from "../automations/condition-registry.js";
import type { MqttService } from "../mqtt/mqtt-service.js";
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
  /** Tracks which action handler types each instance contributed, for cleanup on disable. */
  private contributedHandlers = new Map<string, string[]>();
  /** Tracks which condition types each instance contributed, for cleanup on disable. */
  private contributedConditions = new Map<string, string[]>();
  private actionExecutor?: ActionExecutor;
  private conditionRegistry?: ConditionRegistry;
  private mqttService?: MqttService;

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly store: ConnectorStore,
    private readonly deviceRegistry: DeviceRegistry,
    private readonly eventBus: EventEmitter,
  ) {}

  /**
   * Set the ActionExecutor and ConditionRegistry dependencies.
   *
   * Called after construction to break the circular dependency between
   * ConnectorManager and ActionExecutor. Must be called before
   * `restoreFromStore()` so contributed handlers are registered on startup.
   */
  setRegistries(actionExecutor: ActionExecutor, conditionRegistry: ConditionRegistry): void {
    this.actionExecutor = actionExecutor;
    this.conditionRegistry = conditionRegistry;
  }

  /**
   * Set the MqttService dependency for MQTT command publishing.
   * Must be called before executeAction() is used with MQTT devices.
   */
  setMqttService(mqttService: MqttService): void {
    this.mqttService = mqttService;
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
        this.emitDeviceEvent(device);
        devices.add(device.id);
      }
    } catch (err) {
      logger.error(
        { connectorType, instanceId, error: (err as Error).message },
        "discoverDevices() failed during enable",
      );
    }

    // Register contributed action handlers
    if (mod.actionHandlers && this.actionExecutor) {
      const types = Object.keys(mod.actionHandlers);
      for (const [type, handler] of Object.entries(mod.actionHandlers)) {
        this.actionExecutor.registerHandler(type, handler);
      }
      this.contributedHandlers.set(instanceId, types);
    }

    // Register contributed condition factories
    if (mod.conditions && this.conditionRegistry) {
      const types = Object.keys(mod.conditions);
      for (const [type, factory] of Object.entries(mod.conditions)) {
        this.conditionRegistry.registerCondition(type, factory);
      }
      this.contributedConditions.set(instanceId, types);
    }

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

    // Unregister contributed action handlers
    const handlerTypes = this.contributedHandlers.get(instanceId);
    if (handlerTypes && this.actionExecutor) {
      for (const type of handlerTypes) {
        this.actionExecutor.unregisterHandler(type);
      }
      this.contributedHandlers.delete(instanceId);
    }

    // Unregister contributed condition factories
    const conditionTypes = this.contributedConditions.get(instanceId);
    if (conditionTypes && this.conditionRegistry) {
      for (const type of conditionTypes) {
        this.conditionRegistry.unregisterCondition(type);
      }
      this.contributedConditions.delete(instanceId);
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
        this.emitDeviceEvent(device);
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
   *
   * Returns an ActionResult — never throws. All error paths are captured and
   * returned as ActionResult { success: false, error: ... }.
   *
   * Pre-flight validation is performed when an Action_Catalog is available:
   * - Device not found → ActionResult { success: false }
   * - Action type not in catalog → ActionResult { success: false }
   * - Params fail schema → ActionResult { success: false }
   * - MQTT device → publish to command topic
   * - Connector device → delegate to Connector.execute()
   *
   * Requirements: 1.2, 1.3, 1.4, 5.1–5.6, 6.1–6.7
   */
  async executeAction(deviceId: string, action: Action): Promise<ActionResult> {
    // Task 5.2 — device-not-found guard
    const device = this.deviceRegistry.getById(deviceId);
    if (!device) {
      return { success: false, error: `Device '${deviceId}' not found` };
    }

    // Task 5.3 — pre-flight validation
    const catalog = this.resolveActionCatalog(device);
    if (catalog !== undefined) {
      const descriptor = catalog.find((d) => d.type === action.type);
      if (!descriptor) {
        const supported = catalog.map((d) => d.type).join(", ");
        return {
          success: false,
          error: `Device '${deviceId}': unsupported action '${action.type}'. Supported: ${supported || "(none)"}`,
        };
      }
      // Param schema validation (basic required-field check)
      const paramError = this.validateParams(deviceId, action.type, descriptor, action.params);
      if (paramError) {
        return { success: false, error: paramError };
      }
    }

    // Task 5.4 — MQTT command publishing path
    if (device.integration === "mqtt") {
      return this.executeMqttAction(device, action);
    }

    // Task 5.5 — connector execute with try/catch
    for (const instance of this.instances.values()) {
      if (instance.record.connectorType === device.integration) {
        try {
          const connectorResult = await instance.connector.execute(action);

          // Handle special action types that modify the device list
          if (action.type === "delete") {
            this.deviceRegistry.remove(deviceId);
            logger.info({ deviceId }, "Device removed from registry after delete action");
            return { success: true };
          }

          if (action.type === "rename") {
            try {
              const discovered = await instance.connector.discoverDevices();
              for (const d of discovered) {
                this.emitDeviceEvent(d);
              }
            } catch (err) {
              logger.warn({ error: (err as Error).message }, "Re-discovery after rename failed");
            }
            return { success: true };
          }

          // Emit immediate synthetic event with optimistic state update
          const updatedState = { ...device.state };
          if (action.type === "toggle") {
            updatedState.on = !device.state.on;
          } else if (action.params) {
            Object.assign(updatedState, action.params);
          }

          this.emitDeviceEvent({
            ...device,
            state: updatedState,
            lastSeen: Date.now(),
          });

          logger.debug(
            { deviceId, actionType: action.type, integration: device.integration },
            "Immediate state event emitted after action execution",
          );

          // connectorResult is void from the interface, but cast to unknown for data field
          const data = connectorResult as unknown;
          return {
            success: true,
            ...(data !== undefined && data !== null
              ? { data: data as Record<string, unknown> }
              : {}),
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }
    }

    return {
      success: false,
      error: `No enabled connector found for device '${deviceId}' (integration: '${device.integration}')`,
    };
  }

  /**
   * Derive the Action_Catalog for a device.
   * Checks connector instance getActionCatalog(), then module-level getActionCatalog(),
   * then falls back to CAPABILITY_ACTION_MAP. Returns undefined when no catalog is available.
   */
  private resolveActionCatalog(device: Device): CapabilityDescriptor[] | undefined {
    // Check connector instance method first
    for (const instance of this.instances.values()) {
      if (instance.record.connectorType === device.integration) {
        if (instance.connector.getActionCatalog) {
          const catalog = instance.connector.getActionCatalog(device.id);
          if (catalog !== undefined) return catalog;
        }
        // Check module-level method
        const mod = this.registry.getModule(instance.record.connectorType);
        if (mod?.getActionCatalog) {
          const catalog = mod.getActionCatalog(device);
          if (catalog !== undefined) return catalog;
        }
        break;
      }
    }

    // MQTT devices always get the MQTT command descriptor
    if (device.integration === "mqtt") {
      const capabilityDescriptors = device.capabilities.flatMap(
        (cap) => CAPABILITY_ACTION_MAP[cap] ?? [],
      );
      return [...capabilityDescriptors, MQTT_COMMAND_DESCRIPTOR];
    }

    // Fall back to CAPABILITY_ACTION_MAP if device has capabilities
    if (device.capabilities.length > 0) {
      const descriptors = device.capabilities.flatMap(
        (cap) => CAPABILITY_ACTION_MAP[cap] ?? [],
      );
      return descriptors.length > 0 ? descriptors : undefined;
    }

    return undefined;
  }

  /**
   * Validate action params against the descriptor's param schema.
   * Returns an error string if validation fails, or undefined if valid.
   * Requirements: 6.2, 6.7
   */
  private validateParams(
    deviceId: string,
    actionType: string,
    descriptor: CapabilityDescriptor,
    params: Record<string, unknown>,
  ): string | undefined {
    const schema = descriptor.params as Record<string, unknown>;
    if (!schema || Object.keys(schema).length === 0) return undefined;

    const required = schema.required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (params[field] === undefined || params[field] === null) {
          return `Device '${deviceId}' action '${actionType}': invalid param '${field}': required field missing`;
        }
        // Range validation from properties schema
        const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
        if (properties?.[field]) {
          const fieldSchema = properties[field];
          const value = params[field];
          if (typeof value === "number") {
            if (fieldSchema.minimum !== undefined && value < (fieldSchema.minimum as number)) {
              return `Device '${deviceId}' action '${actionType}': invalid param '${field}': value ${value} is below minimum ${fieldSchema.minimum}`;
            }
            if (fieldSchema.maximum !== undefined && value > (fieldSchema.maximum as number)) {
              return `Device '${deviceId}' action '${actionType}': invalid param '${field}': value ${value} exceeds maximum ${fieldSchema.maximum}`;
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Execute an action on an MQTT device by publishing to its command topic.
   * Requirements: 5.1–5.6
   */
  private executeMqttAction(device: Device, action: Action): ActionResult {
    if (!this.mqttService || !this.mqttService.isConnected()) {
      return { success: false, error: "MQTT broker not connected" };
    }

    // Derive command topic: replace last segment with "set", or use explicit commandTopic
    const topic = typeof device.state.topic === "string"
      ? device.state.topic
      : (device as unknown as Record<string, unknown>).topic as string | undefined;

    const explicitCommandTopic = (device as unknown as Record<string, unknown>).commandTopic as string | undefined
      ?? (typeof device.state.commandTopic === "string" ? device.state.commandTopic : undefined);

    const commandTopic = explicitCommandTopic
      ?? (topic ? topic.split("/").slice(0, -1).concat("set").join("/") : `${device.id}/set`);

    // Determine payload
    const payload = action.params.payload !== undefined
      ? (typeof action.params.payload === "string"
          ? action.params.payload
          : JSON.stringify(action.params.payload))
      : JSON.stringify(action.params);

    try {
      this.mqttService.publish(commandTopic, payload);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Return the action catalog for a device.
   * Used by GET /api/devices/:id/actions.
   * Returns an empty array when no catalog is derivable.
   * Requirements: 3.1–3.4
   */
  getActionCatalog(deviceId: string): CapabilityDescriptor[] {
    const device = this.deviceRegistry.getById(deviceId);
    if (!device) return [];
    return this.resolveActionCatalog(device) ?? [];
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
          this.emitDeviceEvent(device);
          devices.add(device.id);
        }
      } catch (err) {
        logger.error(
          { connectorType: record.connectorType, instanceId: record.id, error: (err as Error).message },
          "discoverDevices() failed during restore",
        );
      }

      // Register contributed action handlers
      if (mod.actionHandlers && this.actionExecutor) {
        const types = Object.keys(mod.actionHandlers);
        for (const [type, handler] of Object.entries(mod.actionHandlers)) {
          this.actionExecutor.registerHandler(type, handler);
        }
        this.contributedHandlers.set(record.id, types);
      }

      // Register contributed condition factories
      if (mod.conditions && this.conditionRegistry) {
        const types = Object.keys(mod.conditions);
        for (const [type, factory] of Object.entries(mod.conditions)) {
          this.conditionRegistry.registerCondition(type, factory);
        }
        this.contributedConditions.set(record.id, types);
      }

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
            this.emitDeviceEvent(device);
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
  private emitDeviceEvent(device: Device): void {
    const event: NormalizedEvent = {
      deviceId: device.id,
      deviceType: device.type,
      state: device.state,
      topic: `connector/${device.integration}/${device.id}`,
      timestamp: device.lastSeen || Date.now(),
      integration: device.integration,
      capabilities: device.capabilities,
    };
    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }
}
