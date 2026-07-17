// src/automations/execution-recorder.property.test.ts
// Feature: unified-command-boundary — Property 12

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as fc from "fast-check";
import { ExecutionRecorder, type ExecutionRecordRule } from "./execution-recorder.js";
import { ExecutionLog } from "./execution-log.js";
import { AUTOMATION_COMPLETED, AUTOMATION_EXECUTION_COMPLETE } from "../core/event-bus.js";
import type { AutomationExecutionResult, CommandResult } from "./execution-types.js";

const commandResultArb: fc.Arbitrary<CommandResult> = fc.record(
  {
    success: fc.boolean(),
    error: fc.option(fc.string(), { nil: undefined }),
    lifecycleState: fc.option(
      fc.constantFrom(
        "DISPATCHED" as const,
        "ACKNOWLEDGED" as const,
        "OBSERVED" as const,
        "FAILED" as const,
        "TIMED_OUT" as const,
      ),
      { nil: undefined },
    ),
  },
  { requiredKeys: ["success"] },
);

const resultArb: fc.Arbitrary<AutomationExecutionResult> = fc
  .record({
    executionId: fc.uuid(),
    success: fc.boolean(),
    commandResults: fc.array(commandResultArb, { maxLength: 10 }),
    failureReason: fc.option(fc.string(), { nil: undefined }),
  })
  .map((r) => {
    // Keep the value well-formed: a populated failureReason only on failure.
    if (r.success) return { ...r, failureReason: undefined };
    return { ...r, failureReason: r.failureReason ?? "failure" };
  });

const ruleArb: fc.Arbitrary<ExecutionRecordRule> = fc.record(
  {
    id: fc.uuid(),
    name: fc.option(fc.string(), { nil: undefined }),
    ruleType: fc.constantFrom("form" as const, "script" as const),
    triggerTopic: fc.string(),
  },
  { requiredKeys: ["id", "ruleType", "triggerTopic"] },
);

// durationMs deliberately includes negatives and fractions to exercise Req 8.6.
const durationArb = fc.oneof(
  fc.integer({ min: 0, max: 100_000 }),
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.constant(-1),
);

// Feature: unified-command-boundary, Property 12: Single-owner, exactly-once recording derived from one result
describe("Property 12: Single-owner, exactly-once recording derived from one result", () => {
  it("record() pushes exactly one history entry, emits each event once, all derived from the one result", () => {
    fc.assert(
      fc.property(ruleArb, resultArb, durationArb, (rule, result, durationMs) => {
        const eventBus = new EventEmitter();
        const executionLog = new ExecutionLog();
        const pushSpy = vi.spyOn(executionLog, "push");
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

        const metricsEvents: Array<{ status: string; durationMs: number; ruleId: string }> = [];
        const completedEvents: Array<{ result: AutomationExecutionResult }> = [];
        eventBus.on(AUTOMATION_EXECUTION_COMPLETE, (p) => metricsEvents.push(p));
        eventBus.on(AUTOMATION_COMPLETED, (p) => completedEvents.push(p));

        const recorder = new ExecutionRecorder({
          eventBus,
          executionLog,
          logger: logger as never,
        });

        recorder.record({ rule, result, durationMs });

        // Exactly once each (Req 8.1, 8.2, 8.3).
        expect(pushSpy).toHaveBeenCalledTimes(1);
        expect(metricsEvents).toHaveLength(1);
        expect(completedEvents).toHaveLength(1);

        const entry = pushSpy.mock.calls[0][0];

        // Recorded success matches the one result (Req 5.5, 8.1, 8.4).
        expect(entry.success).toBe(result.success);
        // Metrics status matches the same success (Req 8.2, 8.4).
        expect(metricsEvents[0].status).toBe(result.success ? "success" : "error");
        // AUTOMATION_COMPLETED carries the same result (Req 8.3, 6.2).
        expect(completedEvents[0].result).toBe(result);

        // Audit outcome matches the same success (Req 8.4): info on success, error on failure.
        if (result.success) {
          expect(logger.info).toHaveBeenCalledTimes(1);
          expect(logger.error).not.toHaveBeenCalled();
        } else {
          expect(logger.error).toHaveBeenCalledTimes(1);
          expect(logger.info).not.toHaveBeenCalled();
        }

        // failureReason recorded iff unsuccessful (Req 5.6) — never on success.
        if (result.success) {
          expect(entry.failureReason).toBeUndefined();
        } else {
          expect(entry.failureReason).toBe(result.failureReason);
        }

        // Duration is a non-negative integer ms, consistent across history and metrics (Req 8.6).
        expect(Number.isInteger(entry.duration)).toBe(true);
        expect(entry.duration).toBeGreaterThanOrEqual(0);
        expect(metricsEvents[0].durationMs).toBe(entry.duration);
      }),
      { numRuns: 200 },
    );
  });
});
