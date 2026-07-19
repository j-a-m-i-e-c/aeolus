// src/automations/pending-command-tracker.property.test.ts
// Feature: verified-command-execution — Properties 8, 13, 14, 15

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { PendingCommandTracker, type PendingCommand } from "./pending-command-tracker.js";
import { resolveCorrelationId } from "../mqtt/mqtt-service.js";

// ─── Property 8: Confirmation resolves to the correct terminal state ─────────

// Feature: verified-command-execution, Property 8: Confirmation resolves to the correct terminal state
describe("Property 8: Confirmation resolves to the correct terminal state", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("satisfied predicate → OBSERVED/success", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (correlationId) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "observed",
            condition: (state) => state.running === true,
            timeoutMs: 5000,
          };

          const promise = tracker.register(cmd);
          tracker.route({ correlationId, status: "executed", state: { running: true } });

          const result = await promise;
          expect(result.lifecycleState).toBe("OBSERVED");
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("settled mismatch → STATE_MISMATCH/failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (correlationId) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "observed",
            condition: (state) => state.running === true,
            timeoutMs: 5000,
          };

          const promise = tracker.register(cmd);
          // A settled (correlated) observation that fails the predicate
          tracker.route({ correlationId, status: "executed", state: { running: false } });

          const result = await promise;
          expect(result.lifecycleState).toBe("STATE_MISMATCH");
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("predicate throws → FAILED/failure with error message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 1 }),
        async (correlationId, errorMsg) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "observed",
            condition: () => { throw new Error(errorMsg); },
            timeoutMs: 5000,
          };

          const promise = tracker.register(cmd);
          tracker.route({ correlationId, state: { anything: true } });

          // flush microtask queue so the resolved promise settles
          await vi.advanceTimersByTimeAsync(0);

          const result = await promise;
          expect(result.lifecycleState).toBe("FAILED");
          expect(result.success).toBe(false);
          expect(result.error).toBe(errorMsg);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no observation before timeout → TIMED_OUT/failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 100, max: 10000 }),
        async (correlationId, timeoutMs) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "observed",
            condition: (state) => state.on === true,
            timeoutMs,
          };

          const promise = tracker.register(cmd);
          vi.advanceTimersByTime(timeoutMs + 1);

          const result = await promise;
          expect(result.lifecycleState).toBe("TIMED_OUT");
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 13: Correlation id resolution honors source precedence ─────────

// Feature: verified-command-execution, Property 13: Correlation id resolution honors source precedence
describe("Property 13: Correlation id resolution honors source precedence", () => {
  it("prefers MQTT 5 Correlation Data when present", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (mqtt5Id, payloadId) => {
          const result = resolveCorrelationId(
            Buffer.from(mqtt5Id, "utf8"),
            payloadId,
          );
          expect(result).toBe(mqtt5Id);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("falls back to payload correlationId when MQTT 5 property is absent", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (payloadId) => {
          const result = resolveCorrelationId(undefined, payloadId);
          expect(result).toBe(payloadId);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns undefined when neither is present", () => {
    expect(resolveCorrelationId(undefined, undefined)).toBeUndefined();
    expect(resolveCorrelationId(undefined, "")).toBeUndefined();
    expect(resolveCorrelationId(Buffer.alloc(0), undefined)).toBeUndefined();
  });
});

// ─── Property 14: Correlated acknowledgement drives the ACKNOWLEDGED transition ─

// Feature: verified-command-execution, Property 14: Correlated acknowledgement drives the ACKNOWLEDGED transition, including combined satisfaction
describe("Property 14: Correlated acknowledgement drives ACKNOWLEDGED transition", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("ack message advances to ACKNOWLEDGED for ack-tier commands", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 1 }),
        async (correlationId, statusValue) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "acknowledged",
            timeoutMs: 5000,
          };

          const promise = tracker.register(cmd);
          tracker.route({ correlationId, status: statusValue });

          const result = await promise;
          expect(result.lifecycleState).toBe("ACKNOWLEDGED");
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("single message satisfying both ack and observation drives OBSERVED", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (correlationId) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "observed",
            condition: (state) => state.active === true,
            timeoutMs: 5000,
          };

          const promise = tracker.register(cmd);
          // Single message with both ack indicator and satisfying state
          tracker.route({ correlationId, status: "executed", state: { active: true } });

          const result = await promise;
          expect(result.lifecycleState).toBe("OBSERVED");
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 15: Late and duplicate acknowledgements are idempotent ─────────

// Feature: verified-command-execution, Property 15: Late and duplicate acknowledgements are idempotent
describe("Property 15: Late and duplicate acknowledgements are idempotent", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("duplicate acks of the same tier do not re-resolve", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 2, max: 10 }),
        async (correlationId, duplicateCount) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "acknowledged",
            timeoutMs: 5000,
          };

          const promise = tracker.register(cmd);
          // Send many acks
          for (let i = 0; i < duplicateCount; i++) {
            tracker.route({ correlationId, status: "executed" });
          }

          const result = await promise;
          expect(result.lifecycleState).toBe("ACKNOWLEDGED");
          expect(result.success).toBe(true);
          // The command should be removed from the tracker
          expect(tracker.has(correlationId)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("messages after terminal state are ignored (late arrivals)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (correlationId) => {
          const lateMessageIds: string[] = [];
          const tracker = new PendingCommandTracker({
            onLateMessage: (id) => lateMessageIds.push(id),
          });
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "acknowledged",
            timeoutMs: 5000,
          };

          const promise = tracker.register(cmd);
          tracker.route({ correlationId, status: "executed" });
          await promise;

          // Late message — should not cause any error
          tracker.route({ correlationId, status: "executed-again" });
          expect(lateMessageIds).toContain(correlationId);
          expect(tracker.has(correlationId)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("messages after timeout are ignored", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (correlationId) => {
          const lateMessages: string[] = [];
          const tracker = new PendingCommandTracker({
            onLateMessage: (id) => lateMessages.push(id),
          });
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "observed",
            condition: () => true,
            timeoutMs: 1000,
          };

          const promise = tracker.register(cmd);
          vi.advanceTimersByTime(1001);
          const result = await promise;
          expect(result.lifecycleState).toBe("TIMED_OUT");

          // Late message after timeout
          tracker.route({ correlationId, status: "executed", state: { on: true } });
          expect(lateMessages).toContain(correlationId);
        },
      ),
      { numRuns: 200 },
    );
  });
});


