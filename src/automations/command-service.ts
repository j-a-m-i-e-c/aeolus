// src/automations/command-service.ts — The single physical-command boundary
// (formerly ActionExecutor). Every Command_Source routes physical device
// commands through this service so correlation, dispatch, acknowledgement, and
// observation are applied identically regardless of origin.
//
// ARCHITECTURE NOTE (unified-command-boundary, Req 1.1 / 2.7 / 2.8):
// `connectorManager.executeAction(` MUST appear only inside this module's
// built-in handlers (handleToggle / handleDeviceAction). No Command_Source is
// handed a ConnectorManager reference; the composition root grants it to the
// CommandServiceDeps object alone, so an unverified command cannot reach the
// ConnectorManager by construction.

import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { ConnectorManager } from "../connectors/connector-manager.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { ActionResult, CommandLifecycleState, ConfirmOptions } from "../core/types.js";
import { DEFAULT_CONFIRM_TIMEOUT_MS } from "../core/types.js";
import { selectRequiredTier, type ConfirmationTier } from "./command-lifecycle.js";
import type { PendingCommandTracker } from "./pending-command-tracker.js";

/** Correlation fields attached to a command envelope for MQTT-correlating dispatch. */
export interface CommandCorrelation {
  correlationId: string;
  responseTopic: string;
}

/** Descriptor for a single physical device command to be dispatched. */
export interface ActionDescriptor {
  type: string;
  target: string;
  params: Record<string, unknown>;
  /**
   * Correlation envelope fields, assigned by the CommandService before dispatch
   * for commands that expect a device reply. Forwarded to the connector/MQTT
   * layer so the published command carries MQTT 5 Correlation Data / Response
   * Topic. Absent for dispatch-only commands.
   */
  correlation?: CommandCorrelation;
}

/** Dependencies injected into the CommandService. */
export interface CommandServiceDeps {
  mqttService: MqttService;
  /** The ONLY holder of this reference outside ConnectorManager itself. */
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
  deps: CommandServiceDeps,
) => void | ActionResult | Promise<void | ActionResult>;

/**
 * The single physical-command boundary through which every Command_Source
 * (script rule, form rule, REST device-action, dashboard control, custom-UI
 * control, CLI/fleet) dispatches a physical device command.
 *
 * Every command flows through the identical dispatch-and-confirmation pipeline;
 * each command is wrapped in try/catch, errors are logged with the rule ID and
 * never thrown, and exactly one terminal {@link ActionResult} is returned.
 *
 * This service records nothing about automation executions and does NOT emit
 * AUTOMATION_FIRED — the AutomationEngine is the sole emitter of that started
 * signal (Req 6.3, 8.5).
 */
export class CommandService {
  private handlers = new Map<string, ActionHandler>();
  private deps: CommandServiceDeps;

