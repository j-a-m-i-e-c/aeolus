// src/automations/command-service.ts — The single physical-command boundary
// Every Command_Source routes physical device
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
import {
  buildCommandEvidence,
  describeRung,
  selectRequiredTier,
  type CommandEvidence,
  type ConfirmationTier,
} from "./command-lifecycle.js";
import type { PendingCommandTracker } from "./pending-command-tracker.js";
import type { AutomationScopeResolver } from "./automation-scope-resolver.js";
import type {
  CommandHistoryStore,
  CommandRecord,
  CommandFailureReason,
} from "./command-history-store.js";
import { requestPublicHttp } from "../security/outbound-http.js";

/**
 * Narrow, read-only view of the active automation execution context
 * (phase-1-runtime-foundations, design §2.3).
 *
 * `CommandService` consumes this to stamp a command with its originating
 * execution/causation without becoming coupled to the automation runtime.
 * Backed at composition by the `CommandResultCollector` AsyncLocalStorage.
 * Commands issued outside an automation see `undefined` and carry no context.
 */
export interface ExecutionContextProvider {
  current(): { executionId?: string; causationId?: string; automationId?: string } | undefined;
}

// ── Explicit command source model (pre-promotion-release-gates Req 1) ────────

/**
 * Discriminated union identifying the origin of a physical device command.
 * The `AutomationScopeResolver` is applied only when `kind === "automation"`.
 *
 * - `automation` — an automation rule is dispatching (carries the authoring rule id)
 * - `rest` — a REST device-action request (already resource-authorized at the route)
 * - `system` — an internal/system-originated command
 */
export type CommandSource =
  | { kind: "automation"; ruleId: string }
  | { kind: "rest"; label?: string }
  | { kind: "system"; label: string };

/** Create an automation command source carrying the authoring rule id. */
export const automationSource = (ruleId: string): CommandSource => ({ kind: "automation", ruleId });
/** Create a REST command source (resource authorization already occurred at the route boundary). */
export const restSource = (label?: string): CommandSource => ({ kind: "rest", label });
/** Create a system/internal command source. */
export const systemSource = (label: string): CommandSource => ({ kind: "system", label });

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
  /**
   * Resolves the authoring automation's authorization scope by rule id. When
   * present, a scoped automation may only act on devices its owning tab exposes
   * and may not publish raw MQTT or invoke webhooks. When absent (e.g. a
   * non-automation Command_Source), no scope restriction is applied.
   */
  scopeResolver?: AutomationScopeResolver;
  /**
   * Durable command-history sink (phase-1). When present, every Verified
   * Physical Command creates a `REQUESTED` record and records its lifecycle
   * transitions. Absent ⇒ commands still receive a `commandId` but no durable
   * history is written (e.g. lightweight unit tests).
   */
  commandHistoryStore?: CommandHistoryStore;
  /**
   * Read-only provider of the active automation execution context (phase-1).
   * When present, a command issued inside an automation execution is stamped
   * with its `executionId`/`causationId`. Absent ⇒ no execution linkage.
   */
  executionContext?: ExecutionContextProvider;
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
 * never thrown, and exactly one completion {@link ActionResult} is returned for the selected tier.
 *
 * This service records nothing about automation executions and does NOT emit
 * AUTOMATION_FIRED — the AutomationEngine is the sole emitter of that started
 * signal (Req 6.3, 8.5).
 */
export class CommandService {
  private handlers = new Map<string, ActionHandler>();
  /**
   * Action types classified as Verified Physical Commands (phase-1). Only these
   * receive a `commandId` and durable history; raw `publish`/`log`/`delay`/
   * `webhook` never do (Req 1.9). Built-in `toggle`/`device_action` default to
   * physical; connector-contributed device handlers register with
   * `{ physical: true }`. The default keeps existing call sites unchanged.
   */
  private physicalActionTypes = new Set<string>();
  private deps: CommandServiceDeps;

  constructor(deps: CommandServiceDeps) {
    this.deps = deps;
  }

  /**
   * Register a handler for an action type. Overwrites if already registered.
   *
   * `options.physical` marks the type as a Verified Physical Command; when
   * omitted it defaults to `true` for the built-in `toggle`/`device_action`
   * types and `false` otherwise, so connectors contributing device actions pass
   * `{ physical: true }` explicitly.
   */
  registerHandler(type: string, handler: ActionHandler, options?: { physical?: boolean }): void {
    this.handlers.set(type, handler);
    const physical = options?.physical ?? (type === "toggle" || type === "device_action");
    if (physical) this.physicalActionTypes.add(type);
    else this.physicalActionTypes.delete(type);
  }

