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
