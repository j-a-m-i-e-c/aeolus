// src/demo/demo-validators.test.ts — bounded state/fire validation for demo sessions

import { describe, it, expect, vi } from "vitest";
import {
  makeDemoStateWriteValidator,
  makeDemoFireValidator,
  DEMO_MAX_KEY_LENGTH,
  DEMO_MAX_VALUE_BYTES,
  DEMO_MAX_KEYS_PER_RULE,
  DEMO_MAX_BODY_BYTES,
  type DemoValidatorDeps,
} from "./demo-validators.js";

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    params: { id: "rule-1" },
    headers: {},
    body: {},
    ...overrides,
  } as never;
}

function makeDeps(over: Partial<DemoValidatorDeps> = {}): DemoValidatorDeps {
  return {
    getDemoRuleAccess: vi.fn().mockReturnValue(undefined),
    stateStore: { getAll: vi.fn().mockReturnValue({}) } as never,
    ...over,
  };
}

describe("validateDemoStateWrite", () => {
  it("accepts a small write with a normal key/value", () => {
    const v = makeDemoStateWriteValidator(makeDeps());
    expect(() => v(makeReq({ body: { key: "master", value: true } }))).not.toThrow();
  });

  it("rejects a missing/empty key", () => {
    const v = makeDemoStateWriteValidator(makeDeps());
    expect(() => v(makeReq({ body: { value: 1 } }))).toThrow();
    expect(() => v(makeReq({ body: { key: "", value: 1 } }))).toThrow();
  });

  it("rejects a key over the length limit", () => {
    const v = makeDemoStateWriteValidator(makeDeps());
    const key = "k".repeat(DEMO_MAX_KEY_LENGTH + 1);
    expect(() => v(makeReq({ body: { key, value: 1 } }))).toThrow();
  });

  it("rejects a value over the byte limit", () => {
    const v = makeDemoStateWriteValidator(makeDeps());
    const value = "x".repeat(DEMO_MAX_VALUE_BYTES + 1);
    expect(() => v(makeReq({ body: { key: "k", value } }))).toThrow();
  });

  it("rejects a body whose Content-Length exceeds the demo cap", () => {
    const v = makeDemoStateWriteValidator(makeDeps());
    const req = makeReq({
      headers: { "content-length": String(DEMO_MAX_BODY_BYTES + 1) },
      body: { key: "k", value: 1 },
    });
    expect(() => v(req)).toThrow();
  });

  it("enforces writableStateKeys when declared", () => {
    const deps = makeDeps({ getDemoRuleAccess: vi.fn().mockReturnValue({ writableStateKeys: ["master"] }) });
    const v = makeDemoStateWriteValidator(deps);
    expect(() => v(makeReq({ body: { key: "master", value: 1 } }))).not.toThrow();
    expect(() => v(makeReq({ body: { key: "secret", value: 1 } }))).toThrow();
  });

  it("blocks a new key once the rule is at the key cap, but allows updating an existing key", () => {
    const full: Record<string, number> = {};
    for (let i = 0; i < DEMO_MAX_KEYS_PER_RULE; i++) full[`k${i}`] = i;
    const deps = makeDeps({ stateStore: { getAll: vi.fn().mockReturnValue(full) } as never });
    const v = makeDemoStateWriteValidator(deps);
    expect(() => v(makeReq({ body: { key: "brand-new", value: 1 } }))).toThrow();
    expect(() => v(makeReq({ body: { key: "k0", value: 2 } }))).not.toThrow();
  });
});

describe("validateDemoFire", () => {
  it("accepts an eventName-only fire", () => {
    const v = makeDemoFireValidator(makeDeps());
    expect(() => v(makeReq({ body: { eventName: "pause" } }))).not.toThrow();
  });

  it("rejects a context override", () => {
    const v = makeDemoFireValidator(makeDeps());
    expect(() =>
      v(makeReq({ body: { context: { topic: "x", deviceId: "y", state: {} } } })),
    ).toThrow();
  });

  it("rejects a missing eventName", () => {
    const v = makeDemoFireValidator(makeDeps());
    expect(() => v(makeReq({ body: {} }))).toThrow();
    expect(() => v(makeReq({ body: { eventName: 123 } }))).toThrow();
  });

  it("enforces fireEvents when declared", () => {
    const deps = makeDeps({ getDemoRuleAccess: vi.fn().mockReturnValue({ fireEvents: ["pause", "reset"] }) });
    const v = makeDemoFireValidator(deps);
    expect(() => v(makeReq({ body: { eventName: "pause" } }))).not.toThrow();
    expect(() => v(makeReq({ body: { eventName: "detonate" } }))).toThrow();
  });
});
