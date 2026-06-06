// src/automations/action-executor.ts — Central dispatch service for all automation actions

import type { Logger } from "pino";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { ConnectorManager } from "../connectors/connector-manager.js";
import type { ActionResult } from "../core/types.js";
import { eventBus, AUTOMATION_FIRED } from "../core/event-bus.js";

/** Descriptor for a single automation action to be dispatched. */
export interface ActionDescriptor {
  type: string;
  target: string;
  params: Record<string, unknown>;
}

/** Dependencies injected into the ActionExecutor. */
export interface ActionExecutorDeps {
  mqttService: MqttService;
  connectorManager: ConnectorManager;
  logger: Logger;
}

/** A handler function that executes a single action type. */
export type ActionHandler = (
  action: ActionDescriptor,
  ruleId: string,
  deps: ActionExecutorDeps,
) => void | Promise<void>;

/**
 * Dispatches automation action descriptors to the appropriate service.
 *
 * Every action — whether from a form rule, script rule, or file-based rule —
 * flows through this single pipeline. Each action is wrapped in try/catch;
 * errors are logged with the rule ID and never thrown.
 */
export class ActionExecutor {
  private handlers = new Map<string, ActionHandler>();
  private deps: ActionExecutorDeps;

  constructor(deps: ActionExecutorDeps) {
    this.deps = deps;
  }

  /** Register a handler for an action type. Overwrites if already registered. */
  registerHandler(type: string, handler: ActionHandler): void {
    this.handlers.set(type, handler);
  }

  /** Unregister a handler for an action type. No-op if not registered. */
  unregisterHandler(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * Execute a single action descriptor.
   *
   * Returns an ActionResult — never throws. All error paths are captured and
   * returned as ActionResult { success: false, error: ... }.
   *
   * Requirements: 2.1, 2.4, 2.5
   */
  async execute(action: ActionDescriptor, ruleId: string): Promise<ActionResult> {
    try {
      const handler = this.handlers.get(action.type);
      if (!handler) {
        this.deps.logger.warn(
          { ruleId, actionType: action.type },
          `No handler for action type: ${action.type}`,
        );
        return { success: false, error: `No handler for action type: '${action.type}'` };
      }

      await handler(action, ruleId, this.deps);

      eventBus.emit(AUTOMATION_FIRED, {
        ruleId,
        actionType: action.type,
        target: action.target,
        timestamp: Date.now(),
      });

      return { success: true };
    } catch (err) {
      const message = (err as Error).message;
      this.deps.logger.error(
        { ruleId, actionType: action.type, target: action.target, error: message },
        `Action execution failed for rule ${ruleId}`,
      );
      return { success: false, error: message };
    }
  }

  /** Execute a sequence of actions in order. Continues on individual failures. */
  async executeSequence(actions: ActionDescriptor[], ruleId: string): Promise<void> {
    for (const action of actions) {
      await this.execute(action, ruleId);
    }
  }
}

// ── Built-in action handlers ────────────────────────────────────────────────

/** Publish an MQTT message. */
export const handlePublish: ActionHandler = (action, ruleId, deps) => {
  if (!deps.mqttService.isConnected()) {
    deps.logger.error(
      { ruleId, topic: action.target },
      "MQTT not connected, skipping publish action",
    );
    throw new Error("MQTT client not connected");
  }
  const payload = typeof action.params.payload === "string"
    ? action.params.payload
    : JSON.stringify(action.params.payload);
  deps.mqttService.publish(action.target, payload);
};

/** Toggle a device via the connector manager. */
export const handleToggle: ActionHandler = async (action, _ruleId, deps) => {
  await deps.connectorManager.executeAction(action.target, {
    type: "toggle",
    deviceId: action.target,
    params: action.params,
  });
};

/** Execute an arbitrary device action via the connector manager. */
export const handleDeviceAction: ActionHandler = async (action, _ruleId, deps) => {
  const actionType = typeof action.params.actionType === "string"
    ? action.params.actionType
    : "unknown";
  await deps.connectorManager.executeAction(action.target, {
    type: actionType,
    deviceId: action.target,
    params: action.params,
  });
};

/** Log a message from an automation rule. */
export const handleLog: ActionHandler = (action, ruleId, deps) => {
  const message = typeof action.params.message === "string"
    ? action.params.message
    : JSON.stringify(action.params.message);
  deps.logger.info({ ruleId, message }, `Automation log: ${message}`);
};

/** Delay execution for a specified duration in milliseconds. */
export const handleDelay: ActionHandler = async (action, ruleId, deps) => {
  const duration = typeof action.params.duration === "number" ? action.params.duration : 0;
  if (duration <= 0) {
    deps.logger.warn({ ruleId, duration }, "Delay with zero/negative duration, treating as no-op");
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, duration));
};

/** Send an HTTP webhook request. */
export const handleWebhook: ActionHandler = async (action, ruleId, deps) => {
  const method = typeof action.params.method === "string" ? action.params.method : "POST";
  const headers = (action.params.headers as Record<string, string>) ?? {};
  const body = action.params.body !== undefined ? String(action.params.body) : undefined;

  const response = await fetch(action.target, { method, headers, body });
  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status} ${response.statusText}`);
  }
};
