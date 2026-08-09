// src/simulator/fault-controller.ts
// phase-2-mqtt-simulator Task 5 — deterministic, bounded fault injection.
//
// Faults are simulator-local and scoped to a named device (Req 5.2). They are
// armed only through trusted scenario stimuli or test fixtures (Req 5.6) — there
// is no unauthenticated/public arming surface (Req 5.5). One-shot faults clear
// as soon as they are consumed (Req 5.3); latency overrides persist until
// cleared. A fault only changes simulator wire behaviour and never writes an
// Aeolus lifecycle transition (Req 5.8).

import type { Logger } from "pino";
import type { FaultArmer, SimulatedFaultState } from "./types.js";

/** The fault behaviour applied to a single command, after one-shots are consumed. */
export interface ConsumedFault {
  rejectNext?: { reason: string };
  dropNextAck: boolean;
  suppressNextState: boolean;
  mismatchNextState?: Record<string, unknown>;
  ackDelayMs?: number;
  stateDelayMs?: number;
}

export interface FaultControllerDeps {
  /** Upper bound applied to armed latency values. */
  maxDelayMs: number;
  logger: Logger;
}

export class FaultController implements FaultArmer {
  private readonly faults = new Map<string, SimulatedFaultState>();
  private readonly deps: FaultControllerDeps;

  constructor(deps: FaultControllerDeps) {
    this.deps = deps;
  }

  arm(deviceKey: string, fault: Partial<SimulatedFaultState>): void {
    const existing = this.faults.get(deviceKey) ?? {};
    const merged: SimulatedFaultState = { ...existing };

    if (fault.rejectNext !== undefined) merged.rejectNext = fault.rejectNext;
    if (fault.dropNextAck !== undefined) merged.dropNextAck = fault.dropNextAck;
    if (fault.suppressNextState !== undefined) merged.suppressNextState = fault.suppressNextState;
    if (fault.mismatchNextState !== undefined) merged.mismatchNextState = fault.mismatchNextState;
    if (fault.ackDelayMs !== undefined) merged.ackDelayMs = this.clamp(fault.ackDelayMs);
    if (fault.stateDelayMs !== undefined) merged.stateDelayMs = this.clamp(fault.stateDelayMs);

    this.faults.set(deviceKey, merged);
    this.deps.logger.debug({ deviceKey, fault: merged }, "Armed simulator fault");
  }

  clear(deviceKey: string): void {
    this.faults.delete(deviceKey);
  }

  clearAll(): void {
    this.faults.clear();
  }

  /** Non-consuming inspection (tests/observability). */
  peek(deviceKey: string): Readonly<SimulatedFaultState> | undefined {
    return this.faults.get(deviceKey);
  }

  /**
   * Consume the fault behaviour applicable to one command. One-shot faults
   * (reject/drop/suppress/mismatch) are cleared here even if the command later
   * errors, which keeps tests deterministic (design §6.2). Latency overrides
   * persist until {@link clear}.
   */
  consume(deviceKey: string): ConsumedFault {
    const fault = this.faults.get(deviceKey);
    if (!fault) {
      return { dropNextAck: false, suppressNextState: false };
    }

    const consumed: ConsumedFault = {
      ...(fault.rejectNext ? { rejectNext: fault.rejectNext } : {}),
      dropNextAck: fault.dropNextAck === true,
      suppressNextState: fault.suppressNextState === true,
      ...(fault.mismatchNextState ? { mismatchNextState: fault.mismatchNextState } : {}),
      ...(fault.ackDelayMs !== undefined ? { ackDelayMs: fault.ackDelayMs } : {}),
      ...(fault.stateDelayMs !== undefined ? { stateDelayMs: fault.stateDelayMs } : {}),
    };

    // Clear the one-shot faults; keep only persistent latency overrides.
    const remaining: SimulatedFaultState = {};
    if (fault.ackDelayMs !== undefined) remaining.ackDelayMs = fault.ackDelayMs;
    if (fault.stateDelayMs !== undefined) remaining.stateDelayMs = fault.stateDelayMs;

    if (Object.keys(remaining).length === 0) {
      this.faults.delete(deviceKey);
    } else {
      this.faults.set(deviceKey, remaining);
    }

    return consumed;
  }

  private clamp(delayMs: number): number {
    if (Number.isNaN(delayMs) || delayMs <= 0) return 0;
    return Math.min(delayMs, this.deps.maxDelayMs);
  }
}
