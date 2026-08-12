// src/automations/condition-spec.test.ts
//
// Unit coverage for the declarative confirmation-condition spec used by the
// sandbox's observed-tier commands. A sandboxed automation cannot pass a live
// predicate FUNCTION across the isolate boundary (isolated-vm rejects a raw
// function call-argument with "A non-transferable value was passed"), so the
// condition is expressed as plain data and evaluated host-side here. These
// tests need no isolate and run on any platform.

import { describe, it, expect } from "vitest";
import { evaluateConditionSpec, isConditionSpec } from "./sandbox.js";

describe("evaluateConditionSpec", () => {
  it("evaluates each numeric comparator against the observed field", () => {
    expect(evaluateConditionSpec({ field: "flow", op: "gt", value: 0 }, { flow: 120 })).toBe(true);
    expect(evaluateConditionSpec({ field: "flow", op: "gt", value: 0 }, { flow: 0 })).toBe(false);
    expect(evaluateConditionSpec({ field: "flow", op: "eq", value: 0 }, { flow: 0 })).toBe(true);
    expect(evaluateConditionSpec({ field: "flow", op: "eq", value: 0 }, { flow: 5 })).toBe(false);
    expect(evaluateConditionSpec({ field: "n", op: "ne", value: 0 }, { n: 3 })).toBe(true);
    expect(evaluateConditionSpec({ field: "n", op: "gte", value: 80 }, { n: 80 })).toBe(true);
    expect(evaluateConditionSpec({ field: "n", op: "gte", value: 80 }, { n: 79 })).toBe(false);
    expect(evaluateConditionSpec({ field: "n", op: "lt", value: 30 }, { n: 18 })).toBe(true);
    expect(evaluateConditionSpec({ field: "n", op: "lte", value: 30 }, { n: 30 })).toBe(true);
  });

  it("coerces string-numeric observed values", () => {
    expect(evaluateConditionSpec({ field: "flow", op: "gt", value: 0 }, { flow: "120" })).toBe(true);
  });

  it("treats a missing or non-numeric observed field as not-yet-satisfied (false), never throwing", () => {
    expect(evaluateConditionSpec({ field: "flow", op: "gt", value: 0 }, {})).toBe(false);
    expect(evaluateConditionSpec({ field: "flow", op: "gt", value: 0 }, { flow: "abc" })).toBe(false);
    expect(evaluateConditionSpec({ field: "flow", op: "gt", value: 0 }, { flow: null })).toBe(false);
  });

  it("evaluates an { all: [...] } conjunction", () => {
    const spec = { all: [{ field: "low", op: "eq", value: 0 }, { field: "average", op: "gte", value: 80 }] };
    expect(evaluateConditionSpec(spec, { low: 0, average: 88 })).toBe(true);
    expect(evaluateConditionSpec(spec, { low: 0, average: 70 })).toBe(false);
    expect(evaluateConditionSpec(spec, { low: 2, average: 88 })).toBe(false);
  });

  it("evaluates an { any: [...] } disjunction", () => {
    const spec = { any: [{ field: "a", op: "gt", value: 10 }, { field: "b", op: "eq", value: 0 }] };
    expect(evaluateConditionSpec(spec, { a: 5, b: 0 })).toBe(true);
    expect(evaluateConditionSpec(spec, { a: 20, b: 3 })).toBe(true);
    expect(evaluateConditionSpec(spec, { a: 5, b: 3 })).toBe(false);
  });

  it("returns false for malformed specs", () => {
    expect(evaluateConditionSpec(undefined, { flow: 1 })).toBe(false);
    expect(evaluateConditionSpec(null, { flow: 1 })).toBe(false);
    expect(evaluateConditionSpec("gt", { flow: 1 })).toBe(false);
    expect(evaluateConditionSpec({ field: "flow", op: "bogus", value: 0 }, { flow: 1 })).toBe(false);
  });
});

describe("isConditionSpec", () => {
  it("accepts a well-formed comparison and combinators", () => {
    expect(isConditionSpec({ field: "flow", op: "gt", value: 0 })).toBe(true);
    expect(isConditionSpec({ all: [{ field: "low", op: "eq", value: 0 }] })).toBe(true);
    expect(isConditionSpec({ any: [{ field: "a", op: "lt", value: 5 }] })).toBe(true);
  });

  it("rejects functions, empty combinators, and structurally invalid specs", () => {
    expect(isConditionSpec(() => true)).toBe(false);
    expect(isConditionSpec(undefined)).toBe(false);
    expect(isConditionSpec({ field: "flow", op: "gt" })).toBe(false); // missing value
    expect(isConditionSpec({ field: "flow", op: "nope", value: 0 })).toBe(false);
    expect(isConditionSpec({ all: [] })).toBe(false);
    expect(isConditionSpec({ all: [{ field: "x", op: "gt" }] })).toBe(false);
  });
});
