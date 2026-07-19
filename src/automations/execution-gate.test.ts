// src/automations/execution-gate.test.ts — Unit tests for ExecutionGate

import { describe, it, expect, vi } from "vitest";
import { ExecutionGate } from "./execution-gate.js";
import type { ExecutionRequest } from "./execution-gate.js";

function makeRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    ruleId: overrides.ruleId ?? "rule-1",
    deviceId: overrides.deviceId ?? "device-1",
    topic: overrides.topic ?? "sensors/temp",
    execute: overrides.execute ?? (() => new Promise(() => {})), // never resolves by default
  };
}

describe("ExecutionGate", () => {
  describe("submit — admission", () => {
    it("admits immediately when below maxActive", () => {
      const gate = new ExecutionGate({ maxActive: 2 });
      const result = gate.submit(makeRequest());
      expect(result.status).toBe("admitted");
      expect((result as { handle: string }).handle).toBeDefined();
    });

    it("returns a unique handle per admitted request", () => {
      const gate = new ExecutionGate({ maxActive: 5 });
      const r1 = gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1" }));
      const r2 = gate.submit(makeRequest({ ruleId: "r2", deviceId: "d2" }));
      expect(r1.status).toBe("admitted");
      expect(r2.status).toBe("admitted");
      expect((r1 as { handle: string }).handle).not.toBe((r2 as { handle: string }).handle);
    });
  });

  describe("submit — queueing", () => {
    it("queues when at maxActive capacity", () => {
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 3 });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1" }));
      const r2 = gate.submit(makeRequest({ ruleId: "r1", deviceId: "d2", topic: "sensors/humidity" }));
      expect(r2.status).toBe("queued");
    });

    it("queues up to maxQueuePerRule entries", () => {
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 2 });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1" }));
      const q1 = gate.submit(makeRequest({ ruleId: "r1", deviceId: "d2", topic: "t2" }));
      const q2 = gate.submit(makeRequest({ ruleId: "r1", deviceId: "d3", topic: "t3" }));
      expect(q1.status).toBe("queued");
      expect(q2.status).toBe("queued");
    });
  });

  describe("submit — drop on overflow", () => {
    it("drops when queue is full for a given rule", () => {
      const onDrop = vi.fn();
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 1 }, { onDrop });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1" }));
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d2", topic: "t2" }));
      const dropped = gate.submit(makeRequest({ ruleId: "r1", deviceId: "d3", topic: "t3" }));
      expect(dropped).toEqual({ status: "dropped", reason: "queue_full" });
      expect(onDrop).toHaveBeenCalledWith("r1", "d3", "t3");
    });
  });

  describe("submit — duplicate suppression", () => {
    it("suppresses when an identical dedup key is already active", () => {
      const onSuppress = vi.fn();
      const gate = new ExecutionGate({ maxActive: 5 }, { onSuppress });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1", topic: "t1" }));
      const dup = gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1", topic: "t1" }));
      expect(dup).toEqual({ status: "suppressed", reason: "duplicate" });
      expect(onSuppress).toHaveBeenCalledWith("r1", "d1", "t1");
    });

    it("suppresses when an identical dedup key is already queued", () => {
      const onSuppress = vi.fn();
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 3 }, { onSuppress });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1", topic: "t1" }));
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d2", topic: "t2" })); // queued
      const dup = gate.submit(makeRequest({ ruleId: "r1", deviceId: "d2", topic: "t2" }));
      expect(dup).toEqual({ status: "suppressed", reason: "duplicate" });
      expect(onSuppress).toHaveBeenCalledWith("r1", "d2", "t2");
    });
  });

  describe("complete — slot release and drain", () => {
    it("is idempotent for unknown/stale handles", () => {
      const gate = new ExecutionGate();
      // Should not throw
      gate.complete("nonexistent-handle");
    });

    it("frees a slot and promotes the oldest queued entry", async () => {
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 3 });

      // Admitted first
      let resolve1!: () => void;
      const p1 = new Promise<void>((r) => { resolve1 = r; });
      const r1 = gate.submit(makeRequest({
        ruleId: "r1",
        deviceId: "d1",
        topic: "t1",
        execute: () => p1,
      }));
      expect(r1.status).toBe("admitted");

      // Queued second — this one never resolves so it stays active after drain
      const executeSpy = vi.fn(() => new Promise<void>(() => {}));
      const r2 = gate.submit(makeRequest({
        ruleId: "r1",
        deviceId: "d2",
        topic: "t2",
        execute: executeSpy,
      }));
      expect(r2.status).toBe("queued");

      // Complete the first — should drain the second into active
      resolve1();
      await p1;
      // Allow microtasks to settle (the finally handler fires after p1)
      await new Promise((r) => setTimeout(r, 10));

      expect(executeSpy).toHaveBeenCalled();
      expect(gate.stats().activeCount).toBe(1);
    });

    it("cleans up empty queues from the map after drain", async () => {
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 3 });

      let resolve1!: () => void;
      const p1 = new Promise<void>((r) => { resolve1 = r; });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1", topic: "t1", execute: () => p1 }));
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d2", topic: "t2", execute: () => Promise.resolve() }));

      expect(gate.stats().queueDepths["r1"]).toBe(1);

      resolve1();
      await p1;
      await new Promise((r) => setTimeout(r, 10));

      // After drain, no queue entry remains for r1
      expect(gate.stats().queueDepths["r1"]).toBeUndefined();
    });
  });

  describe("stats", () => {
    it("returns zero state when empty", () => {
      const gate = new ExecutionGate();
      expect(gate.stats()).toEqual({ activeCount: 0, queueDepths: {} });
    });

    it("reflects active count and queue depths", () => {
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 5 });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1", topic: "t1" }));
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d2", topic: "t2" }));
      gate.submit(makeRequest({ ruleId: "r2", deviceId: "d3", topic: "t3" }));

      const stats = gate.stats();
      expect(stats.activeCount).toBe(1);
      expect(stats.queueDepths["r1"]).toBe(1);
      expect(stats.queueDepths["r2"]).toBe(1);
    });
  });

  describe("default config", () => {
    it("uses maxActive=10, maxQueuePerRule=3 when no config provided", () => {
      const gate = new ExecutionGate();
      // Admit 10 requests
      for (let i = 0; i < 10; i++) {
        const r = gate.submit(makeRequest({ ruleId: `r${i}`, deviceId: `d${i}`, topic: `t${i}` }));
        expect(r.status).toBe("admitted");
      }
      // 11th should queue
      const q = gate.submit(makeRequest({ ruleId: "r-extra", deviceId: "d-extra", topic: "t-extra" }));
      expect(q.status).toBe("queued");
    });
  });

  describe("drain promotes oldest across all rules", () => {
    it("promotes the entry with earliest enqueuedAt across multiple rule queues", async () => {
      const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 3 });

      let resolve1!: () => void;
      const p1 = new Promise<void>((r) => { resolve1 = r; });
      gate.submit(makeRequest({ ruleId: "r1", deviceId: "d1", topic: "t1", execute: () => p1 }));

      const executeR2 = vi.fn(() => Promise.resolve());
      const executeR3 = vi.fn(() => Promise.resolve());

      // Queue under two different rules
      gate.submit(makeRequest({ ruleId: "r2", deviceId: "d2", topic: "t2", execute: executeR2 }));
      gate.submit(makeRequest({ ruleId: "r3", deviceId: "d3", topic: "t3", execute: executeR3 }));

      // Complete first — should promote r2 (oldest queued)
      resolve1();
      await p1;
      await new Promise((r) => setTimeout(r, 10));

      expect(executeR2).toHaveBeenCalled();
      // r3 is still queued since maxActive=1 and r2 is now active (resolves instantly though)
      // After r2 resolves, r3 gets promoted too
      await new Promise((r) => setTimeout(r, 10));
      expect(executeR3).toHaveBeenCalled();
    });
  });
});
