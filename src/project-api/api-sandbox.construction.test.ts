// A sandbox that cannot be created must still give its slot back (ADR-0027, Phase 3).
//
// isolated-vm is replaced by a stub whose Isolate constructor throws, as V8 does when
// it refuses an allocation. Nothing else of isolated-vm is reached.

import { describe, expect, it, vi } from "vitest";

const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock("isolated-vm", () => {
  class Isolate {
    constructor() {
      constructed.count++;
      throw new RangeError("Array buffer allocation failed");
    }
  }
  return { default: { Isolate } };
});

const { activeApiInvocations, DEFAULT_API_LIMITS, invokeApiHandler } = await import("./api-sandbox.js");

const state = { get: () => undefined, getAll: () => ({}) };
const request = { routeId: "r", params: {} };

describe("an isolate that cannot be constructed", () => {
  it("reports the sandbox unavailable and releases its slot", async () => {
    const result = await invokeApiHandler("", "handle", request, state, { ...DEFAULT_API_LIMITS, maxConcurrent: 1 });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect((result as { detail: string }).detail).toMatch(/Could not create the API sandbox: Array buffer allocation failed/);
    expect(activeApiInvocations()).toBe(0);
  });

  it("never reports busy afterwards, however many constructions fail", async () => {
    const before = constructed.count;
    const limits = { ...DEFAULT_API_LIMITS, maxConcurrent: 1 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await invokeApiHandler("", "handle", request, state, limits));
    expect(results.map((r) => r.ok === false && r.reason)).toEqual(Array(5).fill("unavailable"));
    // Each call reached the constructor: none was turned away by a leaked slot.
    expect(constructed.count - before).toBe(5);
    expect(activeApiInvocations()).toBe(0);
  });

  it("frees the slot when the constructor throws concurrently", async () => {
    const limits = { ...DEFAULT_API_LIMITS, maxConcurrent: 2 };
    const results = await Promise.all(Array.from({ length: 4 }, () => invokeApiHandler("", "handle", request, state, limits)));
    expect(results.every((r) => r.ok === false && r.reason === "unavailable")).toBe(true);
    expect(activeApiInvocations()).toBe(0);
  });
});
