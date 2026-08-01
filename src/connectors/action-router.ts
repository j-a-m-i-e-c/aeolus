// src/connectors/action-router.ts — Action dispatch and validation for connector devices

import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device, Action, ActionResult } from "../core/types.js";
import type { CapabilityDescriptor, AcknowledgementCapability } from "./connector.interface.js";
import { CAPABILITY_ACTION_MAP, MQTT_COMMAND_DESCRIPTOR } from "./capability-action-map.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { ManagedInstance } from "./connector-manager.js";
import logger from "../logger.js";

/**
 * Routes device actions to the correct connector and performs pre-flight
 * validation against each device's resolved Action_Catalog.
 *
 * Split out from {@link ConnectorManager} so connection lifecycle (enable /
 * disable / poll / restore) and action dispatch evolve independently. The
 * router reads the live instance map owned by the manager — it never mutates
 * connector lifecycle state.
 */
export class ActionRouter {
  private mqttService?: MqttService;

  constructor(
    private readonly instances: Map<string, ManagedInstance>,
    private readonly deviceRegistry: DeviceRegistry,
    private readonly registry: ConnectorRegistry,
    private readonly emitDeviceEvent: (device: Device) => void,
  ) {}

  /**
   * Set the MqttService dependency for MQTT command publishing.
   * Must be called before executeAction() is used with MQTT devices.
   */
  setMqttService(mqttService: MqttService): void {
    this.mqttService = mqttService;
  }

  /**
   * Resolve the connector instance that owns a device.
   *
   * When the device records a `connectorInstanceId`, that exact instance is the
   * owner: if it is not currently enabled we return `undefined` rather than
   * falling through to a same-type sibling, so a command is never misrouted to
   * an instance that does not own the device. Only when a device carries no
   * ownership (MQTT devices, or connector devices discovered before ownership
   * existed) do we fall back to the first enabled instance of the matching type.
   */
  private resolveOwningInstance(device: Device): ManagedInstance | undefined {
    if (device.connectorInstanceId) {
      return this.instances.get(device.connectorInstanceId);
    }
    for (const instance of this.instances.values()) {
      if (instance.record.connectorType === device.integration) return instance;
    }
    return undefined;
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
  async executeAction(
    deviceId: string,
    action: Action,
    correlation?: { correlationId: string; responseTopic: string },
  ): Promise<ActionResult> {
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
      return this.executeMqttAction(device, action, correlation);
    }

    // Task 5.5 — connector execute with try/catch, dispatched to the owning instance
    const owner = this.resolveOwningInstance(device);
    if (owner) {
      {
        const instance = owner;
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

    // No owning instance is currently enabled. Distinguish a device whose
    // specific owner is disabled from one with no matching connector at all,
    // so the failure never implies a same-type sibling could have handled it.
    if (device.connectorInstanceId) {
      return {
        success: false,
        error: `Owning connector instance '${device.connectorInstanceId}' for device '${deviceId}' is not enabled`,
      };
    }
    return {
      success: false,
      error: `No enabled connector found for device '${deviceId}' (integration: '${device.integration}')`,
    };
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
   * Derive the Action_Catalog for a device.
   * Checks connector instance getActionCatalog(), then module-level getActionCatalog(),
   * then falls back to CAPABILITY_ACTION_MAP. Returns undefined when no catalog is available.
   */
  private resolveActionCatalog(device: Device): CapabilityDescriptor[] | undefined {
    // Ask the owning instance first, then its module-level catalog.
    const owner = this.resolveOwningInstance(device);
    if (owner) {
      if (owner.connector.getActionCatalog) {
        const catalog = owner.connector.getActionCatalog(device.id);
        if (catalog !== undefined) return catalog;
      }
      const mod = this.registry.getModule(owner.record.connectorType);
      if (mod?.getActionCatalog) {
        const catalog = mod.getActionCatalog(device);
        if (catalog !== undefined) return catalog;
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
   * Return the acknowledgement capability declared for a device by its
   * connector, or undefined when none is declared.
   * Requirements: 9.1, 9.2
   */
  getAcknowledgementCapability(deviceId: string): AcknowledgementCapability | undefined {
    const device = this.deviceRegistry.getById(deviceId);
    if (!device) return undefined;
    const owner = this.resolveOwningInstance(device);
    return owner?.connector.getAcknowledgementCapability?.(deviceId);
  }

  /**
   * Execute an action on an MQTT device by publishing to its command topic.
   *
   * When a {@link CommandEnvelope} correlation is supplied, the correlation id
   * and response topic are set as MQTT 5 properties AND mirrored into the JSON
   * payload so firmware reading either mechanism can reply (Req 10.1).
   * Requirements: 5.1–5.6, 10.1
   */
  private executeMqttAction(
    device: Device,
    action: Action,
    correlation?: { correlationId: string; responseTopic: string },
  ): ActionResult {
    if (!this.mqttService || !this.mqttService.isConnected()) {
      return { success: false, error: "MQTT broker not connected" };
    }

    // Derive command topic: replace last segment with "set", or use explicit commandTopic
    const topic = device.topic
      ?? (typeof device.state.topic === "string" ? device.state.topic : undefined);

    const explicitCommandTopic = device.commandTopic
      ?? (typeof device.state.commandTopic === "string" ? device.state.commandTopic : undefined);

    const commandTopic = explicitCommandTopic
      ?? (topic ? topic.split("/").slice(0, -1).concat("set").join("/") : `${device.id}/set`);

    // Determine payload; mirror correlation fields into the JSON body when present.
    let payload: string;
    if (correlation) {
      const base = action.params.payload !== undefined && typeof action.params.payload === "object" && action.params.payload !== null
        ? (action.params.payload as Record<string, unknown>)
        : action.params;
      payload = JSON.stringify({
        ...base,
        correlationId: correlation.correlationId,
        responseTopic: correlation.responseTopic,
      });
    } else {
      payload = action.params.payload !== undefined
        ? (typeof action.params.payload === "string"
            ? action.params.payload
            : JSON.stringify(action.params.payload))
        : JSON.stringify(action.params);
    }

    try {
      if (correlation) {
        this.mqttService.publish(commandTopic, payload, {
          correlationData: Buffer.from(correlation.correlationId, "utf8"),
          responseTopic: correlation.responseTopic,
        });
      } else {
        this.mqttService.publish(commandTopic, payload);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
