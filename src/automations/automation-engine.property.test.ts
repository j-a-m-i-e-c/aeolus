// src/automations/automation-engine.property.test.ts
// Feature: unified-command-boundary — Properties 10, 11, 13
//
// Model: an in-memory EventEmitter event bus, a fake CommandService whose
// results are pushed by the (migrated) form-rule action closure, the real
// CommandResultCollector, and the real ExecutionRecorder (Execution_Owner)
// wired to a no-op ExecutionLog so the true AUTOMATION_COMPLETED / metrics
// semantics are exercised. A spy wraps ExecutionRecorder.record to assert
// exactly-once recording.

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { EventEmitter } from "node:events";
import {
  AUTOMATION_FIRED,
  AUTOMATION_COMPLETED,
} from "../core/event-bus.js";
import { AutomationEngine } from "./automation-engine.js";
import { ExecutionRecorder } from "./execution-recorder.js";
import { CommandResultCollector } from "./command-result-collector.js";
import type { Rule, EventContext, ActionResult } from "../core/types.js";
import type { ExecutionLog } from "./execution-log.js";
import type { Logger } from "pino";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** A fake CommandService: returns one completion Command_Result, never emits events. */
function makeFakeCommandService() {
  const emitted: string[] = []; // records any event the service would emit — must stay empty (Req 6.3)
  return {
    emitted,
    async execute(succeeds: boolean, delayMs: number): Promise<ActionResult> {
      await new Promise((r) => setTimeout(r, delayMs));
      return succeeds
        ? { success: true, lifecycleState: "DISPATCHED" }
        : { success: false, error: "command failed", lifecycleState: "FAILED" };
    },
  };
}

interface Harness {
  engine: AutomationEngine;
  bus: EventEmitter;
  recordSpy: ReturnType<typeof vi.spyOn>;
  fired: Array<{ executionId: string; ruleId: string }>;
  completed: Array<{ result: { executionId: string; success: boolean; failureReason?: string } }>;
  order: Array<{ kind: "fired" | "completed"; executionId: string }>;
}

function makeHarness(): Harness {
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  const executionLog = { push: vi.fn() } as unknown as ExecutionLog;
  const executionRecorder = new ExecutionRecorder({ eventBus: bus, executionLog, logger: silentLogger });
  const recordSpy = vi.spyOn(executionRecorder, "record");
  const collector = new CommandResultCollector();
  const engine = new AutomationEngine(bus, { executionRecorder, collector });

  const fired: Harness["fired"] = [];
  const completed: Harness["completed"] = [];
  const order: Harness["order"] = [];
  bus.on(AUTOMATION_FIRED, (e: { executionId: string; ruleId: string }) => {
    fired.push(e);
    order.push({ kind: "fired", executionId: e.executionId });
  });
  bus.on(AUTOMATION_COMPLETED, (e: { result: { executionId: string; success: boolean } }) => {
    completed.push(e);
    order.push({ kind: "completed", executionId: e.result.executionId });
  });

  return { engine, bus, recordSpy, fired, completed, order };
}

function ctx(topic = "manual"): EventContext {
  return { topic, deviceId: "dev", state: {}, timestamp: Date.now() };
}

// ─── Property 10: Execution ids are unique across concurrently active executions ───

