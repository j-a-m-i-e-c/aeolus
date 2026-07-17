// src/automations/execution-result.property.test.ts
// Feature: unified-command-boundary — Property 8

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { assembleExecutionResult, type LogicOutcome } from "./execution-result.js";
import type { CommandResult } from "./execution-types.js";

const lifecycleArb = fc.constantFrom(
  "REQUESTED",
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
) as fc.Arbitrary<CommandResult["lifecycleState"]>;

const commandResultArb: fc.Arbitrary<CommandResult> = fc.record(
  {
    success: fc.boolean(),
    error: fc.option(fc.string(), { nil: undefined }),
    lifecycleState: lifecycleArb,
  },
  { requiredKeys: ["success"] },
);

/** A slot may hold a real result, or be missing (null/undefined) — Req 5.7. */
const slotArb: fc.Arbitrary<CommandResult | null | undefined> = fc.oneof(
  { weight: 8, arbitrary: commandResultArb },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
);

const logicArb: fc.Arbitrary<LogicOutcome> = fc.record(
  {
    ok: fc.boolean(),
    error: fc.option(fc.string(), { nil: undefined }),
  },
  { requiredKeys: ["ok"] },
);

function everyPresentSucceeds(
  results: ReadonlyArray<CommandResult | null | undefined>,
): boolean {
  return results.every((r) => r != null && r.success === true);
}

// Feature: unified-command-boundary, Property 8: Execution-result assembly is faithful
describe("Property 8: Execution-result assembly is faithful", () => {
  it("success is true iff logic ok AND every present command succeeded", () => {
    fc.assert(
      fc.property(fc.uuid(), logicArb, fc.array(slotArb, { maxLength: 12 }), (id, logic, slots) => {
        const result = assembleExecutionResult(id, logic, slots);
        const expected = logic.ok && everyPresentSucceeds(slots);
        expect(result.success).toBe(expected);
        expect(result.executionId).toBe(id);
      }),
      { numRuns: 200 },
    );
  });

  it("a populated failureReason is never paired with success:true (Req 4.8)", () => {
    fc.assert(
      fc.property(fc.uuid(), logicArb, fc.array(slotArb, { maxLength: 12 }), (id, logic, slots) => {
        const result = assembleExecutionResult(id, logic, slots);
        if (result.success) {
          expect(result.failureReason).toBeUndefined();
        } else {
          expect(typeof result.failureReason).toBe("string");
          expect((result.failureReason as string).length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("empty command list + logic ok ⇒ success:true with empty commandResults (Req 4.7)", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.option(fc.string(), { nil: undefined }), (id, error) => {
        const result = assembleExecutionResult(id, { ok: true, error }, []);
        expect(result.success).toBe(true);
        expect(result.commandResults).toEqual([]);
        expect(result.failureReason).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  it("commandResults preserves the issued order and length", () => {
    fc.assert(
      fc.property(fc.uuid(), logicArb, fc.array(commandResultArb, { maxLength: 12 }), (id, logic, cmds) => {
        const result = assembleExecutionResult(id, logic, cmds);
        expect(result.commandResults).toEqual(cmds);
      }),
      { numRuns: 200 },
    );
  });

  it("any failing command ⇒ success:false and failureReason references the first problem (Req 4.5, 5.7)", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        // Force logic ok so the failure is attributable to a command.
        fc.array(slotArb, { maxLength: 12 }),
        (id, slots) => {
          fc.pre(!everyPresentSucceeds(slots)); // at least one failing/missing slot
          const result = assembleExecutionResult(id, { ok: true }, slots);
          const firstProblem = slots.findIndex((r) => r == null || r.success === false);
          expect(result.success).toBe(false);
          expect(result.failureReason).toContain(String(firstProblem));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("logic failure with all commands succeeding ⇒ success:false with logic reason (Req 4.6)", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1 }),
        fc.array(commandResultArb.map((r) => ({ ...r, success: true })), { maxLength: 8 }),
        (id, logicError, cmds) => {
          const result = assembleExecutionResult(id, { ok: false, error: logicError }, cmds);
          expect(result.success).toBe(false);
          expect(result.failureReason).toBe(logicError);
        },
      ),
      { numRuns: 200 },
    );
  });
});
