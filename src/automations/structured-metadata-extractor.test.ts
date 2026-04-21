import { describe, it, expect } from "vitest";
import { extractStructuredMetadata } from "./structured-metadata-extractor.js";
import { transpile } from "./transpiler.js";

describe("extractStructuredMetadata", () => {
  it("extracts condition and actions from a standard automation() call", () => {
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
    expect(meta!.conditionText).toContain("ctx.state.value > 30");
    expect(meta!.actionsText).toContain("Hot!");
  });

  it("extracts actions-only automation (no condition)", () => {
    const source = `
automation({
  actions: (ctx) => {
    log.info("Triggered on " + ctx.topic);
  },
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "home/+/status");
    expect(meta).not.toBeNull();
    expect(meta!.trigger).toBe("home/+/status");
    expect(meta!.conditionText).toBeNull();
    expect(meta!.actionsText).toContain("ctx.topic");
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

  it("handles nested braces in condition and actions bodies", () => {
    const source = `
automation({
  condition: (ctx) => {
    if (ctx.state.value > 30) {
      return true;
    }
    return false;
  },
  actions: (ctx) => {
    if (ctx.state.value > 50) {
      log.warn("Very hot!");
    } else {
      log.info("Warm");
    }
  },
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "sensor/temp");
    expect(meta).not.toBeNull();
    expect(meta!.conditionText).toContain("ctx.state.value > 30");
    expect(meta!.actionsText).toContain("Very hot!");
    expect(meta!.actionsText).toContain("Warm");
  });

  it("handles actions before condition in the config object", () => {
    const source = `
automation({
  actions: (ctx) => {
    log.info("action");
  },
  condition: (ctx) => {
    return true;
  },
});`;
    const result = transpile(source);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const meta = extractStructuredMetadata(result.js, "test/topic");
    expect(meta).not.toBeNull();
    expect(meta!.conditionText).toContain("return true");
    expect(meta!.actionsText).toContain("action");
  });
});
