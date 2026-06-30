// frontend/src/lib/cron-utils.test.ts — Unit tests for client-side cron utilities

import { describe, it, expect } from "vitest";
import { isValidCron, describeCron, CRON_PRESETS } from "./cron-utils";

describe("isValidCron", () => {
  it("accepts the every-minute wildcard expression", () => {
    expect(isValidCron("* * * * *")).toBe(true);
  });

  it("accepts step, list, and range fields", () => {
    expect(isValidCron("*/5 * * * *")).toBe(true);
    expect(isValidCron("1,2,3 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("0 0 1 1 *")).toBe(true);
  });

  it("rejects empty or non-string input", () => {
    expect(isValidCron("")).toBe(false);
    expect(isValidCron(undefined as unknown as string)).toBe(false);
  });

  it("rejects the wrong number of fields", () => {
    expect(isValidCron("* * * *")).toBe(false);
    expect(isValidCron("* * * * * *")).toBe(false);
  });

  it("rejects out-of-range values per field", () => {
    expect(isValidCron("60 * * * *")).toBe(false); // minute > 59
    expect(isValidCron("* 24 * * *")).toBe(false); // hour > 23
    expect(isValidCron("* * 32 * *")).toBe(false); // day-of-month > 31
    expect(isValidCron("* * * 13 *")).toBe(false); // month > 12
    expect(isValidCron("* * * * 8")).toBe(false); // day-of-week > 7
  });

  it("rejects garbage tokens", () => {
    expect(isValidCron("abc * * * *")).toBe(false);
  });

  it("validates every shipped preset", () => {
    for (const preset of CRON_PRESETS) {
      expect(isValidCron(preset.expression), preset.label).toBe(true);
    }
  });
});

describe("describeCron", () => {
  it("returns empty string for empty input", () => {
    expect(describeCron("")).toBe("");
  });

  it("describes the every-minute expression", () => {
    expect(describeCron("* * * * *")).toBe("Runs every minute");
  });

  it("describes every-N-minutes with correct pluralisation", () => {
    expect(describeCron("*/5 * * * *")).toBe("Runs every 5 minutes");
    expect(describeCron("*/1 * * * *")).toBe("Runs every 1 minute");
  });

  it("describes every-N-hours", () => {
    expect(describeCron("0 */6 * * *")).toBe("Runs every 6 hours");
  });

  it("describes hourly at a specific minute", () => {
    expect(describeCron("30 * * * *")).toBe("Runs every hour at minute 30");
  });

  it("describes a daily time with zero-padding", () => {
    expect(describeCron("0 0 * * *")).toBe("Runs daily at 00:00");
    expect(describeCron("5 9 * * *")).toBe("Runs daily at 09:05");
  });

  it("describes weekday and weekend schedules", () => {
    expect(describeCron("30 9 * * 1-5")).toBe("Runs at 09:30 on weekdays");
    expect(describeCron("0 10 * * 0,6")).toBe("Runs at 10:00 on weekends");
  });

  it("describes specific day-of-week schedules by name", () => {
    expect(describeCron("0 9 * * 1")).toBe("Runs at 09:00 on Mon");
  });

  it("falls back to a generic description for unrecognised shapes", () => {
    expect(describeCron("* * * *")).toBe("Runs on custom schedule");
    expect(describeCron("15 8 1 * *")).toBe("Runs on custom schedule");
  });
});
