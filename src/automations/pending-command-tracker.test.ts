// src/automations/pending-command-tracker.test.ts — Branch coverage for PendingCommandTracker

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PendingCommandTracker, type PendingCommand } from "./pending-command-tracker.js";

describe("PendingCommandTracker branch coverage", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe("observeState", () => {
    it("ignores state for non-matching deviceId", async () => {
      const tracker = new PendingCommandTracker();
      const cmd: PendingCommand = {
        correlationId: "c1",
        targetDeviceId: "dev-1",
        observedDeviceId: "dev-1",
        requiredTier: "observed",
        condition: (s) => s.on === true,
        timeoutMs: 5000,
      };
      const promise = tracker.register(cmd);

      // Different device — should not resolve
      tracker.observeState("dev-other", { on: true });
      expect(tracker.has("c1")).toBe(true);

      // Correct device — resolves
      tracker.observeState("dev-1", { on: true });
      const result = await promise;
      expect(result.lifecycleState).toBe("OBSERVED");
    });

    it("ignores observeState for acknowledged-tier commands", async () => {
      const tracker = new PendingCommandTracker();
      const cmd: PendingCommand = {
        correlationId: "c1",
        targetDeviceId: "dev-1",
        observedDeviceId: "dev-1",
        requiredTier: "acknowledged",
        timeoutMs: 5000,
      };
      const promise = tracker.register(cmd);

      // observeState should not resolve an ack-tier command
      tracker.observeState("dev-1", { on: true });
      expect(tracker.has("c1")).toBe(true);

      // Route an ack to resolve it
      tracker.route({ correlationId: "c1", status: "ok" });
      const result = await promise;
      expect(result.lifecycleState).toBe("ACKNOWLEDGED");
    });
  });

  describe("ackIndicatorValues filtering", () => {
    it("only matches specified ack indicator values", async () => {
      const tracker = new PendingCommandTracker();
      const cmd: PendingCommand = {
        correlationId: "c1",
        targetDeviceId: "dev-1",
        observedDeviceId: "dev-1",
        requiredTier: "acknowledged",
        timeoutMs: 5000,
        ackIndicatorValues: ["executed", "done"],
      };
      const promise = tracker.register(cmd);

      // "pending" is not in the allowed values — should not resolve
      tracker.route({ correlationId: "c1", status: "pending" });
      expect(tracker.has("c1")).toBe(true);

      // "executed" is allowed — should resolve
      tracker.route({ correlationId: "c1", status: "executed" });
      const result = await promise;
      expect(result.lifecycleState).toBe("ACKNOWLEDGED");
    });

    it("rejects empty status as non-ack", async () => {
      const tracker = new PendingCommandTracker();
      const cmd: PendingCommand = {
        correlationId: "c1",
        targetDeviceId: "dev-1",
        observedDeviceId: "dev-1",
        requiredTier: "acknowledged",
        timeoutMs: 1000,
      };
      const promise = tracker.register(cmd);

      // Empty status — should not be treated as ack
      tracker.route({ correlationId: "c1", status: "" });
      expect(tracker.has("c1")).toBe(true);

      vi.advanceTimersByTime(1001);
      const result = await promise;
      expect(result.lifecycleState).toBe("TIMED_OUT");
    });
  });

  describe("route with no condition (observed tier)", () => {
    it("state message with no condition does not resolve", async () => {
      const tracker = new PendingCommandTracker();
      const cmd: PendingCommand = {
        correlationId: "c1",
        targetDeviceId: "dev-1",
        observedDeviceId: "dev-1",
        requiredTier: "observed",
        // No condition set
        timeoutMs: 1000,
      };
      const promise = tracker.register(cmd);

      // Route with state but no condition — evaluateObservation returns early
      tracker.route({ correlationId: "c1", state: { on: true } });
      expect(tracker.has("c1")).toBe(true);

      vi.advanceTimersByTime(1001);
      const result = await promise;
      expect(result.lifecycleState).toBe("TIMED_OUT");
    });
  });

  describe("route to unknown correlation id", () => {
    it("calls onLateMessage for unknown ids", () => {
      const lateIds: string[] = [];
      const tracker = new PendingCommandTracker({
        onLateMessage: (id) => lateIds.push(id),
      });

      tracker.route({ correlationId: "unknown-id", status: "executed" });
      expect(lateIds).toContain("unknown-id");
    });
  });

  describe("has and size", () => {
    it("returns correct size and has status", async () => {
      const tracker = new PendingCommandTracker();
      expect(tracker.size).toBe(0);
      expect(tracker.has("c1")).toBe(false);

      const cmd: PendingCommand = {
        correlationId: "c1",
        targetDeviceId: "dev-1",
        observedDeviceId: "dev-1",
        requiredTier: "acknowledged",
        timeoutMs: 5000,
      };
      tracker.register(cmd);
      expect(tracker.size).toBe(1);
      expect(tracker.has("c1")).toBe(true);

      tracker.route({ correlationId: "c1", status: "done" });
      await vi.advanceTimersByTimeAsync(0);
      expect(tracker.size).toBe(0);
      expect(tracker.has("c1")).toBe(false);
    });
  });
});
