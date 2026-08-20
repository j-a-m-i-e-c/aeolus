// src/automations/automation-engine.ts — Rule evaluation engine

import type { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  DEVICE_STATE_CHANGE,
  AUTOMATION_FIRED,
  AUTOMATION_RULE_REGISTERED,
  AUTOMATION_RULE_UNREGISTERED,
  AUTOMATION_EVENT,
} from "../core/event-bus.js";
import type { NormalizedEvent, EventContext, Rule } from "../core/types.js";
import type { AutomationEventEnvelopeV1 } from "./automation-event-service.js";
import type { Sandbox, SandboxContext } from "./sandbox.js";
import type { CommandService } from "./command-service.js";
import type { AutomationScopeResolver } from "./automation-scope-resolver.js";
import type { ExecutionLog } from "./execution-log.js";
import { ExecutionRecorder, type ExecutionRecordRule } from "./execution-recorder.js";
import { CommandResultCollector } from "./command-result-collector.js";
import { runInExecutionContext } from "./execution-context.js";
import { assembleExecutionResult, type LogicOutcome } from "./execution-result.js";
import type { AutomationExecutionResult, CommandResult } from "./execution-types.js";
import { RuleRegistry } from "./rule-registry.js";
import { CronTimerManager } from "./cron-timer-manager.js";
import { ExecutionGate, type GateConfig } from "./execution-gate.js";
import logger from "../logger.js";

/** Optional dependencies for script/form rule execution (unified-command-boundary Req 4–8). */
export interface AutomationEngineDeps {
  sandbox?: Sandbox;
  /** The single physical-command boundary (renamed from ActionExecutor, Req 1.6). */
  commandService?: CommandService;
  /**
   * Resolves an automation's authoring scope so device-event triggers can be
   * admitted scope-aware. When present, a scoped automation is only triggered by
   * (and only receives the state of) device events for devices its owning tab
   * exposes; an unrestricted automation is triggered by any matching event. When
   * absent, no admission filtering is applied (legacy/test wiring).
   */
  scopeResolver?: AutomationScopeResolver;
  /** The single Execution_Owner that records history/metrics/completion/audit (Req 8). */
  executionRecorder?: ExecutionRecorder;
  /** Per-execution Command_Result sink, keyed by executionId (Req 4.3, 5.1, 5.3). */
  collector?: CommandResultCollector;
  /**
   * @deprecated Legacy convenience. When `executionRecorder` is not supplied but
   * `executionLog` is, the engine builds a default {@link ExecutionRecorder}
   * around it so existing wiring keeps working. Composition (task 6.7) passes an
   * explicit `executionRecorder` instead.
   */
  executionLog?: ExecutionLog;
  /** Concurrency gate configuration. Partial — omitted fields use defaults. */
  gateConfig?: Partial<GateConfig>;
}

/** Runtime guard: is the value a Command_Result (has a boolean `success`)? */
function isCommandResult(value: unknown): value is CommandResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { success?: unknown }).success === "boolean"
  );
}

export class AutomationEngine {
  private registry: RuleRegistry;
  private eventBus: EventEmitter;
  private sandbox?: Sandbox;
  private commandService?: CommandService;
  private scopeResolver?: AutomationScopeResolver;
  private executionRecorder?: ExecutionRecorder;
  private collector: CommandResultCollector;
  private cronTimerManager: CronTimerManager;
  private gate: ExecutionGate;