  /** Unregister a handler for an action type. No-op if not registered. */
  unregisterHandler(type: string): void {
    this.handlers.delete(type);
    this.physicalActionTypes.delete(type);
  }

  /**
   * True when `type` is a Verified Physical Command (device action), so it
   * warrants a `commandId` and durable command history. Raw messaging actions
   * (publish/log/delay/webhook) are never verified physical commands (Req 1.9).
   */
  private isVerifiedPhysicalAction(type: string): boolean {
    return this.physicalActionTypes.has(type);
  }

  /**
   * Process exactly one physical device command through the identical
   * dispatch-and-confirmation path regardless of Command_Source (Req 1.2, 2.10).
   *
   * Never throws; always returns one Command_Result carrying the lifecycle state
   * that satisfied (or failed) the selected completion tier (Req 1.3, 1.7):
   *   - dispatch-only commands resolve synchronously (REQUESTED → DISPATCHED | FAILED)
   *   - commands with an acknowledgement capability and/or Confirmation_Options
   *     register with the {@link PendingCommandTracker} and await the configured
   *     completion resolution (ACKNOWLEDGED / OBSERVED / TIMED_OUT / STATE_MISMATCH / FAILED)
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
    source: CommandSource | string,
    confirm?: ConfirmOptions,
    requiredTier?: ConfirmationTier,
  ): Promise<ActionResult> {
    // Coerce a bare string to an automation source so existing automation call
    // sites (sandbox host callbacks, form-rule closures, executeSequence) work
    // without edits. This is NOT string-pattern inference (Req 1.5, 1.7).
    const src: CommandSource = typeof source === "string" ? automationSource(source) : source;
    const logId = src.kind === "automation" ? src.ruleId : (src.label ?? src.kind);

    // ── Pre-acceptance checks (no commandId, no record — locked decision 1) ──
    // A handler-resolution or scope/authorization refusal is a request-level
    // failure that happens BEFORE the command is accepted into the pipeline, so
    // it never receives a commandId or a durable record (design §2.1).
    const handler = this.handlers.get(action.type);
    if (!handler) {
      this.deps.logger.warn(
        { ruleId: logId, actionType: action.type },
        `No handler for action type: ${action.type}`,
      );
      return {
        success: false,
        error: `No handler for action type: '${action.type}'`,
        lifecycleState: "FAILED",
        failureKind: "unsupported",
      };
    }

    // Authorization scope gate. Applied ONLY to automation sources (Req 1.2, 1.3).
    // A Rest_Source or System_Source is already resource-authorized at the route
    // boundary and is never treated as an unknown automation (Req 1.4).
    const scopeRefusal = this.checkScope(action, src);
    if (scopeRefusal) {
      return scopeRefusal;
    }

    // ── Accepted into the command pipeline ──────────────────────────────────
    // Only a Verified Physical Command (device action) receives a commandId and
    // durable history; raw publish/webhook/log/delay never do (Req 1.9, locked
    // decision 2). The commandId is allocated for physical actions regardless of
    // whether a history store is present, so every physical result carries one.
    const physical = this.isVerifiedPhysicalAction(action.type);
    const store = physical ? this.deps.commandHistoryStore : undefined;
    const commandId = physical ? randomUUID() : undefined;
    const withId = (result: ActionResult): ActionResult =>
      commandId ? { ...result, commandId } : result;

    // Record a lifecycle transition when history is active. Never throws into
    // the physical path: a post-dispatch persistence failure is logged, never
    // repaired by re-dispatching (design §8).
    const recordTransition = (
      toState: CommandLifecycleState,
      terminal: boolean,
      extra?: { success?: boolean; failureKind?: CommandFailureReason; error?: string },
      evidence?: CommandEvidence,
    ): void => {
      if (!store || !commandId) return;
      try {
        // Every rung carries its own account. Absent an explicit one, the standing
        // description for the state is used, so no transition lands unexplained.
        const details =
          evidence ?? buildCommandEvidence({ reason: describeRung(toState, extra?.error) });
        store.transition({
          commandId,
          toState,
          timestamp: Date.now(),
          terminal,
          ...extra,
          ...(details ? { details } : {}),
        });
      } catch (err) {
        this.deps.logger.error(
          { commandId, toState, error: (err as Error).message },
          "Failed to persist command transition; retaining truthful in-memory outcome",
        );
      }
    };

    const targetDeviceId = action.target;
    const ackCapability = this.resolveAckCapability(targetDeviceId);
    const hasAckCapability = ackCapability?.supported === true;
    const hasConfirm = confirm !== undefined;

    // The highest tier this command can prove given its inputs — the capability
    // ceiling. `observed` requires Confirmation_Options; `acknowledged` requires
    // a declared acknowledgement capability; `dispatch` is always provable.
    // Resolved BEFORE the first durable write (side-effect free) so the REQUESTED
    // record is complete on first insert (refinement A / Req 3.2).
    const ceiling = selectRequiredTier(hasConfirm, hasAckCapability);
    const tier = this.resolveEffectiveTier(
      requiredTier,
      ceiling,
      hasConfirm,
      hasAckCapability,
      logId,
      targetDeviceId,
    );

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

    // Create the durable REQUESTED record, complete on first insert. If the
    // audit contract cannot be established BEFORE dispatch, do not dispatch —
    // returning FAILED is safer than a physical action with no record (§8).
    if (store && commandId) {
      const ctx = this.deps.executionContext?.current();
      const record: CommandRecord = {
        commandId,
        ...(correlationId ? { correlationId } : {}),
        sourceKind: src.kind,
        ...(src.kind === "automation"
          ? { ruleId: src.ruleId, sourceId: src.ruleId }
          : src.label
            ? { sourceId: src.label }
            : {}),
        ...(ctx?.executionId ? { executionId: ctx.executionId } : {}),
        ...(ctx?.causationId ? { causationId: ctx.causationId } : {}),
        targetDeviceId,
        actionType: action.type,
        ...(requiredTier ? { requestedTier: requiredTier } : {}),
        effectiveTier: tier,
        lifecycleState: "REQUESTED",
        requestedAt: Date.now(),
      };
      // The opening rung states the contract: what this command must prove, on
      // which device, and within how long. Recorded before dispatch so the
      // standard is on record independently of whether it was met.
      const observed = confirm?.deviceId ?? targetDeviceId;
      const requestedEvidence = buildCommandEvidence({
        tier,
        ...(observed !== targetDeviceId ? { observedDeviceId: observed } : {}),
        ...(confirm?.conditionSpec ? { condition: confirm.conditionSpec } : {}),
        ...(tier !== "dispatch"
          ? { timeoutMs: confirm?.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS }
          : {}),
        reason: describeRung("REQUESTED"),
      });
      try {
        store.create(record, requestedEvidence);
      } catch (err) {
        this.deps.logger.error(
          { commandId, error: (err as Error).message },
          "Failed to create command record before dispatch; refusing command",
        );
        return withId({
          success: false,
          error: "Command history unavailable; command refused before dispatch",
          lifecycleState: "FAILED",
          failureKind: "execution",
        });
      }
    }

    // Validate the observed device exists before dispatching (Req 5.5). Only
    // meaningful when we will actually observe (tier === "observed"). This is a
    // post-acceptance failure, so it is recorded as REQUESTED -> FAILED.
    const observedDeviceId = confirm?.deviceId ?? targetDeviceId;
    if (
      tier === "observed" &&
      this.deps.deviceRegistry &&
      !this.deps.deviceRegistry.getById(observedDeviceId)
    ) {
      recordTransition(
        "FAILED",
        true,
        {
          success: false,
          failureKind: "not_found",
          error: `Confirmation observed device '${observedDeviceId}' not found`,
        },
        buildCommandEvidence({
          observedDeviceId,
          reason: `Nothing could confirm this command: observed device '${observedDeviceId}' is not present`,
        }),
      );
      return withId({
        success: false,
        error: `Confirmation observed device '${observedDeviceId}' not found`,
        lifecycleState: "FAILED",
        failureKind: "not_found",
      });
    }

    // Dispatch-only path (no tracker involvement) — dispatch, then DISPATCHED
    // completion success. This path is unchanged by the register-before-dispatch
    // reordering (Req 12.6).
    if (tier === "dispatch" || !this.deps.pendingCommandTracker) {
      let dispatchResult: ActionResult | void;
      try {
        dispatchResult = await handler(dispatchAction, logId, this.deps);
      } catch (err) {
        const message = (err as Error).message;
        this.deps.logger.error(
          { ruleId: logId, actionType: action.type, target: action.target, error: message },
          `Action execution failed for rule ${logId}`,
        );
        recordTransition("FAILED", true, { success: false, failureKind: "execution", error: message });
        this.logCompletion(logId, action.target, "FAILED", message);
        return withId({ success: false, error: message, lifecycleState: "FAILED" });
      }

      // A handler that reports an explicit dispatch failure → FAILED.
      if (dispatchResult && dispatchResult.success === false) {
        recordTransition("FAILED", true, {
          success: false,
          ...(dispatchResult.failureKind ? { failureKind: dispatchResult.failureKind } : {}),
          ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
        });
        this.logCompletion(logId, action.target, "FAILED", dispatchResult.error);
        return withId({ ...dispatchResult, lifecycleState: "FAILED" });
      }

      const dispatchData = dispatchResult && dispatchResult.success ? dispatchResult.data : undefined;

      // Dispatch-only tier → DISPATCHED is the truthful completion success. The
      // historical `terminal_at` column marks that this command call is complete;
      // DISPATCHED itself is not a lifecycle-final state.
      recordTransition("DISPATCHED", true, { success: true });
      this.logCompletion(logId, action.target, "DISPATCHED");
      return withId({
        success: true,
        ...(dispatchData ? { data: dispatchData } : {}),
        lifecycleState: "DISPATCHED",
        ...(correlationId ? { correlationId } : {}),
      });
    }

    // Tracked path — register BEFORE dispatch so a fast device reply arriving
    // during the connector publish/await is matched to its command rather than
    // dropped as an unknown correlation id (Req 12.1, 12.3). register()
    // synchronously inserts the pending entry and arms the timeout timer.
    const timeoutMs = confirm?.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
    const resolutionPromise = this.deps.pendingCommandTracker.register({
      ...(commandId ? { commandId } : {}),
      correlationId: correlationId as string,
      targetDeviceId,
      observedDeviceId,
      requiredTier: tier === "acknowledged" ? "acknowledged" : "observed",
      ...(confirm ? { condition: confirm.condition } : {}),
      timeoutMs,
      ...(ackCapability?.ackIndicatorField ? { ackIndicatorField: ackCapability.ackIndicatorField } : {}),
      ...(ackCapability?.ackIndicatorValues ? { ackIndicatorValues: ackCapability.ackIndicatorValues } : {}),
    });

    // Dispatch — REQUESTED → DISPATCHED | FAILED. On any dispatch failure we
    // cancel the pending command (which settles resolutionPromise) and return
    // FAILED without awaiting it (Req 12.2). The tracker's register() promise
    // never rejects, so the un-awaited resolved promise cannot leak.
    let dispatchResult: ActionResult | void;
    try {
      dispatchResult = await handler(dispatchAction, logId, this.deps);
    } catch (err) {
      this.deps.pendingCommandTracker.cancel(correlationId as string);
      const message = (err as Error).message;
      this.deps.logger.error(
        { ruleId: logId, actionType: action.type, target: action.target, error: message },
        `Action execution failed for rule ${logId}`,
      );
      recordTransition("FAILED", true, { success: false, failureKind: "execution", error: message });
      this.logCompletion(logId, action.target, "FAILED", message);
      return withId({ success: false, error: message, lifecycleState: "FAILED" });
    }

    // A handler that reports an explicit dispatch failure → FAILED.
    if (dispatchResult && dispatchResult.success === false) {
      this.deps.pendingCommandTracker.cancel(correlationId as string);
      recordTransition("FAILED", true, {
        success: false,
        ...(dispatchResult.failureKind ? { failureKind: dispatchResult.failureKind } : {}),
        ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
      });
      this.logCompletion(logId, action.target, "FAILED", dispatchResult.error);
      return withId({ ...dispatchResult, lifecycleState: "FAILED" });
    }

    const dispatchData = dispatchResult && dispatchResult.success ? dispatchResult.data : undefined;

    // Dispatch accepted → DISPATCHED (non-terminal for a tracked command).
    // `success` is deliberately left UNSET here: the command has not terminated
    // (terminal_at is still null), so recording success=true would let a Phase 4
    // UI read an in-flight command as already succeeded. Success is stamped only
    // by the completion transition below. The intermediate ACKNOWLEDGED (when
    // waiting for OBSERVED) is recorded by the tracker's transition hook; store
    // idempotency dedupes overlap.
    recordTransition("DISPATCHED", false);

    // Await the configured completion resolution (ack and/or observe). A fast ack may have
    // already resolved this promise during dispatch above.
    const resolution = await resolutionPromise;

    // A failed wait restates what went unmet — the condition, the device that was
    // watched and the window it had — because that is the whole content of the
    // failure. A satisfied wait needs only to say so.
    const unmet = resolution.lifecycleState === "TIMED_OUT" || resolution.lifecycleState === "STATE_MISMATCH";
    recordTransition(
      resolution.lifecycleState,
      true,
      {
        success: resolution.success,
        ...(resolution.error ? { error: resolution.error } : {}),
      },
      buildCommandEvidence({
        tier,
        ...(unmet
          ? {
              observedDeviceId,
              ...(confirm?.conditionSpec ? { condition: confirm.conditionSpec } : {}),
              timeoutMs,
            }
          : {}),
        reason: describeRung(resolution.lifecycleState, resolution.error),
      }),
    );

    this.logCompletion(
      logId,
      action.target,
      resolution.lifecycleState,
      resolution.error,
      observedDeviceId,
      timeoutMs,
    );

    return withId({
      success: resolution.success,
      ...(dispatchData ? { data: dispatchData } : {}),
      ...(resolution.error ? { error: resolution.error } : {}),
      lifecycleState: resolution.lifecycleState,
      ...(correlationId ? { correlationId } : {}),
    });
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

  /**
   * Refuse a dispatch that falls outside the authoring automation's scope, or
   * return `null` to allow it.
   *
   * Applied ONLY when the source is an automation (Req 1.2, 1.3). Non-automation
   * sources (rest, system) are never scope-checked — they are already authorized
   * at the route boundary or internally trusted.
   *
   * A scoped automation may act only on devices in its owning tab's device set
   * and may never publish raw MQTT or invoke a webhook. A refusal is terminal
   * (FAILED) and never dispatches or registers a pending command.
   */
  private checkScope(action: ActionDescriptor, source: CommandSource): ActionResult | null {
    // Req 1.3: non-automation sources bypass the scope resolver entirely.
    if (source.kind !== "automation") {
      return null;
    }
    if (!this.deps.scopeResolver) {
      return null;
    }
    const ruleId = source.ruleId;
    const scope = this.deps.scopeResolver.resolve(ruleId);
    if (scope.kind === "unrestricted") {
      return null;
    }

    // Raw MQTT publish and webhooks have no per-tab ownership model, so a scoped
    // automation is never permitted to use them.
    if (action.type === "publish" || action.type === "webhook") {
      this.deps.logger.warn(
        { ruleId, actionType: action.type },
        `Scoped automation ${ruleId} refused: ${action.type} is not permitted for scoped automations`,
      );
      return {
        success: false,
        error: `Action '${action.type}' is not permitted for a scoped automation`,
        lifecycleState: "FAILED",
        failureKind: "unauthorized",
      };
    }

    // Device-directed actions must target a device the owning tab exposes.
    if (action.type === "device_action" || action.type === "toggle") {
      if (!scope.deviceIds.has(action.target)) {
        this.deps.logger.warn(
          { ruleId, target: action.target },
          `Scoped automation ${ruleId} refused: device '${action.target}' is outside its authorization scope`,
        );
        return {
          success: false,
          error: `Device '${action.target}' is outside this automation's authorization scope`,
          lifecycleState: "FAILED",
          failureKind: "unauthorized",
        };
      }
    }

    return null;
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
   * Log the state that completed this command call (Req 8.1), including the
   * observed device and applied timeout for TIMED_OUT / STATE_MISMATCH (Req 8.2).
   * A successful DISPATCHED/ACKNOWLEDGED completion is not described as
   * lifecycle-final; it is simply the evidence tier this caller waited for.
   */
  private logCompletion(
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

/**
 * Send a generic automation webhook through the same public-outbound policy used
 * by authored `http.*`. Connector networking is intentionally separate because
 * a configured connector may legitimately talk to a LAN device.
 */
export const handleWebhook: ActionHandler = async (action, _ruleId, _deps) => {
  const method = typeof action.params.method === "string" ? action.params.method.toUpperCase() : "POST";
  const headers = (action.params.headers as Record<string, string>) ?? {};
  const body = action.params.body !== undefined ? String(action.params.body) : undefined;

  const response = await requestPublicHttp(action.target, { method, headers, body });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook returned ${response.status} ${response.statusText}`.trim());
  }
};
