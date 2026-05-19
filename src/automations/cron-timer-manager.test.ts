// src/automations/cron-timer-manager.test.ts — Unit tests for CronTimerManager

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronTimerManager } from "./cron-timer-manager.js";

describe("CronTimerManager", () => {
  let manager: CronTimerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new CronTimerManager();
  });

  afterEach(() => {
    manager.stopAll();
    vi.useRealTimers();
  });

  describe("start()", () => {
    it("schedules a timer with a valid cron expression", () => {
      const callback = vi.fn();
      const result = manager.start("rule-1", "* * * * *", callback);

      expect(result).toBe(true);
      expect(manager.has("rule-1")).toBe(true);
      expect(manager.size).toBe(1);
    });

    it("returns false for an invalid cron expression", () => {
      const callback = vi.fn();
      const result = manager.start("rule-1", "invalid-cron", callback);

      expect(result).toBe(false);
      expect(manager.has("rule-1")).toBe(false);
      expect(manager.size).toBe(0);
    });

    it("returns false for an empty expression", () => {
      const callback = vi.fn();
      const result = manager.start("rule-1", "", callback);

      expect(result).toBe(false);
      expect(manager.has("rule-1")).toBe(false);
    });

    it("replaces an existing timer for the same rule ID", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.start("rule-1", "* * * * *", callback1);
      manager.start("rule-1", "*/5 * * * *", callback2);

      expect(manager.size).toBe(1);
      expect(manager.has("rule-1")).toBe(true);
    });

    it("registers a running scheduled task that can be retrieved", () => {
      const callback = vi.fn();
      manager.start("rule-1", "* * * * *", callback);

      // Verify the internal timer map holds a scheduled task for this rule
      expect(manager.has("rule-1")).toBe(true);
      expect(manager.size).toBe(1);

      // Starting a second rule doesn't interfere
      manager.start("rule-2", "*/5 * * * *", vi.fn());
      expect(manager.size).toBe(2);
    });
  });

  describe("stop()", () => {
    it("cancels an existing timer", () => {
      const callback = vi.fn();
      manager.start("rule-1", "* * * * *", callback);

      manager.stop("rule-1");

      expect(manager.has("rule-1")).toBe(false);
      expect(manager.size).toBe(0);
    });

    it("is a no-op when no timer exists for the rule ID", () => {
      // Should not throw
      expect(() => manager.stop("nonexistent")).not.toThrow();
      expect(manager.size).toBe(0);
    });

    it("cancelled timers do not fire", () => {
      const callback = vi.fn();
      manager.start("rule-1", "* * * * *", callback);

      manager.stop("rule-1");

      // Advance time well past when the cron would have fired
      vi.advanceTimersByTime(120_000);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("stopAll()", () => {
    it("stops all active timers", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const cb3 = vi.fn();

      manager.start("rule-1", "* * * * *", cb1);
      manager.start("rule-2", "*/5 * * * *", cb2);
      manager.start("rule-3", "0 * * * *", cb3);

      expect(manager.size).toBe(3);

      manager.stopAll();

      expect(manager.size).toBe(0);
      expect(manager.has("rule-1")).toBe(false);
      expect(manager.has("rule-2")).toBe(false);
      expect(manager.has("rule-3")).toBe(false);
    });

    it("stopped timers do not fire after stopAll", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      manager.start("rule-1", "* * * * *", cb1);
      manager.start("rule-2", "* * * * *", cb2);

      manager.stopAll();

      vi.advanceTimersByTime(120_000);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });
  });

  describe("has()", () => {
    it("returns true for a scheduled timer", () => {
      manager.start("rule-1", "* * * * *", vi.fn());
      expect(manager.has("rule-1")).toBe(true);
    });

    it("returns false for an unscheduled rule ID", () => {
      expect(manager.has("nonexistent")).toBe(false);
    });
  });

  describe("size", () => {
    it("reflects the number of active timers", () => {
      expect(manager.size).toBe(0);

      manager.start("rule-1", "* * * * *", vi.fn());
      expect(manager.size).toBe(1);

      manager.start("rule-2", "*/5 * * * *", vi.fn());
      expect(manager.size).toBe(2);

      manager.stop("rule-1");
      expect(manager.size).toBe(1);
    });
  });
});