// ─── Property 17: Pending-command cancellation is idempotent and settles the awaiter ─

// Feature: verified-command-execution, Property 17: Pending-command cancellation is idempotent and settles the awaiter
describe("Property 17: Pending-command cancellation is idempotent and settles the awaiter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /**
   * **Validates: Requirements 12.4, 12.5**
   *
   * For any registered Pending_Command, calling cancel() clears its timer,
   * removes it from the tracker, and settles its register() promise with a
   * FAILED/success:false resolution; a subsequent cancel() or any late routed
   * message for that correlation id causes no further transition and does not
   * re-settle.
   */
  it("cancel settles the awaiter with FAILED/success:false and removes from tracker", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 100, max: 10000 }),
        async (correlationId, timeoutMs) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "acknowledged",
            timeoutMs,
          };

          const sizeBefore = tracker.size;
          const promise = tracker.register(cmd);
          expect(tracker.size).toBe(sizeBefore + 1);
          expect(tracker.has(correlationId)).toBe(true);

          // Cancel the pending command
          tracker.cancel(correlationId);

          const result = await promise;
          // Assertion 1: resolution settles with FAILED/success:false
          expect(result.lifecycleState).toBe("FAILED");
          expect(result.success).toBe(false);
          // Assertion 2: tracker no longer has the correlationId
          expect(tracker.has(correlationId)).toBe(false);
          // Assertion 3: tracker.size decreased back
          expect(tracker.size).toBe(sizeBefore);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a second cancel is a no-op (no throw, no re-settle)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 100, max: 10000 }),
        async (correlationId, timeoutMs) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "acknowledged",
            timeoutMs,
          };

          const promise = tracker.register(cmd);
          tracker.cancel(correlationId);
          const result = await promise;
          expect(result.lifecycleState).toBe("FAILED");
          expect(result.success).toBe(false);

          // Assertion 4: second cancel is a no-op — no throw
          expect(() => tracker.cancel(correlationId)).not.toThrow();
          expect(tracker.has(correlationId)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("route after cancel is a no-op (no throw, no re-settle)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 100, max: 10000 }),
        async (correlationId, timeoutMs) => {
          const lateMessages: string[] = [];
          const tracker = new PendingCommandTracker({
            onLateMessage: (id) => lateMessages.push(id),
          });
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "acknowledged",
            timeoutMs,
          };

          const promise = tracker.register(cmd);
          tracker.cancel(correlationId);
          const result = await promise;
          expect(result.lifecycleState).toBe("FAILED");
          expect(result.success).toBe(false);

          // Assertion 5: route after cancel is a no-op — no throw
          expect(() =>
            tracker.route({ correlationId, status: "executed" }),
          ).not.toThrow();
          // The late message callback fires for the unknown id
          expect(lateMessages).toContain(correlationId);
          // Tracker state unchanged
          expect(tracker.has(correlationId)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("timeout does not fire after cancel (timer cleared)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 100, max: 10000 }),
        async (correlationId, timeoutMs) => {
          const tracker = new PendingCommandTracker();
          const cmd: PendingCommand = {
            correlationId,
            targetDeviceId: "device-1",
            observedDeviceId: "device-1",
            requiredTier: "acknowledged",
            timeoutMs,
          };

          const promise = tracker.register(cmd);
          tracker.cancel(correlationId);
          const result = await promise;
          expect(result.lifecycleState).toBe("FAILED");

          // Advance past the original timeout — nothing should break or re-settle
          vi.advanceTimersByTime(timeoutMs + 1);
          expect(tracker.has(correlationId)).toBe(false);
          expect(tracker.size).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Example test: fast ack delivered before dispatch completes is matched ────

describe("Example: fast ack arriving after register but before dispatch-handler completes is matched", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /**
   * **Validates: Requirements 12.3**
   *
   * Register a command with requiredTier: "acknowledged". Immediately (before
   * awaiting the resolution) call tracker.route() with a matching ack. Await
   * the resolution: should be { lifecycleState: "ACKNOWLEDGED", success: true }.
   * This proves the register-before-dispatch fix works — the entry exists when
   * the fast ack arrives.
   */
  it("a fast ack arriving after register but before dispatch completes is matched", async () => {
    const tracker = new PendingCommandTracker();
    const correlationId = "fast-ack-test-id";
    const cmd: PendingCommand = {
      correlationId,
      targetDeviceId: "device-1",
      observedDeviceId: "device-1",
      requiredTier: "acknowledged",
      timeoutMs: 5000,
    };

    // Step 1: Register the command (simulates register-before-dispatch)
    const promise = tracker.register(cmd);

    // Step 2: Immediately route an ack (simulates a fast device reply arriving
    // before the dispatch handler finishes — the entry already exists)
    tracker.route({ correlationId, status: "ok" });

    // Step 3: Await the resolution — should succeed without timeout
    const result = await promise;
    expect(result.lifecycleState).toBe("ACKNOWLEDGED");
    expect(result.success).toBe(true);

    // The entry is cleaned up
    expect(tracker.has(correlationId)).toBe(false);
  });
});
