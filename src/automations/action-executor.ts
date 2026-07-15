// src/automations/action-executor.ts — Central dispatch service for all automation actions

import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { ConnectorManager } from "../connectors/connector-manager.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { ActionResult, CommandLifecycleState, ConfirmOptions } from "../core/types.js";
import { DEFAULT_CONFIRM_TIMEOUT_MS } from "../core/types.js";
import { eventBus, AUTOMATION_FIRED } from "../core/event-bus.js";
import { selectRequiredTier } from "./command-lifecycle.js";
import type { PendingCommandTracker } from "./pending-command-tracker.js";

/** Correlation fields attached to a command envelope for MQTT-correlating dispatch. */
export interface CommandCorrelation {
  correlationId: string;
  responseTopic: string;
}

/** Descriptor for a single automation action to be dispatched. */
export interface ActionDescriptor {
  type: string;
  target: string;
  params: Record<string, unknown>;
  /**
   * Correlation envelope fields, assigned by the ActionExecutor before dispatch
   * for commands that expect a device reply. Forwarded to the connector/MQTT
   * layer so the published command carries MQTT 5 Correlation Data / Response
   * Topic. Absent for dispatch-only commands.
   */
  correlation?: CommandCorrelation;
}

/** Dependencies injected into the ActionExecutor. */
export interface ActionExecutorDeps {
  mqttService: MqttService;
  connectorManager: ConnectorManager;
  logger: Logger;
  /** Device registry, used to validate Confirmation_Options observed devices (Req 5.5). */
  deviceRegistry?: DeviceRegistry;
  /** Tracker that correlates acks/observations back to dispatched commands. */
  pendingCommandTracker?: PendingCommandTracker;
  /** Base response-topic space for command acknowledgements (default "aeolus/acks"). */
  ackResponseTopicBase?: string;
}

/**
 * A handler function that executes a single action type.
 *
 * Handlers may return an {@link ActionResult} describing the dispatch outcome;
 * when they return `void` (and do not throw), dispatch is treated as accepted.
 */
