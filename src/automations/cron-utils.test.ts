// src/automations/cron-utils.test.ts — Unit tests for cron expression utilities

import { describe, it, expect } from "vitest";
import { isValidCron, describeCron, CRON_PRESETS } from "./cron-utils.js";

describe("cron-utils", () => {
  describe("CRON_PRESETS", () => {
    it("contains expected presets", () => {
      expect(CRON_PRESETS.length).toBeGreaterThan(0);
      expect(CRON_PRESETS[0]).toHaveProperty("label");
      expect(CRON_PRESETS[0]).toHaveProperty("expression");
    });

    it("all presets have valid cron expressions", () => {
      for (const preset of CRON_PRESETS) {
        expect(isValidCron(preset.expression)).toBe(true);
      }
    });
  });

  describe("isValidCron", () => {
    it("returns true for valid 5-field expressions", () => {
      expect(isValidCron("* * * * *")).toBe(true);
      expect(isValidCron("0 0 * * *")).toBe(true);
      expect(isValidCron("*/5 * * * *")).toBe(true);
      expect(isValidCron("0 */6 * * *")).toBe(true);
      expect(isValidCron("30 8 * * 1-5")).toBe(true);
    });

    it("returns false for invalid expressions", () => {
      expect(isValidCron("invalid")).toBe(false);
      expect(isValidCron("60 * * * *")).toBe(false);
      expect(isValidCron("* * * *")).toBe(false); // Only 4 fields
    });

    it("returns false for empty or non-string input", () => {
      expect(isValidCron("")).toBe(false);
      expect(isValidCron(null as any)).toBe(false);
      expect(isValidCron(undefined as any)).toBe(false);
    });
  });

  describe("describeCron", () => {
    it("describes every minute", () => {
      expect(describeCron("* * * * *")).toBe("Runs every minute");
    });

    it("describes every N minutes", () => {
      expect(describeCron("*/5 * * * *")).toBe("Runs every 5 minutes");
      expect(describeCron("*/15 * * * *")).toBe("Runs every 15 minutes");
      expect(describeCron("*/30 * * * *")).toBe("Runs every 30 minutes");
    });

    it("describes every N hours", () => {
      expect(describeCron("0 */6 * * *")).toBe("Runs every 6 hours");
      expect(describeCron("0 */12 * * *")).toBe("Runs every 12 hours");
    });

    it("describes every hour at specific minute", () => {
      expect(describeCron("30 * * * *")).toBe("Runs every hour at minute 30");
    });

    it("describes daily at specific time", () => {
      expect(describeCron("0 0 * * *")).toBe("Runs daily at 00:00");
      expect(describeCron("30 8 * * *")).toBe("Runs daily at 08:30");
      expect(describeCron("0 12 * * *")).toBe("Runs daily at 12:00");
    });

    it("describes weekday schedules", () => {
      expect(describeCron("0 9 * * 1-5")).toBe("Runs at 09:00 on weekdays");
    });

    it("describes weekend schedules", () => {
      expect(describeCron("0 10 * * 0,6")).toBe("Runs at 10:00 on weekends");
      expect(describeCron("0 10 * * 6,0")).toBe("Runs at 10:00 on weekends");
    });

    it("returns custom schedule for complex expressions", () => {
      expect(describeCron("0 0 1 * *")).toBe("Runs on custom schedule");
      expect(describeCron("0 0 * * 1")).toBe("Runs on custom schedule");
    });

    it("returns empty string for empty input", () => {
      expect(describeCron("")).toBe("");
    });

    it("returns custom schedule for non-5-field expressions", () => {
      expect(describeCron("* * * *")).toBe("Runs on custom schedule");
    });
  });
});
