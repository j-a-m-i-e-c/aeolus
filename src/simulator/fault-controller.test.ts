// src/simulator/fault-controller.test.ts
import { describe, it, expect } from "vitest";
import type { Logger } from "pino";
import { FaultController } from "./fault-controller.js";

function stubLogger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

function make(maxDelayMs = 5000): FaultController {
  return new FaultController({ maxDelayMs, logger: stubLogger() });
}

describe("FaultController", () => {
  it("returns an empty fault when nothing is armed", () => {
    const fc = make();
    expect(fc.consume("dev")).toEqual({ dropNextAck: false, suppressNextState: false });
  });

  it("consumes one-shot faults exactly once", () => {
    const fc = make();
    fc.arm("dev", { rejectNext: { reason: "no" }, dropNextAck: true, suppressNextState: true });

    const first = fc.consume("dev");
    expect(first.rejectNext?.reason).toBe("no");
    expect(first.dropNextAck).toBe(true);
    expect(first.suppressNextState).toBe(true);

    const second = fc.consume("dev");
    expect(second).toEqual({ dropNextAck: false, suppressNextState: false });
  });

  it("carries a mismatch patch through to the consumer", () => {
    const fc = make();
    fc.arm("dev", { mismatchNextState: { running: false } });
    expect(fc.consume("dev").mismatchNextState).toEqual({ running: false });
  });

  it("clamps armed latencies and keeps them across commands", () => {
    const fc = make(1000);
    fc.arm("dev", { ackDelayMs: 999999, stateDelayMs: 200 });

    const first = fc.consume("dev");
    expect(first.ackDelayMs).toBe(1000); // clamped
    expect(first.stateDelayMs).toBe(200);

    // Latency overrides persist for the next command.
    const second = fc.consume("dev");
    expect(second.ackDelayMs).toBe(1000);
    expect(second.stateDelayMs).toBe(200);
  });

  it("clears faults for a device", () => {
    const fc = make();
    fc.arm("dev", { ackDelayMs: 100 });
    fc.clear("dev");
    expect(fc.peek("dev")).toBeUndefined();
  });

  it("scopes faults to a named device", () => {
    const fc = make();
    fc.arm("a", { rejectNext: { reason: "x" } });
    expect(fc.consume("b")).toEqual({ dropNextAck: false, suppressNextState: false });
    expect(fc.consume("a").rejectNext?.reason).toBe("x");
  });
});
