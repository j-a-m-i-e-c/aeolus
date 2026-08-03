// src/demo/demo-policy.test.ts — allowlist matcher behaviour (fail closed)

import { describe, it, expect, vi } from "vitest";
import { compileDemoPolicy, buildDemoPolicy, type DemoPolicyEntry } from "./demo-policy.js";

function deps() {
  return {
    getDemoRuleAccess: vi.fn().mockReturnValue(undefined),
    stateStore: { getAll: vi.fn().mockReturnValue({}) } as never,
  };
}

describe("compileDemoPolicy matcher", () => {
  const entries: DemoPolicyEntry[] = [
    { method: "GET", pattern: "/api/devices" },
    { method: "GET", pattern: "/api/devices/:id/history" },
    { method: "PUT", pattern: "/api/automations/:id/state" },
  ];
  const matcher = compileDemoPolicy(entries);

  it("matches an exact literal path", () => {
    expect(matcher.match("GET", "/api/devices")).toBeDefined();
  });

  it("matches a parameterized path with any non-empty segment", () => {
    expect(matcher.match("GET", "/api/devices/dev-42/history")).toBeDefined();
  });

  it("is case-insensitive on method", () => {
    expect(matcher.match("get", "/api/devices")).toBeDefined();
  });

  it("ignores a query string", () => {
    expect(matcher.match("GET", "/api/devices/dev-1/history?limit=10")).toBeDefined();
  });

  it("denies a matching path with the wrong method (fail closed)", () => {
    expect(matcher.match("POST", "/api/devices")).toBeUndefined();
  });

  it("denies an unknown path (fail closed)", () => {
    expect(matcher.match("GET", "/api/automations/rule-1")).toBeUndefined();
    expect(matcher.match("DELETE", "/api/automations/rule-1")).toBeUndefined();
  });

  it("denies a path with a different segment count", () => {
    expect(matcher.match("GET", "/api/devices/dev-1")).toBeUndefined();
    expect(matcher.match("GET", "/api/devices/dev-1/history/extra")).toBeUndefined();
  });

  it("does not treat a param segment as matching an empty segment", () => {
    // "/api/devices//history" would split to a param gap — must not match.
    expect(matcher.match("GET", "/api/devices//history")).toBeUndefined();
  });
});

describe("buildDemoPolicy", () => {
  it("includes the documented reads and the two bounded mutations", () => {
    const policy = buildDemoPolicy(deps());
    const has = (m: string, p: string) => policy.some((e) => e.method === m && e.pattern === p);

    expect(has("GET", "/api/state")).toBe(true);
    expect(has("GET", "/api/automations/:id/ui-module")).toBe(true);
    expect(has("GET", "/api/data-store/collections/:name/records")).toBe(true);
    expect(has("PUT", "/api/automations/:id/state")).toBe(true);
    expect(has("POST", "/api/automations/:id/fire")).toBe(true);
  });

  it("attaches validators only to the mutating entries", () => {
    const policy = buildDemoPolicy(deps());
    for (const e of policy) {
      if (e.method === "GET") expect(e.validate).toBeUndefined();
      else expect(typeof e.validate).toBe("function");
    }
  });

  it("does not allow any authoring/admin route", () => {
    const policy = buildDemoPolicy(deps());
    const forbidden: Array<[string, string]> = [
      ["POST", "/api/automations"],
      ["PUT", "/api/automations/:id"],
      ["DELETE", "/api/automations/:id"],
      ["PUT", "/api/layout"],
      ["POST", "/api/mqtt/publish"],
      ["POST", "/api/connectors"],
      ["POST", "/api/data-store/collections"],
      ["GET", "/api/auth/users"],
    ];
    for (const [m, p] of forbidden) {
      expect(policy.some((e) => e.method === m && e.pattern === p)).toBe(false);
    }
  });
});
