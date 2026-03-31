// Feature: mvp-core-platform, Property 1: Exponential Backoff Retry Delay
import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { computeRetryDelay } from "./mqtt-service.js";

describe("Property: Exponential Backoff Retry Delay", () => {
  test.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 100, max: 5000 })])(
    "delay equals baseDelay * 2^(attempt-1)",
    (attempt, baseDelay) => {
      const delay = computeRetryDelay(attempt, baseDelay);
      const expected = baseDelay * Math.pow(2, attempt - 1);
      expect(delay).toBe(expected);
    }
  );

  test.prop([fc.integer({ min: 1, max: 5 })])(
    "delays form an increasing sequence",
    (maxAttempt) => {
      const baseDelay = 1000;
      let prev = 0;
      for (let i = 1; i <= maxAttempt; i++) {
        const delay = computeRetryDelay(i, baseDelay);
        expect(delay).toBeGreaterThan(prev);
        prev = delay;
      }
    }
  );
});
