import { describe, it, expect } from "vitest";
import { extractStructuredMetadata } from "./structured-metadata-extractor.js";
import { transpile } from "./transpiler.js";

describe("extractStructuredMetadata", () => {
  it("extracts named functions from conditions and actions arrays", () => {
    const source = `
automation({
  conditions: [
    function tempAbove30(ctx) {
      return ctx.state.value > 30;
    },
  ],
  actions: [
    function alertHot(ctx) {
      log.info("Hot!");
    },
  ],
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "sensor/+/temperature");
    expect(meta).not.toBeNull();
    expect(meta!.trigger).toBe("sensor/+/temperature");
    expect(meta!.conditions).toEqual(["tempAbove30"]);
    expect(meta!.actions).toEqual(["alertHot"]);
  });

  it("extracts multiple named functions from arrays", () => {
    const source = `
automation({
  conditions: [
    function tempAbove30(ctx) {
      return ctx.state.value > 30;
    },
    function isEnabled(ctx) {
      return ctx.state.enabled === true;
    },
  ],
  actions: [
    function turnOnFan(ctx) {
      devices.action(ctx.deviceId, "on");
    },
    function logEvent(ctx) {
      log.info("Fan turned on");
    },
  ],
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "sensor/+/temperature");
    expect(meta).not.toBeNull();
    expect(meta!.conditions).toEqual(["tempAbove30", "isEnabled"]);
    expect(meta!.actions).toEqual(["turnOnFan", "logEvent"]);
  });

  it("extracts actions-only automation (no conditions)", () => {
    const source = `
automation({
  actions: [
    function logTrigger(ctx) {
      log.info("Triggered on " + ctx.topic);
    },
  ],
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "home/+/status");
    expect(meta).not.toBeNull();
    expect(meta!.trigger).toBe("home/+/status");
    expect(meta!.conditions).toEqual([]);
    expect(meta!.actions).toEqual(["logTrigger"]);
  });

  it("falls back to body text for anonymous arrow functions in arrays", () => {
    const source = `
automation({
  conditions: [
    (ctx) => {
      return ctx.state.value > 30;
    },
  ],
  actions: [
    (ctx) => {
      log.info("Hot!");
    },
  ],
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "sensor/+/temperature");
    expect(meta).not.toBeNull();
    expect(meta!.conditions.length).toBe(1);
    expect(meta!.conditions[0]).toContain("ctx.state.value > 30");
    expect(meta!.actions.length).toBe(1);
    expect(meta!.actions[0]).toContain("Hot!");
  });

  it("handles legacy single-function format (backward compat)", () => {
    const source = `
automation({
  condition: (ctx) => {
    return ctx.state.value > 30;
  },
  actions: (ctx) => {
    log.info("Hot!");
  },
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "sensor/+/temperature");
    expect(meta).not.toBeNull();
    expect(meta!.trigger).toBe("sensor/+/temperature");
    expect(meta!.conditions.length).toBe(1);
    expect(meta!.conditions[0]).toContain("ctx.state.value > 30");
    expect(meta!.actions.length).toBe(1);
    expect(meta!.actions[0]).toContain("Hot!");
  });

  it("returns null for free-form code without automation() call", () => {
    const source = `
log.info("Hello world");
const x = devices.list();
`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "any/topic");
    expect(meta).toBeNull();
  });

  it("returns null for empty compiled JS", () => {
    const meta = extractStructuredMetadata("", "any/topic");
    expect(meta).toBeNull();
  });

  it("handles nested braces in conditions and actions bodies", () => {
    const source = `
automation({
  conditions: [
    function checkTemp(ctx) {
      if (ctx.state.value > 30) {
        return true;
      }
      return false;
    },
  ],
  actions: [
    function alertTemp(ctx) {
      if (ctx.state.value > 50) {
        log.warn("Very hot!");
      } else {
        log.info("Warm");
      }
    },
  ],
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "sensor/temp");
    expect(meta).not.toBeNull();
    expect(meta!.conditions).toEqual(["checkTemp"]);
    expect(meta!.actions).toEqual(["alertTemp"]);
  });

  it("handles actions before conditions in the config object", () => {
    const source = `
automation({
  actions: [
    function doAction(ctx) {
      log.info("action");
    },
  ],
  conditions: [
    function alwaysTrue(ctx) {
      return true;
    },
  ],
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "test/topic");
    expect(meta).not.toBeNull();
    expect(meta!.conditions).toEqual(["alwaysTrue"]);
    expect(meta!.actions).toEqual(["doAction"]);
  });
});
