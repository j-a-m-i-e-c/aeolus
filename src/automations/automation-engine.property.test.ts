// src/automations/automation-engine.property.test.ts
// Feature: verified-command-execution — Properties 3, 4

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { EventEmitter } from "node:events";
import { DEVICE_STATE_CHANGE, AUTOMATION_FIRED, AUTOMATION_EXECUTION_COMPLETE } from "../core/event-bus.js";
import { AutomationEngine } from "./automation-engine.js";
import type { Rule, NormalizedEvent } from "../core/types.js";
import type { Sandbox, SandboxExecutionResult } from "./sandbox.js";
import type { ExecutionLog } from "./execution-log.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeEvent(): NormalizedEvent {
  return {
    deviceId: "sensor-1",
    deviceType: "sensor",
    state: { value: 25 },
    topic: "home/sensor/temperature",
    timestamp: Date.now(),
  };
}

// ─── Property 3: The engine faithfully mirrors the sandbox result into the execution log ────

// Feature: verified-command-execution, Property 3: The engine faithfully mirrors the sandbox result into the execution log
describe("Property 3: The engine faithfully mirrors the sandbox result into the execution log", () => {
  it("logged success matches result.success; failures include error and reason", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.string({ minLength: 1 }),
        fc.constantFrom("runtime" as const, "timeout" as const, "memory" as const),
        async (succeeds, errorMsg, reason) => {
          const result: SandboxExecutionResult = succeeds
            ? { success: true }
            : { success: false, error: errorMsg, reason };

          const executeFn = vi.fn().mockResolvedValue(result);
          const sandbox = { execute: executeFn } as unknown as Sandbox;
          const pushFn = vi.fn();
          const executionLog = { push: pushFn } as unknown as ExecutionLog;

          const localBus = new EventEmitter();
          const engine = new AutomationEngine(localBus, { sandbox, executionLog });

          const rule = {
            id: "test-rule",
            topic: "home/sensor/temperature",
            name: "Test",
            action: vi.fn(),
            compiled_js: "/* test */",
          };
          engine.register(rule as unknown as Rule);

          localBus.emit(DEVICE_STATE_CHANGE, makeEvent());
          await new Promise((r) => setTimeout(r, 10));

          expect(pushFn).toHaveBeenCalledOnce();
          const entry = pushFn.mock.calls[0][0];
          expect(entry.actions[0].success).toBe(succeeds);

          if (!succeeds) {
            expect(entry.actions[0].error).toBe(errorMsg);
            expect(entry.actions[0].reason).toBe(reason);
          }

          engine.dispose();
        },
      ),
      { numRuns: 200 },
    );
  }, 30000);
});

// ─── Property 4: Metrics and events reflect the true script outcome ──────────

// Feature: verified-command-execution, Property 4: Metrics and events reflect the true script outcome
describe("Property 4: Metrics and events reflect the true script outcome", () => {
  it("AUTOMATION_EXECUTION_COMPLETE status is success iff result.success; AUTOMATION_FIRED iff success", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.string({ minLength: 1 }),
        fc.constantFrom("runtime" as const, "timeout" as const, "memory" as const),
        async (succeeds, errorMsg, reason) => {
          const result: SandboxExecutionResult = succeeds
            ? { success: true }
            : { success: false, error: errorMsg, reason };

          const executeFn = vi.fn().mockResolvedValue(result);
          const sandbox = { execute: executeFn } as unknown as Sandbox;
          const pushFn = vi.fn();
          const executionLog = { push: pushFn } as unknown as ExecutionLog;

          const localBus = new EventEmitter();
          const executionCompleteEvents: { status: string }[] = [];
          const firedEvents: unknown[] = [];
          localBus.on(AUTOMATION_EXECUTION_COMPLETE, (e) => executionCompleteEvents.push(e));
          localBus.on(AUTOMATION_FIRED, (e) => firedEvents.push(e));

          const engine = new AutomationEngine(localBus, { sandbox, executionLog });

          const rule = {
            id: "metrics-rule",
            topic: "home/sensor/temperature",
            name: "Metrics Test",
            action: vi.fn(),
            compiled_js: "/* test */",
          };
          engine.register(rule as unknown as Rule);

          localBus.emit(DEVICE_STATE_CHANGE, makeEvent());
          await new Promise((r) => setTimeout(r, 10));

          // AUTOMATION_EXECUTION_COMPLETE status
          expect(executionCompleteEvents.length).toBe(1);
          expect(executionCompleteEvents[0].status).toBe(succeeds ? "success" : "error");

          // AUTOMATION_FIRED emitted iff success
          if (succeeds) {
            expect(firedEvents.length).toBe(1);
          } else {
            expect(firedEvents.length).toBe(0);
          }

          engine.dispose();
        },
      ),
      { numRuns: 200 },
    );
  }, 30000);
});
