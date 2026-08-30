// src/automations/sandbox.property.test.ts
// Feature: device-action-system-uplift — Properties 12, 13

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ActionResult, BulkActionResult, Device } from "../core/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate the __actionAllRef logic directly (without isolated-vm) so we can
 * property-test the aggregation arithmetic and dispatch filtering in isolation.
 */
async function simulateActionAll(
  devices: Device[],
  filter: (device: Device) => boolean,
  executeAction: (deviceId: string) => Promise<ActionResult>,
): Promise<BulkActionResult> {
  // Catch predicate throws
  let matched: Device[];
  try {
    matched = devices.filter(filter);
  } catch (err) {
    return {
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      error: (err as Error).message,
    };
  }

  if (matched.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  const settled = await Promise.allSettled(
    matched.map((device) =>
      executeAction(device.id)
        .then((result): { deviceId: string } & ActionResult => ({ deviceId: device.id, ...result }))
        .catch((err): { deviceId: string } & ActionResult => ({
          deviceId: device.id,
          success: false,
          error: (err as Error).message,
        })),
    ),
  );

  const results = settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : { deviceId: "", success: false as const, error: String(s.reason) },
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return { total: results.length, succeeded, failed, results };
}

function makeDevice(id: string): Device {
  return {
    id,
    name: `Device ${id}`,
    type: "light",
    capabilities: [],
    state: {},
    integration: "mock",
    lastSeen: Date.now(),
  };
}

// ─── Property 12: BulkActionResult arithmetic invariant ──────────────────────

// Feature: device-action-system-uplift, Property 12: BulkActionResult arithmetic invariant
describe("Property 12: BulkActionResult arithmetic invariant", () => {
  it("succeeded + failed === total for any mix of success/failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ id: fc.uuid(), succeeds: fc.boolean() }),
          { minLength: 0, maxLength: 20 },
        ),
        async (deviceSpecs) => {
          const devices = deviceSpecs.map((s) => makeDevice(s.id));
          const successMap = new Map(deviceSpecs.map((s) => [s.id, s.succeeds]));

          const executeAction = async (deviceId: string): Promise<ActionResult> => {
            if (successMap.get(deviceId)) {
              return { success: true };
            }
            return { success: false, error: "simulated failure" };
          };

          const result = await simulateActionAll(devices, () => true, executeAction);

          expect(result.succeeded + result.failed).toBe(result.total);
          expect(result.total).toBe(devices.length);
          expect(result.results).toHaveLength(result.total);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("total === 0 when filter matches nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }).map((ids) => ids.map(makeDevice)),
        async (devices) => {
          const result = await simulateActionAll(devices, () => false, async () => ({ success: true }));
          expect(result.total).toBe(0);
          expect(result.succeeded).toBe(0);
          expect(result.failed).toBe(0);
          expect(result.results).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns error result when filter predicate throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (errorMessage) => {
          const devices = [makeDevice("d1"), makeDevice("d2")];
          const result = await simulateActionAll(
            devices,
            () => { throw new Error(errorMessage); },
            async () => ({ success: true }),
          );

          expect(result.total).toBe(0);
          expect(result.succeeded).toBe(0);
          expect(result.failed).toBe(0);
          expect(result.results).toHaveLength(0);
          expect(result.error).toBe(errorMessage);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 13: actionAll dispatches only to filter-matched devices ─────────

// Feature: device-action-system-uplift, Property 13: actionAll dispatches only to filter-matched devices
describe("Property 13: actionAll dispatches only to filter-matched devices", () => {
  it("only predicate-matching devices receive dispatch", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ id: fc.uuid(), matches: fc.boolean() }),
          { minLength: 1, maxLength: 15 },
        ),
        async (deviceSpecs) => {
          const devices = deviceSpecs.map((s) => makeDevice(s.id));
          const matchMap = new Map(deviceSpecs.map((s) => [s.id, s.matches]));
          const dispatched = new Set<string>();

          const executeAction = async (deviceId: string): Promise<ActionResult> => {
            dispatched.add(deviceId);
            return { success: true };
          };

          await simulateActionAll(
            devices,
            (d) => matchMap.get(d.id) ?? false,
            executeAction,
          );

          const expectedMatched = deviceSpecs.filter((s) => s.matches).map((s) => s.id);
          const expectedNotMatched = deviceSpecs.filter((s) => !s.matches).map((s) => s.id);

          // All matched devices were dispatched
          for (const id of expectedMatched) {
            expect(dispatched.has(id)).toBe(true);
          }

          // No non-matched devices were dispatched
          for (const id of expectedNotMatched) {
            expect(dispatched.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Feature: verified-command-execution ─────────────────────────────────────

import { classifySandboxError, type SandboxFailureReason } from "./sandbox.js";

// ─── Property 1: Sandbox error classification is accurate and honors precedence ─────

// Feature: verified-command-execution, Property 1: Sandbox error classification is accurate and honors precedence
describe("Property 1: Sandbox error classification is accurate and honors precedence", () => {
  it("timeout signature always classifies as timeout regardless of disposal", () => {
    fc.assert(
      fc.property(
        fc.boolean(), // isolateWasDisposed
        fc.constantFrom(
          "Script execution timed out",
          "execution timed out after 5000ms",
          "TIMED OUT",
        ),
        (disposed, message) => {
          const result = classifySandboxError(new Error(message), disposed);
          expect(result.reason).toBe("timeout");
          expect(result.error).toBe(message);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("memory signature classifies as memory when no timeout signature", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "memory limit reached",
          "Array buffer allocation failed",
          "Isolate was disposed",
        ),
        fc.boolean(),
        (message, disposed) => {
          const result = classifySandboxError(new Error(message), disposed);
          expect(result.reason).toBe("memory");
          expect(result.error).toBe(message);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("isolateWasDisposed=true classifies as memory when no timeout signature", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !/timed out/i.test(s) && !/memory limit|array buffer allocation failed|disposed/i.test(s)),
        (message) => {
          const result = classifySandboxError(new Error(message), true);
          expect(result.reason).toBe("memory");
          expect(result.error).toBe(message);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("any other error classifies as runtime", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !/timed out/i.test(s) && !/memory limit|array buffer allocation failed|disposed/i.test(s)),
        (message) => {
          const result = classifySandboxError(new Error(message), false);
          expect(result.reason).toBe("runtime");
          expect(result.error).toBe(message);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("error string is always non-empty and equals the original message", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.boolean(),
        (message, disposed) => {
          const result = classifySandboxError(new Error(message), disposed);
          expect(result.error).toBe(message);
          expect(result.error.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("timeout precedence wins over memory (timeout signature + disposal)", () => {
    // When both timeout and memory signatures apply, timeout wins (chronological first)
    const result = classifySandboxError(new Error("Script execution timed out"), true);
    expect(result.reason).toBe("timeout");
  });
});

// ─── Property 2: Sandbox execution always resolves ───────────────────────────

// Feature: verified-command-execution, Property 2: Sandbox execution always resolves
describe("Property 2: Sandbox execution always resolves", () => {
  it("classifySandboxError always returns a valid reason and never throws", () => {
    fc.assert(
      fc.property(
        fc.string(), // arbitrary error message (including empty)
        fc.boolean(), // isolateWasDisposed
        (message, disposed) => {
          // Should never throw
          const result = classifySandboxError(new Error(message), disposed);
          const validReasons: SandboxFailureReason[] = ["runtime", "timeout", "memory"];
          expect(validReasons).toContain(result.reason);
          expect(typeof result.error).toBe("string");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Feature: command-completion-tier ────────────────────────────────────────

import { dispatchScriptAction, describeTierValue } from "./sandbox.js";
import type { ActionDescriptor } from "./command-service.js";
import type { ConfirmationTier } from "./command-lifecycle.js";

/** The three valid completion tiers. */
const VALID_TIERS: ConfirmationTier[] = ["dispatch", "acknowledged", "observed"];

/** A minimal stand-in for CommandService.execute that records its calls. */
interface ExecuteCall {
  descriptor: ActionDescriptor;
  ruleId: string;
  requiredTier: ConfirmationTier | undefined;
}
function makeExecuteSpy() {
  const calls: ExecuteCall[] = [];
  const execute = async (
    descriptor: ActionDescriptor,
    ruleId: string,
    _confirm?: unknown,
    requiredTier?: ConfirmationTier,
  ): Promise<ActionResult> => {
    calls.push({ descriptor, ruleId, requiredTier });
    return { success: true, lifecycleState: "DISPATCHED" };
  };
  return { calls, execute: execute as never };
}

const descriptor: ActionDescriptor = { type: "device_action", target: "d1", params: { actionType: "toggle" } };

/**
 * Non-tier values (never one of dispatch/acknowledged/observed). `undefined` is
 * excluded because it means "no tier supplied", not an invalid tier.
 */
const nonTierArb: fc.Arbitrary<unknown> = fc
  .oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.constantFrom("DISPATCH", "Observed", "ack", "verified", ""),
    fc.object(),
  )
  .filter((v) => !VALID_TIERS.includes(v as ConfirmationTier));

// Feature: command-completion-tier, Property 5: An invalid script tier fails validation without dispatching
describe("Property 5: An invalid script tier fails validation without dispatching", () => {
  it("an invalid per-call tier fails without invoking execute, naming the invalid value", async () => {
    await fc.assert(
      fc.asyncProperty(nonTierArb, async (perCallTier) => {
        const spy = makeExecuteSpy();
        const result = await dispatchScriptAction(
          { execute: spy.execute },
          descriptor,
          "rule-1",
          undefined,
          perCallTier,
        );

        expect(result.success).toBe(false);
        expect(spy.calls).toHaveLength(0); // never dispatched
        expect(result.lifecycleState).toBe("FAILED");
        expect(result.error).toContain(describeTierValue(perCallTier));
      }),
      { numRuns: 200 },
    );
  });

  it("a valid per-call tier is passed through to execute unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<ConfirmationTier>(...VALID_TIERS),
        async (perCallTier) => {
          const spy = makeExecuteSpy();
          const result = await dispatchScriptAction(
            { execute: spy.execute },
            descriptor,
            "rule-1",
            undefined,
            perCallTier,
          );

          expect(result.success).toBe(true);
          expect(spy.calls).toHaveLength(1);
          // The per-call tier is the only tier an automation states (Req 5.1, 5.2).
          expect(spy.calls[0].requiredTier).toBe(perCallTier);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no per-call tier omits requiredTier so the boundary picks highest-available", async () => {
    const spy = makeExecuteSpy();
    const result = await dispatchScriptAction(
      { execute: spy.execute },
      descriptor,
      "rule-1",
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(spy.calls).toHaveLength(1);
    // Absent ⇒ each device independently resolves to its own provable maximum (Req 5.3).
    expect(spy.calls[0].requiredTier).toBeUndefined();
  });
});


// ─── Task 15.4: Example tests for planAutomationBody and shouldStopAfter ─────
// Validates: Requirements 11.2, 11.5, 11.6

import { planAutomationBody, shouldStopAfter } from "./sandbox.js";

describe("planAutomationBody — example tests", () => {
  it("with all-success outcomes includes all indices and aggregateSuccess is true", () => {
    const outcomes = [
      { success: true },
      { success: true },
      { success: true },
      { success: true },
      { success: true },
    ];
    const plan = planAutomationBody(outcomes, false);
    expect(plan.invokedIndices).toEqual([0, 1, 2, 3, 4]);
    expect(plan.aggregateSuccess).toBe(true);
  });

  it("with a failure at index 2 of 5 stops at index 2 when continueOnFailure=false", () => {
    const outcomes = [
      { success: true },
      { success: true },
      { success: false },
      { success: true },
      { success: true },
    ];
    const plan = planAutomationBody(outcomes, false);
    expect(plan.invokedIndices).toEqual([0, 1, 2]);
    expect(plan.aggregateSuccess).toBe(false);
  });

  it("with a failure at index 2 of 5 includes all 5 when continueOnFailure=true and aggregateSuccess is false", () => {
    const outcomes = [
      { success: true },
      { success: true },
      { success: false },
      { success: true },
      { success: true },
    ];
    const plan = planAutomationBody(outcomes, true);
    expect(plan.invokedIndices).toEqual([0, 1, 2, 3, 4]);
    expect(plan.aggregateSuccess).toBe(false);
  });

  it("with empty outcomes returns empty invokedIndices and aggregateSuccess=true", () => {
    const plan = planAutomationBody([], false);
    expect(plan.invokedIndices).toEqual([]);
    expect(plan.aggregateSuccess).toBe(true);
  });
});

describe("shouldStopAfter — example tests", () => {
  it("returns true for failed outcome with continueOnFailure=false", () => {
    expect(shouldStopAfter({ success: false }, false)).toBe(true);
  });

  it("returns false for failed outcome with continueOnFailure=true", () => {
    expect(shouldStopAfter({ success: false }, true)).toBe(false);
  });

  it("returns false for success outcome regardless of continueOnFailure", () => {
    expect(shouldStopAfter({ success: true }, false)).toBe(false);
    expect(shouldStopAfter({ success: true }, true)).toBe(false);
  });
});


// ─── Property 16: Fail-fast action ordering ──────────────────────────────────

// Feature: verified-command-execution, Property 16: Fail-fast action ordering
describe("Property 16: Fail-fast action ordering", () => {
  it("runner invokes actions in order and respects fail-fast / continueOnFailure semantics", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ success: fc.boolean() }), { minLength: 1 }),
        fc.boolean(),
        (outcomes, continueOnFailure) => {
          const plan = planAutomationBody(outcomes, continueOnFailure);

          // invokedIndices are sequential starting from 0
          for (let i = 0; i < plan.invokedIndices.length; i++) {
            expect(plan.invokedIndices[i]).toBe(i);
          }

          const firstFailureIndex = outcomes.findIndex((o) => !o.success);

          if (!continueOnFailure) {
            // When continueOnFailure=false: if any outcome is false, no index
            // after the first failure is included; the last invokedIndex is the
            // index of the first failure.
            if (firstFailureIndex !== -1) {
              expect(plan.invokedIndices[plan.invokedIndices.length - 1]).toBe(firstFailureIndex);
              expect(plan.invokedIndices.length).toBe(firstFailureIndex + 1);
            } else {
              // All succeeded — all indices invoked
              expect(plan.invokedIndices.length).toBe(outcomes.length);
            }
          } else {
            // When continueOnFailure=true: invokedIndices covers ALL indices (0..length-1)
            expect(plan.invokedIndices.length).toBe(outcomes.length);
            for (let i = 0; i < outcomes.length; i++) {
              expect(plan.invokedIndices[i]).toBe(i);
            }
          }

          // aggregateSuccess is true only when all invoked outcomes have success=true
          const allInvokedSucceeded = plan.invokedIndices.every(
            (idx) => outcomes[idx].success,
          );
          expect(plan.aggregateSuccess).toBe(allInvokedSucceeded);
        },
      ),
      { numRuns: 200 },
    );
  });
});
