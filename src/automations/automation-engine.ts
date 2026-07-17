// src/automations/automation-engine.ts — Rule evaluation engine

import type { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  DEVICE_STATE_CHANGE,
  AUTOMATION_FIRED,
  AUTOMATION_RULE_REGISTERED,
  AUTOMATION_RULE_UNREGISTERED,
} from "../core/event-bus.js";
import type { NormalizedEvent, EventContext, Rule } from "../core/types.js";
import type { Sandbox, SandboxContext } from "./sandbox.js";
import type { CommandService } from "./command-service.js";
import type { ExecutionLog } from "./execution-log.js";
import { ExecutionRecorder, type ExecutionRecordRule } from "./execution-recorder.js";
import { CommandResultCollector } from "./command-result-collector.js";
import { assembleExecutionResult, type LogicOutcome } from "./execution-result.js";
import type { AutomationExecutionResult, CommandResult } from "./execution-types.js";
import { RuleRegistry } from "./rule-registry.js";
import { CronTimerManager } from "./cron-timer-manager.js";
import logger from "../logger.js";

/** Optional dependencies for script/form rule execution (unified-command-boundary Req 4–8). */
export interface AutomationEngineDeps {
  sandbox?: Sandbox;
  /** The single physical-command boundary (renamed from ActionExecutor, Req 1.6). */
  commandService?: CommandService;
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
  private executionRecorder?: ExecutionRecorder;
  private collector: CommandResultCollector;
  private cronTimerManager: CronTimerManager;

  constructor(eventBus: EventEmitter, deps?: AutomationEngineDeps) {
    this.registry = new RuleRegistry();
    this.eventBus = eventBus;
    this.sandbox = deps?.sandbox;
    this.commandService = deps?.commandService;
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

    this.cronTimerManager = new CronTimerManager();
    this.eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
      this.evaluate(event);
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
        void this.executeRule(rule, context);
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
   */
  async fire(ruleId: string, context: EventContext): Promise<AutomationExecutionResult> {
    const rule = this.registry.getRule(ruleId);
    if (!rule) throw new Error(`Rule ${ruleId} not found`);
    return this.executeRule(rule, context);
  }

  /** Get rule count */
  get ruleCount(): number {
    return this.registry.size;
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
    };

    const rules = this.registry.listRules();

    for (const rule of rules) {
      if (!this.topicMatches(rule.topic, event.topic)) continue;

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
      void this.executeRule(rule, context);
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
   * NOTE (cross-spec seam): the sandbox host callbacks pushing each Command_Result
   * into the collector is task 6.4; until it lands the collected list is empty for
   * the script path, so a script rule's result reflects the sandbox outcome only.
   * Full script-path truthfulness additionally depends on the async-await-in-scripts
   * companion fix (out of scope here).
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
    };

    // Sandbox.execute() resolves for every outcome and never rejects.
    const sandboxResult = await this.collector.context.run(executionId, () =>
      this.sandbox!.execute(compiledJs, sandboxContext, rule.id),
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
      const returned = await this.collector.context.run(
        executionId,
        () => Promise.resolve(rule.action(context)) as Promise<unknown>,
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
