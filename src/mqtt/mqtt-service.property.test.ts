// Feature: engineering-quality-uplift, Property 5: Exponential Backoff Computation
import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { computeRetryDelay } from "./mqtt-service.js";

/**
 * Validates: Requirements 6.2
 */
describe("Property: Exponential Backoff Retry Delay", () => {
  test.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 100, max: 5000 })])(
    "delay equals baseDelay * 2^(attempt-1) capped at maxDelay",
    (attempt, baseDelay) => {
      const maxDelay = 30000;
      const delay = computeRetryDelay(attempt, baseDelay, maxDelay);
      const expected = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      expect(delay).toBe(expected);
    }
  );

  test.prop([fc.integer({ min: 1, max: 5 })])(
    "delays form a non-decreasing sequence",
    (maxAttempt) => {
      const baseDelay = 1000;
      const maxDelay = 30000;
      let prev = 0;
      for (let i = 1; i <= maxAttempt; i++) {
        const delay = computeRetryDelay(i, baseDelay, maxDelay);
        expect(delay).toBeGreaterThanOrEqual(prev);
        prev = delay;
      }
    }
  );

  test.prop([fc.integer({ min: 1, max: 1000 })])(
    "delay is always between baseDelay and maxDelay inclusive",
    (attempt) => {
      const baseDelay = 1000;
      const maxDelay = 30000;
      const delay = computeRetryDelay(attempt, baseDelay, maxDelay);
      expect(delay).toBeGreaterThanOrEqual(baseDelay);
      expect(delay).toBeLessThanOrEqual(maxDelay);
    }
  );
});