export type ActionHandler = (
  action: ActionDescriptor,
  ruleId: string,
  deps: ActionExecutorDeps,
) => void | ActionResult | Promise<void | ActionResult>;

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
   * Execute a single action descriptor, driving it through the command
   * lifecycle.
   *
   * Returns an ActionResult — never throws — carrying the final
   * {@link CommandLifecycleState}:
   *   - dispatch-only commands resolve synchronously (REQUESTED → DISPATCHED | FAILED)
   *   - commands with an acknowledgement capability and/or Confirmation_Options
   *     register with the {@link PendingCommandTracker} and await the terminal
   *     resolution (ACKNOWLEDGED / OBSERVED / TIMED_OUT / STATE_MISMATCH / FAILED)
   *
   * Requirements: 4.2–4.9, 5.1–5.9, 6.1, 9.6, 10.2–10.4
   */
  async execute(
    action: ActionDescriptor,
    ruleId: string,
    confirm?: ConfirmOptions,
  ): Promise<ActionResult> {
    // REQUESTED
    const handler = this.handlers.get(action.type);
    if (!handler) {
      this.deps.logger.warn(
        { ruleId, actionType: action.type },
        `No handler for action type: ${action.type}`,
      );
      return {
        success: false,
        error: `No handler for action type: '${action.type}'`,
        lifecycleState: "FAILED",
      };
    }

    const targetDeviceId = action.target;
    const ackCapability = this.resolveAckCapability(targetDeviceId);
    const hasAckCapability = ackCapability?.supported === true;
    const hasConfirm = confirm !== undefined;
    const tier = selectRequiredTier(hasConfirm, hasAckCapability);

    // Validate the observed device exists before dispatching (Req 5.5).
    const observedDeviceId = confirm?.deviceId ?? targetDeviceId;
    if (hasConfirm && this.deps.deviceRegistry && !this.deps.deviceRegistry.getById(observedDeviceId)) {
      return {
        success: false,
        error: `Confirmation observed device '${observedDeviceId}' not found`,
        lifecycleState: "FAILED",
      };
    }

    // Assign a correlation id for any command that will be tracked, and attach
    // an MQTT envelope only when the device is expected to reply on a response
    // topic (i.e. it declares an acknowledgement capability).
    let correlationId: string | undefined;
    let dispatchAction = action;
    if (tier !== "dispatch") {
      correlationId = randomUUID();
      if (hasAckCapability) {
        const responseTopic =
          ackCapability?.responseTopic ?? `${this.ackResponseTopicBase}/${targetDeviceId}`;
        dispatchAction = { ...action, correlation: { correlationId, responseTopic } };
      }
    }

    // Dispatch — REQUESTED → DISPATCHED | FAILED.
    let dispatchResult: ActionResult | void;
    try {
      dispatchResult = await handler(dispatchAction, ruleId, this.deps);
    } catch (err) {
      const message = (err as Error).message;
      this.deps.logger.error(
        { ruleId, actionType: action.type, target: action.target, error: message },
        `Action execution failed for rule ${ruleId}`,
      );
      this.logTerminal(ruleId, action.target, "FAILED", message);
      return { success: false, error: message, lifecycleState: "FAILED" };
    }

    // A handler that reports an explicit dispatch failure → FAILED.
    if (dispatchResult && dispatchResult.success === false) {
      this.logTerminal(ruleId, action.target, "FAILED", dispatchResult.error);
      return { ...dispatchResult, lifecycleState: "FAILED" };
    }

    const dispatchData = dispatchResult && dispatchResult.success ? dispatchResult.data : undefined;

    // Dispatch-only tier → DISPATCHED is the truthful terminal success (Req 4.8, 9.3, 9.5).
    if (tier === "dispatch" || !this.deps.pendingCommandTracker) {
      this.emitFired(ruleId, action);
      this.logTerminal(ruleId, action.target, "DISPATCHED");
      return {
        success: true,
        ...(dispatchData ? { data: dispatchData } : {}),
        lifecycleState: "DISPATCHED",
        ...(correlationId ? { correlationId } : {}),
      };
    }

    // Register with the tracker and await confirmation (ack and/or observe).
    const timeoutMs = confirm?.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
    const resolution = await this.deps.pendingCommandTracker.register({
      correlationId: correlationId as string,
      targetDeviceId,
      observedDeviceId,
      requiredTier: tier === "acknowledged" ? "acknowledged" : "observed",
      ...(confirm ? { condition: confirm.condition } : {}),
      timeoutMs,
      ...(ackCapability?.ackIndicatorValues ? { ackIndicatorValues: ackCapability.ackIndicatorValues } : {}),
    });

    if (resolution.success) {
      this.emitFired(ruleId, action);
    }
    this.logTerminal(
      ruleId,
      action.target,
      resolution.lifecycleState,
      resolution.error,
      observedDeviceId,
      timeoutMs,
    );

    return {
      success: resolution.success,
      ...(dispatchData ? { data: dispatchData } : {}),
      ...(resolution.error ? { error: resolution.error } : {}),
      lifecycleState: resolution.lifecycleState,
      ...(correlationId ? { correlationId } : {}),
    };
  }

  /** Resolve the acknowledgement capability declared for a device, if any. */
  private resolveAckCapability(deviceId: string) {
    return this.deps.connectorManager.getAcknowledgementCapability?.(deviceId);
  }

  /** Base response-topic space for command acknowledgements. */
  private get ackResponseTopicBase(): string {
    return this.deps.ackResponseTopicBase ?? "aeolus/acks";
  }

  /** Emit the per-action AUTOMATION_FIRED event on a successful outcome. */
  private emitFired(ruleId: string, action: ActionDescriptor): void {
    eventBus.emit(AUTOMATION_FIRED, {
      ruleId,
      actionType: action.type,
      target: action.target,
      timestamp: Date.now(),
    });
  }

  /**
   * Log a command reaching a terminal lifecycle state (Req 8.1), including the
   * observed device and applied timeout for TIMED_OUT / STATE_MISMATCH (Req 8.2).
   */
  private logTerminal(
    ruleId: string,
    target: string,
    lifecycleState: CommandLifecycleState,
    error?: string,
    observedDeviceId?: string,
    timeoutMs?: number,
  ): void {
    const base: Record<string, unknown> = { ruleId, target, lifecycleState };
    if (error) base.error = error;
    if (lifecycleState === "TIMED_OUT" || lifecycleState === "STATE_MISMATCH") {
      base.observedDeviceId = observedDeviceId;
      base.timeoutMs = timeoutMs;
      this.deps.logger.warn(base, `Command ${target} reached ${lifecycleState}`);
      return;
    }
    if (lifecycleState === "FAILED") {
      this.deps.logger.error(base, `Command ${target} reached ${lifecycleState}`);
      return;
    }
    this.deps.logger.debug?.(base, `Command ${target} reached ${lifecycleState}`);
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
  const toggleAction = {
    type: "toggle",
    deviceId: action.target,
    params: action.params,
  };
  return action.correlation
    ? deps.connectorManager.executeAction(action.target, toggleAction, action.correlation)
    : deps.connectorManager.executeAction(action.target, toggleAction);
};

/** Execute an arbitrary device action via the connector manager. */
export const handleDeviceAction: ActionHandler = async (action, _ruleId, deps) => {
  const actionType = typeof action.params.actionType === "string"
    ? action.params.actionType
    : "unknown";
  const deviceAction = {
    type: actionType,
    deviceId: action.target,
    params: action.params,
  };
  return action.correlation
    ? deps.connectorManager.executeAction(action.target, deviceAction, action.correlation)
    : deps.connectorManager.executeAction(action.target, deviceAction);
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
export const handleWebhook: ActionHandler = async (action, _ruleId, _deps) => {
  const method = typeof action.params.method === "string" ? action.params.method : "POST";
  const headers = (action.params.headers as Record<string, string>) ?? {};
  const body = action.params.body !== undefined ? String(action.params.body) : undefined;

  const response = await fetch(action.target, { method, headers, body });
  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status} ${response.statusText}`);
  }
};
