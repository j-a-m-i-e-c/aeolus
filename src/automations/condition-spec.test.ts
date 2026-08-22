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

  it("confirms a boolean actuator field against a boolean value", () => {
    // The common real case: an actuator reports the field it was commanded on as
    // a boolean ({ on: true } / { sealed: false } / { active: true }), so this is
    // how an author naturally expresses "confirm the switch reached ON".
    expect(evaluateConditionSpec({ field: "on", op: "eq", value: true }, { on: true })).toBe(true);
    expect(evaluateConditionSpec({ field: "on", op: "eq", value: true }, { on: false })).toBe(false);
    expect(evaluateConditionSpec({ field: "on", op: "eq", value: false }, { on: false })).toBe(true);
    expect(evaluateConditionSpec({ field: "on", op: "eq", value: false }, { on: true })).toBe(false);
    expect(evaluateConditionSpec({ field: "sealed", op: "ne", value: false }, { sealed: true })).toBe(true);
  });

  it("treats an absent boolean field as not-yet-satisfied rather than false-equals-false", () => {
    // Number(undefined) is NaN, so a device that has not reported the field yet
    // must not accidentally satisfy `value: false`.
    expect(evaluateConditionSpec({ field: "on", op: "eq", value: false }, {})).toBe(false);
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

  it("accepts a boolean value, nested in combinators too", () => {
    // A rejected spec is not an error the author ever sees: buildConfirmOptions
    // returns undefined, the Confirmation_Options are dropped, and CommandService
    // clamps the requested `observed` tier down to a fire-and-forget dispatch. So
    // rejecting `value: <boolean>` silently turned every verified boolean switch
    // command in the demo worlds into an unverified one.
    expect(isConditionSpec({ field: "on", op: "eq", value: true })).toBe(true);
    expect(isConditionSpec({ field: "on", op: "eq", value: false })).toBe(true);
    expect(isConditionSpec({ all: [{ field: "on", op: "eq", value: true }, { field: "brightness", op: "gt", value: 0 }] })).toBe(true);
  });

  it("rejects functions, empty combinators, and structurally invalid specs", () => {
    expect(isConditionSpec(() => true)).toBe(false);
    expect(isConditionSpec(undefined)).toBe(false);
    expect(isConditionSpec({ field: "flow", op: "gt" })).toBe(false); // missing value
    expect(isConditionSpec({ field: "flow", op: "nope", value: 0 })).toBe(false);
    expect(isConditionSpec({ all: [] })).toBe(false);
    expect(isConditionSpec({ all: [{ field: "x", op: "gt" }] })).toBe(false);
  });

  it("still rejects a non-numeric, non-boolean value", () => {
    expect(isConditionSpec({ field: "scene", op: "eq", value: "wash" })).toBe(false);
    expect(isConditionSpec({ field: "on", op: "eq", value: null })).toBe(false);
  });
});
