// src/automations/execution-recorder.ts — Execution_Owner (unified-command-boundary)
//
// The single component that records an Automation_Execution's history, emits
// its metrics, emits the completion event, and writes audit — each exactly
// once, all derived from the same AutomationExecutionResult (Req 8.1–8.4). The
// CommandService performs NONE of these (Req 8.5): it only processes one
// physical command and returns one Command_Result.

import type { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { AUTOMATION_COMPLETED, AUTOMATION_EXECUTION_COMPLETE } from "../core/event-bus.js";
import type { ExecutionLog, ExecutionLogEntry } from "./execution-log.js";
import type { AutomationExecutionResult } from "./execution-types.js";

/** Dependencies injected into the {@link ExecutionRecorder}. */
export interface ExecutionRecorderDeps {
  eventBus: EventEmitter;
  executionLog: ExecutionLog;
  logger: Logger;
}

/** Identifying metadata for the rule whose execution is being recorded. */
export interface ExecutionRecordRule {
  id: string;
  name?: string;
  ruleType: "form" | "script";
  triggerTopic: string;
}

/** Input to {@link ExecutionRecorder.record}. */
export interface ExecutionRecordInput {
  rule: ExecutionRecordRule;
  result: AutomationExecutionResult;
  /** Measured wall-clock duration; recorded as a non-negative integer ms (Req 8.6). */
  durationMs: number;
}

/** Coerce a measured duration to a non-negative integer number of ms (Req 8.6). */
function toNonNegativeIntMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round(durationMs);
}

/**
 * The single Execution_Owner. Constructed alongside and called only by the
 * AutomationEngine, exactly once per Automation_Execution.
 */
export class ExecutionRecorder {
  private readonly eventBus: EventEmitter;
  private readonly executionLog: ExecutionLog;
  private readonly logger: Logger;

  constructor(deps: ExecutionRecorderDeps) {
    this.eventBus = deps.eventBus;
    this.executionLog = deps.executionLog;
    this.logger = deps.logger;
  }

  /**
   * Record one Automation_Execution. Performs, in order and each exactly once,
   * all derived from the single {@link AutomationExecutionResult}:
   *   1. ExecutionLog.push with execution-level success/failureReason and
   *      duration = durationMs (Req 5.5, 5.6, 8.1, 8.6).
   *   2. Emit AUTOMATION_EXECUTION_COMPLETE metrics with status from success
   *      (Req 8.2).
   *   3. Audit log at info/error from the same success (Req 8.4).
   *   4. Emit AUTOMATION_COMPLETED { result } (Req 8.3, 6.2).
   *
   * Idempotency is guaranteed by being called once per execution by the engine;
   * the engine emits AUTOMATION_FIRED before calling this, so AUTOMATION_COMPLETED
   * is always emitted after AUTOMATION_FIRED for the same execution (Req 6.6).
   */
  record(input: ExecutionRecordInput): void {
    const { rule, result } = input;
    const ruleName = rule.name || "Unnamed Rule";
    const duration = toNonNegativeIntMs(input.durationMs);
    const { success } = result;

    // (1) History — one entry, execution-level success/failureReason/duration.
    const entry: ExecutionLogEntry = {
      id: randomUUID(),
      ruleId: rule.id,
      ruleName,
      ruleType: rule.ruleType,
      triggerTopic: rule.triggerTopic,
      actions: result.commandResults.map((cr) => ({
        type: "command",
        target: rule.triggerTopic,
        success: cr.success,
        ...(cr.error ? { error: cr.error } : {}),
        ...(cr.lifecycleState ? { lifecycleState: cr.lifecycleState } : {}),
      })),
      duration,
      timestamp: Date.now(),
      success,
      ...(success ? {} : { failureReason: result.failureReason }),
    };
    this.executionLog.push(entry);

    // (2) Metrics — status derived from the same success value.
    this.eventBus.emit(AUTOMATION_EXECUTION_COMPLETE, {
      ruleId: rule.id,
      ruleName,
      status: success ? "success" : "error",
      durationMs: duration,
    });

    // (3) Audit — outcome derived from the same success value.
    if (success) {
      this.logger.info(
        { executionId: result.executionId, ruleId: rule.id, ruleName, durationMs: duration },
        "Automation execution completed",
      );
    } else {
      this.logger.error(
        {
          executionId: result.executionId,
          ruleId: rule.id,
          ruleName,
          durationMs: duration,
          failureReason: result.failureReason,
        },
        "Automation execution failed",
      );
    }

    // (4) Completion event — carries the single result (emitted after FIRED).
    this.eventBus.emit(AUTOMATION_COMPLETED, {
      result,
      ruleId: rule.id,
      ruleName,
      timestamp: Date.now(),
    });
  }

  /**
   * Req 8.7 — when the AutomationExecutionResult required to record an execution
   * is unavailable, write a single recording-failure log entry and emit NONE of
   * the metrics event, the AUTOMATION_COMPLETED event, or a success-history entry.
   */
  recordUnavailable(
    rule: ExecutionRecordRule,
    executionId: string,
    durationMs: number,
    reason: string,
  ): void {
    const ruleName = rule.name || "Unnamed Rule";
    const duration = toNonNegativeIntMs(durationMs);

    // A single recording-failure entry; no metrics, no AUTOMATION_COMPLETED.
    const entry: ExecutionLogEntry = {
      id: randomUUID(),
      ruleId: rule.id,
      ruleName,
      ruleType: rule.ruleType,
      triggerTopic: rule.triggerTopic,
      actions: [],
      duration,
      timestamp: Date.now(),
      success: false,
      failureReason: reason,
    };
    this.executionLog.push(entry);

    this.logger.error(
      { executionId, ruleId: rule.id, ruleName, durationMs: duration, reason },
      "Automation execution recording failed: result unavailable",
    );
  }
}