  constructor(eventBus: EventEmitter, deps?: AutomationEngineDeps) {
    this.registry = new RuleRegistry();
    this.eventBus = eventBus;
    this.sandbox = deps?.sandbox;
    this.commandService = deps?.commandService;
    this.scopeResolver = deps?.scopeResolver;
    this.collector = deps?.collector ?? new CommandResultCollector();

    if (deps?.executionRecorder) {
      this.executionRecorder = deps.executionRecorder;
    } else if (deps?.executionLog) {
      // Legacy path — build a default Execution_Owner around the provided log.
      this.executionRecorder = new ExecutionRecorder({
        eventBus,
        executionLog: deps.executionLog,
        logger,
      });
    }

    this.gate = new ExecutionGate(deps?.gateConfig, {
      onDrop: (ruleId, deviceId, topic) => {
        logger.warn({ ruleId, deviceId, topic }, "Execution gate: request dropped (queue full)");
      },
      onSuppress: (ruleId, deviceId, topic) => {
        logger.debug({ ruleId, deviceId, topic }, "Execution gate: request suppressed (duplicate)");
      },
    });

    this.cronTimerManager = new CronTimerManager();
    this.eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
      this.evaluate(event);
    });
    // Automation Events are domain messages, not device state — they trigger
    // topic-matching rules WITHOUT the device-scope admission gate (Req 6.10,
    // 6.11), and never carry a hidden device id.
    this.eventBus.on(AUTOMATION_EVENT, (event: { topic: string; envelope: AutomationEventEnvelopeV1 }) => {
      this.evaluateAutomationEvent(event.topic, event.envelope);
    });
  }

  /** Register a rule */
  register(rule: Rule): void {
    this.registry.register(rule);

    // Emit rule registered event for MetricsService
    this.eventBus.emit(AUTOMATION_RULE_REGISTERED, { ruleId: rule.id, ruleName: rule.name || "Unnamed Rule" });

    // If this is a cron-triggered rule, start a timer
    if (rule.triggerType === "cron" && rule.cronExpression) {
      const started = this.cronTimerManager.start(rule.id, rule.cronExpression, () => {
        const context: EventContext = {
          topic: `cron/${rule.name || rule.id}`,
          deviceId: rule.id,
          state: { ruleId: rule.id, cronExpression: rule.cronExpression, firedAt: Date.now() },
          timestamp: Date.now(),
        };
        const result = this.gate.submit({
          ruleId: rule.id,
          deviceId: context.deviceId,
          topic: context.topic,
          execute: () => this.executeRule(rule, context),
        });
        if (result.status === "dropped" || result.status === "suppressed") {
          logger.debug({ ruleId: rule.id, status: result.status }, "Execution gate: rule not admitted");
        }
      });
      if (started) {
        logger.debug({ ruleId: rule.id, cronExpression: rule.cronExpression }, "Cron timer started for rule");
      }
    }

    logger.debug({ ruleId: rule.id, topic: rule.topic, name: rule.name }, "Rule registered");
  }

  /** Remove a rule */
  unregister(ruleId: string): void {
    this.cronTimerManager.stop(ruleId);
    this.registry.unregister(ruleId);
    this.eventBus.emit(AUTOMATION_RULE_UNREGISTERED, { ruleId });
  }

  /** List all rules */
  listRules(): Rule[] {
    return this.registry.listRules();
  }

  /** Get a rule by ID */
  getRule(id: string): Rule | undefined {
    return this.registry.getRule(id);
  }

  /**
   * Manually fire a rule by ID, resolving with the eventual
   * {@link AutomationExecutionResult} once the execution reaches an outcome
   * (Req 7.1). Routes script rules through the sandbox.
   *
   * The request still goes through the execution gate for resource protection.
   * If the gate drops or suppresses the request, a failure result is returned
   * immediately rather than throwing.
   */
  async fire(ruleId: string, context: EventContext): Promise<AutomationExecutionResult> {
    const rule = this.registry.getRule(ruleId);
    if (!rule) throw new Error(`Rule ${ruleId} not found`);

    // Use a deferred so we can await the thunk's result regardless of whether
    // the gate admits immediately or promotes from queue later.
    let resolve!: (result: AutomationExecutionResult) => void;
    const resultPromise = new Promise<AutomationExecutionResult>((r) => { resolve = r; });

    const gateResult = this.gate.submit({
      ruleId: rule.id,
      deviceId: context.deviceId,
      topic: context.topic,
      execute: async () => {
        const result = await this.executeRule(rule, context);
        resolve(result);
      },
    });

    if (gateResult.status === "admitted" || gateResult.status === "queued") {
      return resultPromise;
    }

    // Dropped or suppressed — return a failure result immediately.
    return {
      executionId: "",
      success: false,
      commandResults: [],
      failureReason: gateResult.status === "dropped"
        ? "Execution gate: dropped (queue full)"
        : "Execution gate: suppressed (duplicate)",
    };
  }

  /** Get rule count */
  get ruleCount(): number {
    return this.registry.size;
  }

  /** Current execution gate utilization for health/metrics (Req 4.1). */
  get gateStats() {
    return this.gate.stats();
  }

  /** Stop all cron timers and clean up resources */
  dispose(): void {
    this.cronTimerManager.stopAll();
  }

  /** Evaluate all matching rules for an event */
  private evaluate(event: NormalizedEvent): void {
    const context: EventContext = {
      topic: event.topic,
      deviceId: event.deviceId,
      state: event.state,
      timestamp: event.timestamp,
      ...(event.meta ? { meta: event.meta } : {}),
    };

    const rules = this.registry.listRules();

    for (const rule of rules) {
      if (!this.topicMatches(rule.topic, event.topic)) continue;

      // Scope-aware event admission (audit Critical 2): a scoped automation is
      // only triggered by device events for devices its owning tab exposes, so
      // out-of-scope device state never reaches its condition or Logic. This runs
      // BEFORE the condition so the condition never observes a hidden device.
      if (!this.admitDeviceEvent(rule.id, event.deviceId)) continue;

      try {
        if (rule.condition && !rule.condition(context)) continue;
      } catch (err) {
        logger.error(
          { ruleId: rule.id, topic: event.topic, error: (err as Error).message },
          "Rule condition threw error",
        );
        continue;
      }

      // Each matching rule runs as its own Automation_Execution. Executions are
      // not awaited here so concurrent rules interleave; each is correlated by
      // its own executionId (Req 6.7).
      const result = this.gate.submit({
        ruleId: rule.id,
        deviceId: context.deviceId,
        topic: context.topic,
        execute: () => this.executeRule(rule, context),
      });
      if (result.status === "dropped" || result.status === "suppressed") {
        logger.debug({ ruleId: rule.id, status: result.status }, "Execution gate: rule not admitted");
      }
    }
  }

  /**
   * Evaluate rules against an Automation Event (Req 6.10-6.12). Unlike device
   * state, this bypasses the device-scope admission gate (an automation event is
   * not a hidden device-state event, Req 6.11) and carries no device id. The
   * receiving rule gets the user payload as `state` plus the event metadata.
   */
  private evaluateAutomationEvent(topic: string, envelope: AutomationEventEnvelopeV1): void {
    // Normalize a primitive payload so EventContext.state stays a record.
    const payload = envelope.payload;
    const state: Record<string, unknown> =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { value: payload };

    const context: EventContext = {
      topic,
      deviceId: "", // non-device event; never claim the source rule is a device
      state,
      timestamp: envelope.meta.timestamp,
      meta: envelope.meta,
    };

    for (const rule of this.registry.listRules()) {
      if (!this.topicMatches(rule.topic, topic)) continue;
      // NOTE: no admitDeviceEvent() here — automation events are not gated by the
      // device-scope admission check (Req 6.11).
      try {
        if (rule.condition && !rule.condition(context)) continue;
      } catch (err) {
        logger.error(
          { ruleId: rule.id, topic, error: (err as Error).message },
          "Rule condition threw error on automation event",
        );
        continue;
      }
      const result = this.gate.submit({
        ruleId: rule.id,
        deviceId: context.deviceId,
        topic: context.topic,
        execute: () => this.executeRule(rule, context),
      });
      if (result.status === "dropped" || result.status === "suppressed") {
        logger.debug({ ruleId: rule.id, status: result.status }, "Execution gate: rule not admitted");
      }
    }
  }

  /** Route a rule to the script or form execution path. Never rejects. */
  private executeRule(rule: Rule, context: EventContext): Promise<AutomationExecutionResult> {
    const compiledJs = rule.compiled_js;
    if (compiledJs && this.sandbox) {
      return this.executeScriptRule(rule, compiledJs, context);
    }
    return this.executeDirectRule(rule, context);
  }

  /**
   * Execute a script rule through the Sandbox. Establishes the executionId on
   * the collector's AsyncLocalStorage so sandbox-issued Command_Results are
   * attributed to this execution, then combines the sandbox outcome with the
   * collected Command_Results into a single {@link AutomationExecutionResult}
   * (Req 5.3, 5.4).
   *
   * The sandbox host callbacks push each Command_Result into the collector, and
   * Sandbox.execute() now drains every in-flight device-action promise (within
   * this AsyncLocalStorage context) before it resolves, so all pushCurrent() calls
   * land before the collector is closed below — the async-completion await gap is
   * closed (Req 11.1, 11.2).
   */
  private async executeScriptRule(
    rule: Rule,
    compiledJs: string,
    context: EventContext,
  ): Promise<AutomationExecutionResult> {
    const executionId = randomUUID();
    const start = Date.now();

    // Exactly one "started" signal, emitted synchronously before any await so it
    // always precedes AUTOMATION_COMPLETED for this execution (Req 6.1, 6.6).
    this.emitFired(rule, context, executionId);
    this.collector.open(executionId);

    const sandboxContext: SandboxContext = {
      topic: context.topic,
      deviceId: context.deviceId,
      state: context.state,
      timestamp: context.timestamp,
      ...(context.meta ? { meta: context.meta } : {}),
    };

    // Sandbox.execute() resolves for every outcome and never rejects. Run inside
    // both the collector ALS (for pushCurrent) and the narrow execution context
    // (so commands/events issued during this execution carry executionId and the
    // triggering causation, phase-1 Req 5.6, 5.7).
    const sandboxResult = await runInExecutionContext(
      {
        executionId,
        ...(context.meta?.eventId ? { causationId: context.meta.eventId } : {}),
        automationId: rule.id,
        ...(context.meta ? { triggerMeta: context.meta } : {}),
      },
      () =>
        this.collector.context.run(executionId, () =>
          this.sandbox!.execute(compiledJs, sandboxContext, rule.id),
        ),
    );

    const logic: LogicOutcome =
      sandboxResult && sandboxResult.success
        ? { ok: true }
        : {
            ok: false,
            error:
              sandboxResult && !sandboxResult.success
                ? sandboxResult.error
                : "Sandbox execution failed",
          };

    if (!logic.ok) {
      const reason = sandboxResult && !sandboxResult.success ? sandboxResult.reason : undefined;
      logger.error({ ruleId: rule.id, reason, error: logic.error }, "Script rule execution failed");
    }

    const commandResults = this.collector.close(executionId);
    const result = assembleExecutionResult(executionId, logic, commandResults);
    this.record(rule, context, result, Date.now() - start);
    return result;
  }

  /**
   * Execute a non-script rule (e.g. a form rule) directly, without the sandbox.
   * Awaits the action's returned Command_Result (form rules return one once
   * migrated), incorporates it into the {@link AutomationExecutionResult}, and
   * records the execution (Req 5.1, 5.2).
   */
  private async executeDirectRule(rule: Rule, context: EventContext): Promise<AutomationExecutionResult> {
    const executionId = randomUUID();
    const start = Date.now();

    // Exactly one "started" signal, before any await (Req 6.1, 6.6). The
    // previous premature emission on the async path is removed.
    this.emitFired(rule, context, executionId);
    this.collector.open(executionId);

    let logic: LogicOutcome = { ok: true };
    try {
      // Run under the ALS context so any collector.pushCurrent() during the
      // action attributes to this execution. The action's return value is a
      // Command_Result for migrated form rules (task 6.3) and void otherwise.
      const returned = await runInExecutionContext(
        {
          executionId,
          ...(context.meta?.eventId ? { causationId: context.meta.eventId } : {}),
          automationId: rule.id,
          ...(context.meta ? { triggerMeta: context.meta } : {}),
        },
        () =>
          this.collector.context.run(
            executionId,
            () => Promise.resolve(rule.action(context)) as Promise<unknown>,
          ),
      );
      if (isCommandResult(returned)) {
        this.collector.push(executionId, returned);
      }
    } catch (err) {
      logic = { ok: false, error: (err as Error).message };
      logger.error({ ruleId: rule.id, error: (err as Error).message }, "Rule action failed");
    }

    const commandResults = this.collector.close(executionId);
    const result = assembleExecutionResult(executionId, logic, commandResults);
    this.record(rule, context, result, Date.now() - start);
    return result;
  }

  /** Emit exactly one AUTOMATION_FIRED ("started") for an execution (Req 6.1). */
  private emitFired(rule: Rule, context: EventContext, executionId: string): void {
    this.eventBus.emit(AUTOMATION_FIRED, {
      executionId,
      ruleId: rule.id,
      ruleName: rule.name || "Unnamed Rule",
      topic: context.topic,
      deviceId: context.deviceId,
      timestamp: Date.now(),
    });
  }

  /** Hand the assembled result to the single Execution_Owner (Req 8). */
  private record(
    rule: Rule,
    ctx: EventContext,
    result: AutomationExecutionResult,
    durationMs: number,
  ): void {
    if (!this.executionRecorder) return;
    const ruleType: ExecutionRecordRule["ruleType"] = rule.compiled_js ? "script" : "form";
    const recordRule: ExecutionRecordRule = {
      id: rule.id,
      ...(rule.name ? { name: rule.name } : {}),
      ruleType,
      triggerTopic: ctx.topic,
    };
    this.executionRecorder.record({ rule: recordRule, result, durationMs });
  }

  /**
   * Decide whether a device event may trigger a rule, honouring the rule's
   * authoring scope. Unrestricted rules (and all rules when no scope resolver is
   * wired) admit every matching event. A scoped rule admits a device event only
   * when the event's device is in its owning tab's exposed device set — so an
   * out-of-scope device event (including a `#`/broad subscription, a service
   * trigger with a synthetic device id, or a deleted-owner-tab empty scope)
   * never reaches the rule's condition or Logic (audit Critical 2).
   *
   * Non-device internal events (cron, manual fire) do not flow through
   * `evaluate()`, so this admission applies only to device state changes.
   */
  private admitDeviceEvent(ruleId: string, deviceId: string): boolean {
    if (!this.scopeResolver) return true;
    const scope = this.scopeResolver.resolve(ruleId);
    if (scope.kind === "unrestricted") return true;
    return scope.deviceIds.has(deviceId);
  }

  /** Check if a rule topic pattern matches an event topic */
  private topicMatches(pattern: string, topic: string): boolean {
    // Empty pattern means manual-only rule — never matches any event
    if (!pattern) return false;

    // Exact match
    if (pattern === topic) return true;

    // MQTT wildcard matching
    const patternParts = pattern.split("/");
    const topicParts = topic.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === "#") return true; // Multi-level wildcard
      if (patternParts[i] === "+") continue; // Single-level wildcard
      if (i >= topicParts.length || patternParts[i] !== topicParts[i]) return false;
    }

    return patternParts.length === topicParts.length;
  }
}
