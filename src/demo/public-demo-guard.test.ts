// src/demo/public-demo-guard.test.ts — the additive, fail-closed guard

import { describe, it, expect, vi } from "vitest";
import { createPublicDemoGuard } from "./public-demo-guard.js";

function guard(enabled = true, getDemoRuleAccess = vi.fn().mockReturnValue(undefined)) {
  return createPublicDemoGuard({
    enabled,
    getDemoRuleAccess,
    stateStore: { getAll: vi.fn().mockReturnValue({}) } as never,
  });
}

function req(method: string, path: string, user?: Record<string, unknown>, body?: unknown, headers: Record<string, string> = {}) {
  return { method, path, user, body: body ?? {}, params: { id: "rule-1" }, headers } as never;
}

const demoUser = { userId: "demo", role: "user", sessionType: "public-demo" };
const normalUser = { userId: "u1", role: "user", sessionType: "normal" };

describe("createPublicDemoGuard", () => {
  it("passes through a normal session unchanged (even on a non-allowlisted route)", () => {
    const next = vi.fn();
    guard()(req("POST", "/api/automations", normalUser), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes through an unauthenticated request (no req.user)", () => {
    const next = vi.fn();
    guard()(req("POST", "/api/auth/login", undefined), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes through everything when demo mode is disabled", () => {
    const next = vi.fn();
    guard(false)(req("POST", "/api/automations", demoUser), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows an allowlisted read for a demo session", () => {
    const next = vi.fn();
    guard()(req("GET", "/api/state", demoUser), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("denies a non-allowlisted route for a demo session (fail closed)", () => {
    const next = vi.fn();
    expect(() => guard()(req("POST", "/api/automations", demoUser), {} as never, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it("denies raw MQTT publish, layout save and user management for a demo session", () => {
    for (const [m, p] of [["POST", "/api/mqtt/publish"], ["PUT", "/api/layout"], ["POST", "/api/auth/users"]] as const) {
      const next = vi.fn();
      expect(() => guard()(req(m, p, demoUser), {} as never, next)).toThrow();
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("runs the mutation validator and rejects a bad demo state write", () => {
    const next = vi.fn();
    // key over the limit → validator throws
    const bad = req("PUT", "/api/automations/rule-1/state", demoUser, { key: "k".repeat(100), value: 1 });
    expect(() => guard()(bad, {} as never, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a valid demo fire with an eventName", () => {
    const next = vi.fn();
    guard()(req("POST", "/api/automations/rule-1/fire", demoUser, { eventName: "pause" }), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a demo fire with a context override", () => {
    const next = vi.fn();
    const bad = req("POST", "/api/automations/rule-1/fire", demoUser, { context: { topic: "x" } });
    expect(() => guard()(bad, {} as never, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it("allows the atomic stateSet fire used by saveAndFire()", () => {
    const next = vi.fn();
    const body = { stateSet: { key: "master", value: true } };
    guard()(req("POST", "/api/automations/rule-1/fire", demoUser, body), {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("resolves the rule id from the path so a stateSet fire is allowlist-checked", () => {
    // Proves the matcher-extracted :id reaches the writable-key allowlist: this
    // guard runs before Express populates req.params for the matched route.
    const getDemoRuleAccess = vi.fn().mockReturnValue({ writableStateKeys: ["master"] });
    const next = vi.fn();
    const bad = req("POST", "/api/automations/rule-7/fire", demoUser, { stateSet: { key: "secret", value: 1 } });
    bad.params = {}; // Express has not matched a route yet at this point.
    expect(() => guard(true, getDemoRuleAccess)(bad, {} as never, next)).toThrow();
    expect(getDemoRuleAccess).toHaveBeenCalledWith("rule-7");
    expect(next).not.toHaveBeenCalled();
  });
});
