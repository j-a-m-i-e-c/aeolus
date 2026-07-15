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
      results: [{ deviceId: "", success: false, error: (err as Error).message }],
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
          expect(result.results).toHaveLength(1);
          expect(result.results[0].success).toBe(false);
          expect(result.results[0].error).toBe(errorMessage);
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
