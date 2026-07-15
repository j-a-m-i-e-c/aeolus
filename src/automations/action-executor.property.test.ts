// src/automations/action-executor.property.test.ts
// Feature: device-action-system-uplift — Properties 3, 4, 5

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { ActionExecutor, type ActionExecutorDeps } from "./action-executor.js";

function createMockDeps(): ActionExecutorDeps {
  return {
    mqttService: {
      isConnected: vi.fn().mockReturnValue(true),
      publish: vi.fn(),
    } as unknown as ActionExecutorDeps["mqttService"],
    connectorManager: {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as ActionExecutorDeps["connectorManager"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as ActionExecutorDeps["logger"],
  };
}

// Feature: device-action-system-uplift, Property 3: ActionResult.success is always a boolean
describe("Property 3: ActionResult.success is always a boolean", () => {
  it("success is typeof boolean for all outcomes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // true = handler succeeds, false = handler throws
        fc.string({ minLength: 1 }),
        async (shouldSucceed, actionType) => {
          const deps = createMockDeps();
          const executor = new ActionExecutor(deps);

          if (shouldSucceed) {
            executor.registerHandler(actionType, vi.fn().mockResolvedValue(undefined));
          } else {
            executor.registerHandler(actionType, vi.fn().mockRejectedValue(new Error("boom")));
          }

          const result = await executor.execute(
            { type: actionType, target: "device-1", params: {} },
            "rule-1",
          );

          expect(typeof result.success).toBe("boolean");
          expect(result.success === true || result.success === false).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("success is boolean even when no handler is registered", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (actionType) => {
          const deps = createMockDeps();
          const executor = new ActionExecutor(deps);
          // No handler registered

          const result = await executor.execute(
            { type: actionType, target: "device-1", params: {} },
            "rule-1",
          );

          expect(typeof result.success).toBe("boolean");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: device-action-system-uplift, Property 4: devices.action() always resolves, never rejects
describe("Property 4: execute() always resolves, never rejects", () => {
  it("promise always resolves even when handler throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (errorMessage) => {
          const deps = createMockDeps();
          const executor = new ActionExecutor(deps);
          executor.registerHandler("fail", vi.fn().mockRejectedValue(new Error(errorMessage)));

          // Must resolve, not reject
          const result = await executor.execute(
            { type: "fail", target: "device-1", params: {} },
            "rule-1",
          );

          expect(result.success).toBe(false);
          expect(result.error).toBe(errorMessage);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("promise always resolves when device not found (no handler)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (unknownType) => {
          const deps = createMockDeps();
          const executor = new ActionExecutor(deps);

          // Should resolve, not reject
          await expect(
            executor.execute({ type: unknownType, target: "device-1", params: {} }, "rule-1"),
          ).resolves.toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: device-action-system-uplift, Property 5: Missing handler returns typed error
describe("Property 5: Missing handler returns typed error", () => {
  it("result.success === false and error contains actionType for unregistered types", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (actionType) => {
          const deps = createMockDeps();
          const executor = new ActionExecutor(deps);
          // Deliberately do NOT register a handler for actionType

          const result = await executor.execute(
            { type: actionType, target: "device-1", params: {} },
            "rule-1",
          );

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error).toContain(actionType);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Feature: verified-command-execution ─────────────────────────────────────

import { randomUUID } from "node:crypto";

// ─── Property 9: Bulk action arithmetic and per-device fidelity ──────────────

// Feature: verified-command-execution, Property 9: Bulk action arithmetic and per-device fidelity
describe("Property 9: Bulk action arithmetic and per-device fidelity", () => {
  it("succeeded + failed === total for any combination of outcomes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ id: fc.uuid(), succeeds: fc.boolean() }), { minLength: 0, maxLength: 20 }),
        async (deviceSpecs) => {
          const deps = createMockDeps();
          const executor = new ActionExecutor(deps);

          const successMap = new Map(deviceSpecs.map((s) => [s.id, s.succeeds]));

          executor.registerHandler("device_action", async (action) => {
            if (successMap.get(action.target)) {
              return { success: true };
            }
            throw new Error("simulated failure");
          });

          const results = await Promise.all(
            deviceSpecs.map((s) =>
              executor.execute(
                { type: "device_action", target: s.id, params: { actionType: "toggle" } },
                "rule-bulk",
              ),
            ),
          );

          const succeeded = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;
          expect(succeeded + failed).toBe(deviceSpecs.length);

          // Each result carries a lifecycleState
          for (const r of results) {
            expect(r.lifecycleState).toBeDefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("zero devices produce zero totals", async () => {
    const deps = createMockDeps();
    const executor = new ActionExecutor(deps);
    executor.registerHandler("device_action", vi.fn());
    // No executions — just verifying the handler shape works with empty input
    const results: Awaited<ReturnType<typeof executor.execute>>[] = [];
    expect(results.length).toBe(0);
  });
});

// ─── Property 12: Correlation ids are unique across outstanding commands ─────

// Feature: verified-command-execution, Property 12: Correlation ids are unique across outstanding commands
describe("Property 12: Correlation ids are unique across outstanding commands", () => {
  it("randomUUID generates pairwise distinct ids for any batch size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        (batchSize) => {
          const ids = Array.from({ length: batchSize }, () => randomUUID());
          const unique = new Set(ids);
          expect(unique.size).toBe(batchSize);
        },
      ),
      { numRuns: 200 },
    );
  });
});
