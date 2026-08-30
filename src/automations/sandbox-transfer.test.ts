// src/automations/sandbox-transfer.test.ts
//
// Guards the host->isolate transfer contract for command results.
//
// A host callback's return value must be TRANSFERABLE. `Reference.apply()` falls
// back to REFERENCE semantics for anything else — isolated-vm's own typings say so:
//
//   type FallbackReference = { _reference: true };
//   Options extends FallbackReference ? Reference<Result> : ...
//
// So returning a bare `ActionResult` from `__actionRef` made the isolate resolve a
// `Reference` to it instead of the object. A Reference is truthy and carries none of
// the expected properties, so in user Logic `result.success` read as `undefined`,
// every `if (result.success)` took the failure branch, and `result.error` /
// `result.lifecycleState` reported nothing — surfacing as "not verified: unknown"
// while the device had actually actuated. Every sibling callback (http.get,
// state.get, state.getAll) already returns `ExternalCopy(...).copyInto()`.
//
// isolated-vm is not available on Windows dev, so this covers the sanitiser that
// makes the value copyable plus the structural guarantee that both action callbacks
// hand back a copy.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toPlainJson } from "./sandbox.js";

describe("toPlainJson", () => {
  it("preserves the plain report fields of an ActionResult", () => {
    const result = {
      success: false as const,
      error: "observation timed out",
      lifecycleState: "TIMED_OUT" as const,
      failureKind: "timeout",
      commandId: "cmd-1",
      correlationId: "corr-1",
    };
    expect(toPlainJson(result)).toEqual(result);
  });

  it("keeps booleans and nested data intact", () => {
    const result = { success: true, data: { on: true, brightness: 100, nested: { a: [1, 2] } } };
    expect(toPlainJson(result)).toEqual(result);
  });

  it("drops values ExternalCopy cannot clone rather than failing the transfer", () => {
    // A device handler's `data` is arbitrary; a function or symbol in it would make
    // ExternalCopy throw, which would reject inside the script instead of reporting
    // an outcome. Dropping them keeps the contract's report fields readable.
    const out = toPlainJson({ success: true, data: { fn: () => 1, sym: Symbol("s"), keep: 5 } }) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(out.success).toBe(true);
    expect(out.data.keep).toBe(5);
    expect(out.data.fn).toBeUndefined();
    expect(out.data.sym).toBeUndefined();
  });

  it("survives a circular structure instead of throwing", () => {
    const circular: Record<string, unknown> = { success: false };
    circular.self = circular;
    expect(() => toPlainJson(circular)).not.toThrow();
    expect(toPlainJson(circular)).toBeNull();
  });

  it("normalises undefined to null so the transfer has a defined value", () => {
    expect(toPlainJson(undefined)).toBeNull();
  });
});

describe("action callbacks return a transferable copy", () => {
  const source = readFileSync(join(process.cwd(), "src/automations/sandbox.ts"), "utf8");

  it("never resolves devices.action / devices.actionAll with a bare object", () => {
    // Structural guard: both host callbacks must funnel their returns through a
    // copyOut() that wraps the value in ExternalCopy. Checked at source level
    // because isolated-vm cannot be loaded on every dev platform.
    const copyOutDefs = source.match(/const copyOut = /g) ?? [];
    expect(copyOutDefs.length, "expected a copyOut helper in both action callbacks").toBe(2);
    expect(source).toContain("new ivm.ExternalCopy(toPlainJson(result)).copyInto()");
    expect(source).toContain("new ivm.ExternalCopy(toPlainJson(bulk)).copyInto()");
  });

  it("still pushes the uncopied result into the collector for host bookkeeping", () => {
    // The durable command record must keep the real object, not the sanitised copy.
    expect(source).toContain("record(result)");
    expect(source).toContain("return copyOut(result)");
  });

  it("attributes collector pushes to an explicitly captured executionId", () => {
    // Isolate-invoked callbacks lose the collector's AsyncLocalStorage, where
    // pushCurrent() silently no-ops. The host must capture the id up front and
    // push explicitly, or every script-issued Command_Result is dropped.
    expect(source).toContain("const collectorExecutionId = this.collector?.context.getStore()");
    expect(source).toContain("collector?.push(collectorExecutionId, result)");
  });
});