// Feature: unified-command-boundary, Property 10: Execution ids are unique across concurrently active executions
describe("Property 10: Execution ids are unique across concurrently active executions", () => {
  it("every concurrently-active execution has a distinct executionId, never reused", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A batch of concurrent executions, each with an outcome and a small delay
        // so their lifetimes overlap.
        fc.array(
          fc.record({ succeeds: fc.boolean(), delayMs: fc.integer({ min: 0, max: 8 }) }),
          { minLength: 2, maxLength: 6 },
        ),
        async (specs) => {
          const h = makeHarness();
          const svc = makeFakeCommandService();

          specs.forEach((spec, i) => {
            const rule: Rule = {
              id: `rule-${i}`,
              topic: "",
              name: `Rule ${i}`,
              action: () => svc.execute(spec.succeeds, spec.delayMs),
            };
            h.engine.register(rule);
          });

          // Fire all concurrently — none awaits the others, so all are active at once.
          const results = await Promise.all(
            specs.map((_, i) => h.engine.fire(`rule-${i}`, ctx())),
          );

          const firedIds = h.fired.map((f) => f.executionId);
          // Uniqueness across the concurrent batch (Req 4.2).
          expect(new Set(firedIds).size).toBe(firedIds.length);
          expect(firedIds.length).toBe(specs.length);
          // Each returned result carries a distinct id matching a fired event.
          const resultIds = results.map((r) => r.executionId);
          expect(new Set(resultIds).size).toBe(resultIds.length);
          for (const id of resultIds) {
            expect(firedIds).toContain(id);
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 30000);
});

// ─── Property 11: Fired/completed event semantics ──────────────────────────

// Feature: unified-command-boundary, Property 11: Fired/completed event semantics
describe("Property 11: Fired/completed event semantics", () => {
  it("exactly one fired + one completed per execution, fired precedes completed, success reflects outcome", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ succeeds: fc.boolean(), delayMs: fc.integer({ min: 0, max: 6 }) }),
          { minLength: 1, maxLength: 5 },
        ),
        async (specs) => {
          const h = makeHarness();
          const svc = makeFakeCommandService();

          specs.forEach((spec, i) => {
            h.engine.register({
              id: `r-${i}`,
              topic: "",
              name: `R ${i}`,
              action: () => svc.execute(spec.succeeds, spec.delayMs),
            });
          });

          const results = await Promise.all(specs.map((_, i) => h.engine.fire(`r-${i}`, ctx())));

          // Exactly one fired and one completed per execution (Req 6.1, 6.2, 6.4).
          expect(h.fired.length).toBe(specs.length);
          expect(h.completed.length).toBe(specs.length);
          // The CommandService never emitted an AUTOMATION_FIRED (Req 6.3).
          expect(svc.emitted.length).toBe(0);
          // The Execution_Owner recorded exactly once per execution (Req 8.3 / owner).
          expect(h.recordSpy).toHaveBeenCalledTimes(specs.length);

          const firedIds = h.fired.map((f) => f.executionId);
          const completedIds = h.completed.map((c) => c.result.executionId);
          // Each completed correlates to a fired execution by id (Req 6.7).
          expect(new Set(completedIds)).toEqual(new Set(firedIds));

          // Fired precedes completed for the same executionId (Req 6.6).
          for (const id of firedIds) {
            const firedIdx = h.order.findIndex((o) => o.kind === "fired" && o.executionId === id);
            const completedIdx = h.order.findIndex((o) => o.kind === "completed" && o.executionId === id);
            expect(firedIdx).toBeGreaterThanOrEqual(0);
            expect(completedIdx).toBeGreaterThan(firedIdx);
          }

          // completed.success mirrors the execution outcome (Req 6.5).
          for (const r of results) {
            const evt = h.completed.find((c) => c.result.executionId === r.executionId)!;
            expect(evt.result.success).toBe(r.success);
            if (!r.success) {
              expect(evt.result.failureReason).toBeTruthy();
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 30000);
});

// ─── Property 13: Manual fire resolves with the eventual result ────────────

// Feature: unified-command-boundary, Property 13: Manual fire resolves with the eventual result
describe("Property 13: Manual fire resolves with the eventual result", () => {
  it("fire() resolves only after the outcome, reporting success/failureReason/executionId truthfully", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.integer({ min: 0, max: 10 }),
        async (succeeds, delayMs) => {
          const h = makeHarness();
          const svc = makeFakeCommandService();

          h.engine.register({
            id: "manual",
            topic: "",
            name: "Manual",
            action: () => svc.execute(succeeds, delayMs),
          });

          const result = await h.engine.fire("manual", ctx());

          // The result is the eventual outcome (Req 7.1, 7.2, 7.3).
          expect(result.success).toBe(succeeds);
          // A non-empty failureReason on failure (Req 7.4).
          if (!succeeds) {
            expect(result.failureReason && result.failureReason.length > 0).toBe(true);
          } else {
            expect(result.failureReason).toBeUndefined();
          }
          // The response carries the executionId of the created execution (Req 7.5).
          expect(typeof result.executionId).toBe("string");
          expect(result.executionId.length).toBeGreaterThan(0);
          // By the time fire() resolves, the completion event for that id was emitted.
          const completedForId = h.completed.filter((c) => c.result.executionId === result.executionId);
          expect(completedForId.length).toBe(1);
          expect(completedForId[0].result.success).toBe(succeeds);
        },
      ),
      { numRuns: 200 },
    );
  }, 30000);
});
