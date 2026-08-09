// src/simulator/device-registry.ts
// phase-2-mqtt-simulator Task 2 — simulator-local device registry + validation.
//
// Holds the loaded simulated devices, each with its state controller and model.
// Startup fails clearly on invalid definitions rather than silently skipping a
// malformed topic or duplicate key (Req 6.4). It reuses the Phase 1 reserved
// Automation Event namespace constant so a device state topic can never collide
// with the event control plane.

import type { Logger } from "pino";
import { RESERVED_EVENT_NAMESPACE } from "../automations/automation-event-service.js";
import { DeviceStateController, type StatePublishFn } from "./state-controller.js";
import type { TimerBudget } from "./timer-budget.js";
import type {
  AnyDeviceDefinition,
  ScenarioDeviceView,
  SimulatedDeviceModel,
  SimulatedState,
  SimulatedStateController,
} from "./types.js";

/** A registered device: its definition, per-device state controller and model. */
export interface RegisteredDevice {
  definition: AnyDeviceDefinition;
  controller: DeviceStateController<SimulatedState>;
  model: SimulatedDeviceModel;
}

export interface SimulatorDeviceRegistryDeps {
  publish: StatePublishFn;
  logger: Logger;
  /** Upper bound applied to any requested publish delay. */
  maxDelayMs: number;
  /** Shared cap on outstanding delayed operations, forwarded to controllers. */
  timerBudget?: TimerBudget;
}

function isWildcardTopic(topic: string): boolean {
  return topic.includes("+") || topic.includes("#");
}

function isReservedEventTopic(topic: string): boolean {
  return topic === RESERVED_EVENT_NAMESPACE || topic.startsWith(`${RESERVED_EVENT_NAMESPACE}/`);
}

export class SimulatorDeviceRegistry implements ScenarioDeviceView {
  private readonly devices = new Map<string, RegisteredDevice>();
  private readonly stateTopics = new Map<string, string>(); // topic -> device key
  private readonly commandTopics = new Map<string, string>(); // topic -> device key
  private readonly deps: SimulatorDeviceRegistryDeps;

  constructor(deps: SimulatorDeviceRegistryDeps) {
    this.deps = deps;
  }

  /**
   * Register a device definition. Validates keys and topics, then builds the
   * per-device state controller and model. Throws on any invalid definition so
   * the caller can fail simulator startup (Req 6.4).
   */
  register(definition: AnyDeviceDefinition): RegisteredDevice {
    this.validate(definition);

    const controller = new DeviceStateController<SimulatedState>({
      key: definition.key,
      stateTopic: definition.stateTopic,
      initialState: definition.initialState,
      retainState: definition.retainState ?? true,
      maxDelayMs: this.deps.maxDelayMs,
      publish: this.deps.publish,
      logger: this.deps.logger,
      ...(this.deps.timerBudget ? { timerBudget: this.deps.timerBudget } : {}),
    });

    // Build the model AFTER validation but BEFORE committing to the maps, so a
    // throwing factory does not leave a half-registered device.
    const model = definition.createModel({
      key: definition.key,
      name: definition.name,
      state: controller,
      logger: this.deps.logger,
    });

    const registered: RegisteredDevice = { definition, controller, model };
    this.devices.set(definition.key, registered);
    this.stateTopics.set(definition.stateTopic, definition.key);
    if (definition.commandTopic) {
      this.commandTopics.set(definition.commandTopic, definition.key);
    }
    return registered;
  }

  private validate(definition: AnyDeviceDefinition): void {
    const { key, stateTopic, commandTopic } = definition;

    if (!key || key.trim().length === 0) {
      throw new Error("Simulated device definition is missing a non-empty key");
    }
    if (this.devices.has(key)) {
      throw new Error(`Duplicate simulated device key: "${key}"`);
    }

    if (!stateTopic || stateTopic.trim().length === 0) {
      throw new Error(`Device "${key}": state topic must be a non-empty string`);
    }
    if (isWildcardTopic(stateTopic)) {
      throw new Error(`Device "${key}": state topic "${stateTopic}" must not contain MQTT wildcards`);
    }
    if (isReservedEventTopic(stateTopic)) {
      throw new Error(
        `Device "${key}": state topic "${stateTopic}" must not use the reserved Automation Event namespace "${RESERVED_EVENT_NAMESPACE}"`,
      );
    }
    if (this.stateTopics.has(stateTopic)) {
      throw new Error(
        `Device "${key}": state topic "${stateTopic}" already owned by device "${this.stateTopics.get(stateTopic)}"`,
      );
    }
    if (this.commandTopics.has(stateTopic)) {
      throw new Error(
        `Device "${key}": state topic "${stateTopic}" collides with a command topic (would self-trigger)`,
      );
    }

    if (commandTopic !== undefined) {
      if (commandTopic.trim().length === 0) {
        throw new Error(`Device "${key}": command topic must be a non-empty string when present`);
      }
      if (isWildcardTopic(commandTopic)) {
        throw new Error(`Device "${key}": command topic "${commandTopic}" must not contain MQTT wildcards`);
      }
      if (isReservedEventTopic(commandTopic)) {
        throw new Error(
          `Device "${key}": command topic "${commandTopic}" must not use the reserved Automation Event namespace "${RESERVED_EVENT_NAMESPACE}"`,
        );
      }
      if (commandTopic === stateTopic) {
        throw new Error(`Device "${key}": command topic must differ from its state topic (would self-trigger)`);
      }
      if (this.commandTopics.has(commandTopic)) {
        throw new Error(
          `Device "${key}": command topic "${commandTopic}" already owned by device "${this.commandTopics.get(commandTopic)}"`,
        );
      }
      if (this.stateTopics.has(commandTopic)) {
        throw new Error(
          `Device "${key}": command topic "${commandTopic}" collides with a state topic (would self-trigger)`,
        );
      }
    }
  }

  /** All registered devices. */
  list(): RegisteredDevice[] {
    return [...this.devices.values()];
  }

  /** Look up a device by key. */
  get(key: string): RegisteredDevice | undefined {
    return this.devices.get(key);
  }

  /** Look up the device that owns a command topic. */
  getByCommandTopic(topic: string): RegisteredDevice | undefined {
    const key = this.commandTopics.get(topic);
    return key ? this.devices.get(key) : undefined;
  }

  /** Every command topic currently owned by a device (for subscription). */
  commandTopicList(): string[] {
    return [...this.commandTopics.keys()];
  }

  /** ScenarioDeviceView: resolve a model by device key. */
  getModel(key: string): SimulatedDeviceModel | undefined {
    return this.devices.get(key)?.model;
  }

  /** ScenarioDeviceView: resolve a state controller by device key. */
  getController(key: string): SimulatedStateController | undefined {
    return this.devices.get(key)?.controller;
  }

  /**
   * Publish coherent current state for every device. Used on startup and after
   * reconnect; `force` bypasses no-op suppression so state is (re)asserted.
   */
  publishAll(force = true): void {
    for (const device of this.devices.values()) {
      device.controller.publish({ force });
    }
  }

  /** Dispose every device model and cancel outstanding state timers. */
  async dispose(): Promise<void> {
    for (const device of this.devices.values()) {
      try {
        await device.model.dispose?.();
      } catch (err) {
        this.deps.logger.error(
          { key: device.definition.key, error: (err as Error).message },
          "Error disposing simulated device model",
        );
      }
      device.controller.dispose();
    }
    this.devices.clear();
    this.stateTopics.clear();
    this.commandTopics.clear();
  }
}
