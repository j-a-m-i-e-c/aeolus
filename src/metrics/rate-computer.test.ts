// src/metrics/rate-computer.test.ts — Unit tests for RateComputer

import { describe, it, expect, beforeEach } from "vitest";
import { RateComputer } from "./rate-computer.js";

describe("RateComputer", () => {
  let computer: RateComputer;

  beforeEach(() => {
    computer = new RateComputer();
  });

  describe("computeRate", () => {
    it("returns null on first sample (no previous value)", () => {
      const result = computer.computeRate("mqtt_received", 100, 30);
      expect(result).toBeNull();
    });

    it("computes correct rate for normal consecutive samples", () => {
      computer.computeRate("mqtt_received", 100, 30);
      const rate = computer.computeRate("mqtt_received", 400, 30);
      expect(rate).toBe(10); // (400 - 100) / 30 = 10
    });

    it("returns null on counter reset (current < previous)", () => {
      computer.computeRate("mqtt_received", 500, 30);
      const rate = computer.computeRate("mqtt_received", 50, 30);
      expect(rate).toBeNull();
    });

    it("uses current value as new baseline after counter reset", () => {
      computer.computeRate("mqtt_received", 500, 30);
      computer.computeRate("mqtt_received", 50, 30); // reset
      const rate = computer.computeRate("mqtt_received", 110, 30);
      expect(rate).toBe(2); // (110 - 50) / 30 = 2
    });

    it("returns 0 when counter value is unchanged", () => {
      computer.computeRate("http_requests", 200, 30);
      const rate = computer.computeRate("http_requests", 200, 30);
      expect(rate).toBe(0);
    });

    it("tracks multiple metrics independently", () => {
      computer.computeRate("mqtt_received", 100, 30);
      computer.computeRate("http_requests", 50, 30);

      const mqttRate = computer.computeRate("mqtt_received", 400, 30);
      const httpRate = computer.computeRate("http_requests", 80, 30);

      expect(mqttRate).toBe(10); // (400 - 100) / 30
      expect(httpRate).toBe(1); // (80 - 50) / 30
    });

    it("handles fractional rates correctly", () => {
      computer.computeRate("automations", 10, 30);
      const rate = computer.computeRate("automations", 11, 30);
      expect(rate).toBeCloseTo(1 / 30);
    });
  });

  describe("reset", () => {
    it("clears all stored values", () => {
      computer.computeRate("mqtt_received", 100, 30);
      computer.computeRate("http_requests", 50, 30);

      computer.reset();

      // After reset, first call should return null again
      expect(computer.computeRate("mqtt_received", 200, 30)).toBeNull();
      expect(computer.computeRate("http_requests", 80, 30)).toBeNull();
    });

    it("allows normal computation after reset", () => {
      computer.computeRate("mqtt_received", 100, 30);
      computer.reset();

      computer.computeRate("mqtt_received", 50, 30); // new baseline
      const rate = computer.computeRate("mqtt_received", 110, 30);
      expect(rate).toBe(2); // (110 - 50) / 30
    });
  });
});
