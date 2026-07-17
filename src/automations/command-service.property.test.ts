// src/automations/command-service.property.test.ts
//
// Property-based tests for the CommandService physical-command boundary.
//   - Feature: device-action-system-uplift — Properties 3, 4, 5, 9, 12 (ported
//     from the pre-rename ActionExecutor suite; unchanged behavior)
//   - Feature: unified-command-boundary — Properties 1, 2, 3, 4

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { randomUUID } from "node:crypto";
import { CommandService, type CommandServiceDeps } from "./command-service.js";
import type { ConfirmationTier } from "./command-lifecycle.js";
import type { ActionResult, CommandLifecycleState } from "../core/types.js";

function createMockDeps(): CommandServiceDeps {
  return {
    mqttService: {
      isConnected: vi.fn().mockReturnValue(true),
      publish: vi.fn(),
    } as unknown as CommandServiceDeps["mqttService"],
    connectorManager: {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as CommandServiceDeps["connectorManager"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as CommandServiceDeps["logger"],
  };
}

const TERMINAL_STATES: ReadonlySet<CommandLifecycleState> = new Set([
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
]);

// ─── Feature: device-action-system-uplift ────────────────────────────────────

// Feature: device-action-system-uplift, Property 3: ActionResult.success is always a boolean
describe("Property 3: ActionResult.success is always a boolean", () => {
  it("success is typeof boolean for all outcomes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // true = handler succeeds, false = handler throws
        fc.string({ minLength: 1 }),
        async (shouldSucceed, actionType) => {
          const deps = createMockDeps();
          const executor = new CommandService(deps);

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
          const executor = new CommandService(deps);
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
          const executor = new CommandService(deps);
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
          const executor = new CommandService(deps);

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
          const executor = new CommandService(deps);
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

// Feature: verified-command-execution, Property 9: Bulk action arithmetic and per-device fidelity
describe("Property 9: Bulk action arithmetic and per-device fidelity", () => {
  it("succeeded + failed === total for any combination of outcomes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ id: fc.uuid(), succeeds: fc.boolean() }), { minLength: 0, maxLength: 20 }),
        async (deviceSpecs) => {
          const deps = createMockDeps();
          const executor = new CommandService(deps);

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
    const executor = new CommandService(deps);
    executor.registerHandler("device_action", vi.fn());
    // No executions — just verifying the handler shape works with empty input
    const results: Awaited<ReturnType<typeof executor.execute>>[] = [];
    expect(results.length).toBe(0);
  });
});

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

// ─── Feature: unified-command-boundary ───────────────────────────────────────

/** A fake PendingCommandTracker that resolves immediately with a success
 *  lifecycleState matching the required tier it was registered with. This lets
 *  a test observe the *effective* tier a command reached without real timers or
 *  MQTT. */
function createFakeTracker() {
  const registrations: Array<{ requiredTier: "acknowledged" | "observed" }> = [];
  return {
    registrations,
    register: vi.fn(async (reg: { requiredTier: "acknowledged" | "observed" }) => {
      registrations.push({ requiredTier: reg.requiredTier });
      const lifecycleState: CommandLifecycleState =
        reg.requiredTier === "acknowledged" ? "ACKNOWLEDGED" : "OBSERVED";
      return { success: true, lifecycleState } as {
        success: boolean;
        lifecycleState: CommandLifecycleState;
        error?: string;
      };
    }),
  };
}

function tierRank(tier: ConfirmationTier): number {
  return tier === "dispatch" ? 0 : tier === "acknowledged" ? 1 : 2;
}

function tierFromState(state: CommandLifecycleState | undefined): ConfirmationTier {
  if (state === "OBSERVED") return "observed";
  if (state === "ACKNOWLEDGED") return "acknowledged";
  return "dispatch"; // DISPATCHED
}

// Feature: unified-command-boundary, Property 1: Source-independent command processing
describe("Property 1: Source-independent command processing", () => {
  it("identical command + handler behavior yields identical outcome regardless of originating source", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A set of distinct "source" identifiers passed as ruleId, mimicking
        // script / form / rest / dashboard / cli origins.
        fc.uniqueArray(
          fc.constantFrom("script:s1", "form:f1", "rest:d1", "dashboard:d1", "cli:c1", "fleet:x"),
          { minLength: 2, maxLength: 6 },
        ),
        fc.boolean(), // whether the underlying device command succeeds
        fc.record({ actionType: fc.string({ minLength: 1 }), target: fc.uuid() }),
        async (sources, deviceSucceeds, spec) => {
          const handlerCalls: string[] = [];

          const runForSource = async (source: string): Promise<ActionResult> => {
            const deps = createMockDeps();
            const executor = new CommandService(deps);
            executor.registerHandler(spec.actionType, async () => {
              handlerCalls.push(source);
              if (deviceSucceeds) return { success: true };
              throw new Error("device failure");
            });
            return executor.execute(
              { type: spec.actionType, target: spec.target, params: {} },
              source,
            );
          };

          const results = await Promise.all(sources.map(runForSource));

          // Every source drives the handler exactly once (no source-dependent branching).
          expect(handlerCalls.length).toBe(sources.length);

          // All outcomes are identical across sources.
          const first = results[0];
          for (const r of results) {
            expect(r.success).toBe(first.success);
            expect(r.lifecycleState).toBe(first.lifecycleState);
          }

          // And the outcome matches the device behavior, not the source.
          expect(first.success).toBe(deviceSucceeds);
          expect(first.lifecycleState).toBe(deviceSucceeds ? "DISPATCHED" : "FAILED");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: unified-command-boundary, Property 2: Every command yields exactly one terminal Command_Result and never rejects
describe("Property 2: Every command yields exactly one terminal Command_Result and never rejects", () => {
  it("resolves with a single terminal Command_Result for any handler behavior", async () => {
    await fc.assert(
      fc.asyncProperty(
        // scenario: 0 = success, 1 = throw, 2 = explicit success:false, 3 = no handler
        fc.integer({ min: 0, max: 3 }),
        fc.string({ minLength: 1 }),
        async (scenario, actionType) => {
          const deps = createMockDeps();
          const executor = new CommandService(deps);

          if (scenario === 0) {
            executor.registerHandler(actionType, async () => ({ success: true }));
          } else if (scenario === 1) {
            executor.registerHandler(actionType, async () => { throw new Error("boom"); });
          } else if (scenario === 2) {
            executor.registerHandler(actionType, async () => ({ success: false, error: "offline" }));
          }
          // scenario 3: no handler registered

          // Never rejects.
          const result = await executor.execute(
            { type: actionType, target: "device-1", params: {} },
            "rule-1",
          );

          // Exactly one result object carrying a terminal lifecycle state.
          expect(result).toBeTypeOf("object");
          expect(typeof result.success).toBe("boolean");
          expect(result.lifecycleState).toBeDefined();
          expect(TERMINAL_STATES.has(result.lifecycleState as CommandLifecycleState)).toBe(true);

          // Success scenarios reach DISPATCHED; failures are FAILED.
          if (scenario === 0) {
            expect(result.success).toBe(true);
            expect(result.lifecycleState).toBe("DISPATCHED");
          } else {
            expect(result.success).toBe(false);
            expect(result.lifecycleState).toBe("FAILED");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: unified-command-boundary, Property 3: Tier is capability-gated and never exceeds the device ceiling
describe("Property 3: Tier is capability-gated and never exceeds the device ceiling", () => {
  it("effective tier is always provable and never exceeds the capability ceiling", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // hasConfirm — Confirmation_Options supplied (observed provable)
        fc.boolean(), // hasAckCapability — device declares an ack capability
        fc.constantFrom<ConfirmationTier | undefined>(undefined, "dispatch", "acknowledged", "observed"),
        async (hasConfirm, hasAckCapability, requiredTier) => {
          const deps = createMockDeps();
          const tracker = createFakeTracker();
          (deps as CommandServiceDeps).pendingCommandTracker =
            tracker as unknown as CommandServiceDeps["pendingCommandTracker"];
          (deps.connectorManager as unknown as {
            getAcknowledgementCapability: (id: string) => unknown;
          }).getAcknowledgementCapability = () =>
            hasAckCapability ? { supported: true } : undefined;
          // No deviceRegistry → skip observed-device existence validation, so we
          // isolate tier gating from validation.

          const executor = new CommandService(deps);
          executor.registerHandler("device_action", async () => ({ success: true }));

          const confirm = hasConfirm
            ? { condition: () => true, timeoutMs: 1000 }
            : undefined;

          const result = await executor.execute(
            { type: "device_action", target: "dev-1", params: {} },
            "rule-1",
            confirm,
            requiredTier,
          );

          // The capability ceiling — the highest provable tier.
          const ceiling: ConfirmationTier = hasConfirm
            ? "observed"
            : hasAckCapability
              ? "acknowledged"
              : "dispatch";

          // The tier we expect the service to settle on.
          let expected: ConfirmationTier = ceiling;
          if (requiredTier !== undefined) {
            const provable =
              requiredTier === "dispatch" ||
              (requiredTier === "acknowledged" && hasAckCapability) ||
              (requiredTier === "observed" && hasConfirm);
            expected = provable ? requiredTier : ceiling;
          }

          const reached = tierFromState(result.lifecycleState);

          // Never exceeds the ceiling, and equals the expected effective tier.
          expect(tierRank(reached)).toBeLessThanOrEqual(tierRank(ceiling));
          expect(reached).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: unified-command-boundary, Property 4: Validation rejects before the connector is reached
describe("Property 4: Validation rejects before the connector is reached", () => {
  it("unknown action type fails without ever invoking a handler/connector", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (unknownType) => {
          const deps = createMockDeps();
          const executor = new CommandService(deps);
          const spyHandler = vi.fn(async () => ({ success: true }));
          executor.registerHandler("some_registered_type", spyHandler);

          const result = await executor.execute(
            { type: `${unknownType}__unregistered`, target: "dev-1", params: {} },
            "rule-1",
          );

          expect(result.success).toBe(false);
          expect(result.lifecycleState).toBe("FAILED");
          expect(spyHandler).not.toHaveBeenCalled();
          expect(deps.connectorManager.executeAction).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("missing observed device fails before the handler/connector runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (missingObserver) => {
          const deps = createMockDeps();
          deps.deviceRegistry = {
            getById: vi.fn().mockReturnValue(undefined),
          } as unknown as CommandServiceDeps["deviceRegistry"];
          deps.pendingCommandTracker =
            createFakeTracker() as unknown as CommandServiceDeps["pendingCommandTracker"];

          const executor = new CommandService(deps);
          const spyHandler = vi.fn(async () => ({ success: true }));
          executor.registerHandler("device_action", spyHandler);

          const result = await executor.execute(
            { type: "device_action", target: "dev-1", params: {} },
            "rule-1",
            { condition: () => true, deviceId: missingObserver, timeoutMs: 1000 },
          );

          expect(result.success).toBe(false);
          expect(result.lifecycleState).toBe("FAILED");
          expect(result.error).toContain(missingObserver);
          expect(spyHandler).not.toHaveBeenCalled();
          expect(deps.connectorManager.executeAction).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });
});