  constructor(deps: CommandServiceDeps) {
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
   * Process exactly one physical device command through the identical
   * dispatch-and-confirmation path regardless of Command_Source (Req 1.2, 2.10).
   *
   * Never throws; always returns one Command_Result carrying a terminal
   * {@link CommandLifecycleState} (Req 1.3, 1.7):
   *   - dispatch-only commands resolve synchronously (REQUESTED → DISPATCHED | FAILED)
   *   - commands with an acknowledgement capability and/or Confirmation_Options
   *     register with the {@link PendingCommandTracker} and await the terminal
   *     resolution (ACKNOWLEDGED / OBSERVED / TIMED_OUT / STATE_MISMATCH / FAILED)
   *
   * @param requiredTier optional explicit tier ceiling requested by the author.
   *   When omitted, the service auto-selects the highest available tier. When
   *   supplied it is validated against the device capability ceiling (`observed`
   *   needs Confirmation_Options; `acknowledged` needs a declared acknowledgement
   *   capability); an over-request is clamped down to the highest provable tier
   *   and the clamp is logged, so the returned lifecycleState is always one that
   *   was actually reached — never an aspirational one.
   *
   * Requirements: 1.5, 4.2–4.9, 5.1–5.9, 6.1, 9.6, 10.2–10.4
   */
  async execute(
    action: ActionDescriptor,
    ruleId: string,
    confirm?: ConfirmOptions,
    requiredTier?: ConfirmationTier,
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

    // The highest tier this command can prove given its inputs — the capability
    // ceiling. `observed` requires Confirmation_Options; `acknowledged` requires
    // a declared acknowledgement capability; `dispatch` is always provable.
    const ceiling = selectRequiredTier(hasConfirm, hasAckCapability);
    const tier = this.resolveEffectiveTier(
      requiredTier,
      ceiling,
      hasConfirm,
      hasAckCapability,
      ruleId,
      targetDeviceId,
    );

    // Validate the observed device exists before dispatching (Req 5.5). Only
    // meaningful when we will actually observe (tier === "observed").
    const observedDeviceId = confirm?.deviceId ?? targetDeviceId;
    if (
      tier === "observed" &&
      this.deps.deviceRegistry &&
      !this.deps.deviceRegistry.getById(observedDeviceId)
    ) {
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

    // Dispatch-only path (no tracker involvement) — dispatch, then DISPATCHED
    // terminal success. This path is unchanged by the register-before-dispatch
    // reordering (Req 12.6).
    if (tier === "dispatch" || !this.deps.pendingCommandTracker) {
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
      this.logTerminal(ruleId, action.target, "DISPATCHED");
      return {
        success: true,
        ...(dispatchData ? { data: dispatchData } : {}),
        lifecycleState: "DISPATCHED",
        ...(correlationId ? { correlationId } : {}),
      };
    }

    // Tracked path — register BEFORE dispatch so a fast device reply arriving
    // during the connector publish/await is matched to its command rather than
    // dropped as an unknown correlation id (Req 12.1, 12.3). register()
    // synchronously inserts the pending entry and arms the timeout timer.
    const timeoutMs = confirm?.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
    const resolutionPromise = this.deps.pendingCommandTracker.register({
      correlationId: correlationId as string,
      targetDeviceId,
      observedDeviceId,
      requiredTier: tier === "acknowledged" ? "acknowledged" : "observed",
      ...(confirm ? { condition: confirm.condition } : {}),
      timeoutMs,
      ...(ackCapability?.ackIndicatorValues ? { ackIndicatorValues: ackCapability.ackIndicatorValues } : {}),
    });

    // Dispatch — REQUESTED → DISPATCHED | FAILED. On any dispatch failure we
    // cancel the pending command (which settles resolutionPromise) and return
    // FAILED without awaiting it (Req 12.2). The tracker's register() promise
    // never rejects, so the un-awaited resolved promise cannot leak.
    let dispatchResult: ActionResult | void;
    try {
      dispatchResult = await handler(dispatchAction, ruleId, this.deps);
    } catch (err) {
      this.deps.pendingCommandTracker.cancel(correlationId as string);
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
      this.deps.pendingCommandTracker.cancel(correlationId as string);
      this.logTerminal(ruleId, action.target, "FAILED", dispatchResult.error);
      return { ...dispatchResult, lifecycleState: "FAILED" };
    }

    const dispatchData = dispatchResult && dispatchResult.success ? dispatchResult.data : undefined;

    // Dispatch accepted — await the terminal resolution (ack and/or observe).
    // A fast ack may have already resolved this promise during dispatch above.
    const resolution = await resolutionPromise;

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

  /**
   * Resolve the effective confirmation tier from an optional explicit request,
   * validated and clamped against the device's capability ceiling.
   *
   * A requested tier that the device can prove is honoured (allowing an author
   * to require a *lower* tier than the maximum). A requested tier that exceeds
   * what the device can prove is an over-request and is clamped down to the
   * highest provable tier, with the clamp logged — so the command never reports
   * a lifecycleState it could not actually reach.
   */
  private resolveEffectiveTier(
    requiredTier: ConfirmationTier | undefined,
    ceiling: ConfirmationTier,
    hasConfirm: boolean,
    hasAckCapability: boolean,
    ruleId: string,
    target: string,
  ): ConfirmationTier {
    if (requiredTier === undefined) return ceiling;

    const provable =
      requiredTier === "dispatch" ||
      (requiredTier === "acknowledged" && hasAckCapability) ||
      (requiredTier === "observed" && hasConfirm);

    if (provable) return requiredTier;

    // Over-request: the device cannot prove the requested tier. Clamp down to
    // the highest provable tier and log the downgrade (Req 1.5).
    this.deps.logger.warn(
      { ruleId, target, requiredTier, clampedTo: ceiling },
      `Requested completion tier '${requiredTier}' exceeds device capability; clamping to '${ceiling}'`,
    );
    return ceiling;
  }

  /** Resolve the acknowledgement capability declared for a device, if any. */
  private resolveAckCapability(deviceId: string) {
    return this.deps.connectorManager.getAcknowledgementCapability?.(deviceId);
  }

  /** Base response-topic space for command acknowledgements. */
  private get ackResponseTopicBase(): string {
    return this.deps.ackResponseTopicBase ?? "aeolus/acks";
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
