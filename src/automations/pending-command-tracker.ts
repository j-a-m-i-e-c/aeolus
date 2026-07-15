// src/automations/pending-command-tracker.ts — Correlates MQTT acks/observations back to dispatched commands

import type { CommandLifecycleState } from "../core/types.js";
import { canTransition } from "./command-lifecycle.js";

/**
 * A correlated message a device published in reply to a dispatched command.
 *
 * The MQTT ingestion layer resolves the correlation id and extracts the
 * acknowledgement / observation indicators before handing the message here, so
 * the tracker is transport-agnostic and unit-testable without a broker.
 */
export interface AckMessage {
  /** Correlation id matching a Pending_Command. */
  correlationId: string;
  /** Acknowledgement_Indicator value (e.g. status="executed"). Non-empty = ack. */
  status?: string;
  /** Observation_Indicator payload / device state (e.g. { state: "running" }). */
  state?: Record<string, unknown>;
}

/** The confirmation tier a pending command must reach to resolve as success. */
export type RequiredTier = "acknowledged" | "observed";

/** A dispatched command awaiting acknowledgement and/or observation. */
export interface PendingCommand {
  correlationId: string;
  targetDeviceId: string;
  /** Device whose state is inspected for observation (may differ from target). */
  observedDeviceId: string;
  requiredTier: RequiredTier;
  /** Observation predicate; required when requiredTier === "observed". */
  condition?: (state: Record<string, unknown>) => boolean;
  /** Timeout in ms before the command transitions to TIMED_OUT. */
  timeoutMs: number;
  /**
   * Acknowledgement_Indicator values that count as an ack. When omitted, any
   * non-empty {@link AckMessage.status} counts as acknowledgement.
   */
  ackIndicatorValues?: string[];
}

/** The terminal resolution of a pending command. */
export interface PendingResolution {
  lifecycleState: CommandLifecycleState;
  success: boolean;
  error?: string;
}

/** Optional logging hook for late/duplicate arrivals and terminal transitions. */
export interface PendingCommandTrackerDeps {
  onResolve?: (correlationId: string, resolution: PendingResolution, targetDeviceId: string) => void;
  onLateMessage?: (correlationId: string) => void;
}

/** Internal bookkeeping for one outstanding command. */
interface TrackedEntry {
  command: PendingCommand;
  state: CommandLifecycleState;
  timer: ReturnType<typeof setTimeout>;
  resolve: (resolution: PendingResolution) => void;
}

/**
 * In-memory registry of outstanding commands, keyed by correlation id.
 *
 * The tracker owns the wiring between MQTT ack ingestion and the ActionExecutor:
 * `register()` is called by the ActionExecutor after dispatch, and `route()` /
 * `observeState()` are driven by the MQTT ingestion path. All transitions are
 * idempotent (guarded by the central lifecycle transition table), so duplicate
 * or late messages never re-resolve a command.
 *
 * The tracker is purely in-memory: on process restart or a mid-flight MQTT
 * reconnect, outstanding commands are lost. To guarantee a command never hangs,
 * each registration arms an OS timer that fires independently of MQTT
 * connectivity, resolving to TIMED_OUT if no satisfying reply arrives.
 */
export class PendingCommandTracker {
  private readonly pending = new Map<string, TrackedEntry>();
  private readonly deps: PendingCommandTrackerDeps;

  constructor(deps: PendingCommandTrackerDeps = {}) {
    this.deps = deps;
  }

  /**
   * Register a dispatched command awaiting ack/observation.
   *
   * Returns a promise that resolves exactly once with the terminal resolution
   * and never rejects. Starts the command in the DISPATCHED state and arms the
   * timeout immediately.
   */
  register(command: PendingCommand): Promise<PendingResolution> {
    return new Promise<PendingResolution>((resolve) => {
      const timer = setTimeout(() => {
        this.finalizeById(command.correlationId, "TIMED_OUT", false);
      }, command.timeoutMs);
      // Do not keep the process alive solely for a pending confirmation timer.
      (timer as { unref?: () => void }).unref?.();

      this.pending.set(command.correlationId, {
        command,
        state: "DISPATCHED",
        timer,
        resolve,
      });
    });
  }

  /**
   * Route a correlated reply to its pending command. Idempotent per tier;
   * unknown or late correlation ids are ignored (and optionally logged).
   */
  route(message: AckMessage): void {
    const entry = this.pending.get(message.correlationId);
    if (!entry) {
      this.deps.onLateMessage?.(message.correlationId);
      return;
    }

    // 1. Acknowledgement — advance to ACKNOWLEDGED at most once.
    if (this.isAcknowledgement(message, entry.command)) {
      if (canTransition(entry.state, "ACKNOWLEDGED")) {
        entry.state = "ACKNOWLEDGED";
      }
      if (entry.command.requiredTier === "acknowledged") {
        this.finalize(entry, "ACKNOWLEDGED", true);
        return;
      }
    }

    // 2. Observation — a correlated reply carrying state is a settled observation.
    if (message.state !== undefined && entry.command.requiredTier === "observed") {
      this.evaluateObservation(entry, message.state, /* settled */ true);
    }
  }

  /**
   * Feed a subsequent DEVICE_STATE_CHANGE for observation-only satisfaction.
   *
   * Ambient state changes are not settled observations: a non-satisfying state
   * is ignored (the command waits for a matching state or the timeout), while a
   * satisfying state resolves the command as OBSERVED.
   */
  observeState(deviceId: string, state: Record<string, unknown>): void {
    for (const entry of this.pending.values()) {
      if (entry.command.requiredTier !== "observed") continue;
      if (entry.command.observedDeviceId !== deviceId) continue;
      this.evaluateObservation(entry, state, /* settled */ false);
    }
  }

  /** True when a correlation id is currently outstanding. */
  has(correlationId: string): boolean {
    return this.pending.has(correlationId);
  }

  /** Number of outstanding commands (for observability/tests). */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Evaluate the observation predicate for a command.
   *
   * - predicate satisfied  → OBSERVED (success)
   * - predicate throws      → FAILED (failure, with the thrown message)
   * - not satisfied, settled → STATE_MISMATCH (failure)
   * - not satisfied, ambient → ignored (await a matching state or timeout)
   */
  private evaluateObservation(
    entry: TrackedEntry,
    state: Record<string, unknown>,
    settled: boolean,
  ): void {
    const condition = entry.command.condition;
    if (!condition) return;

    let satisfied: boolean;
    try {
      satisfied = condition(state);
    } catch (err) {
      this.finalize(entry, "FAILED", false, (err as Error).message);
      return;
    }

    if (satisfied) {
      this.finalize(entry, "OBSERVED", true);
      return;
    }

    if (settled) {
      this.finalize(entry, "STATE_MISMATCH", false);
    }
    // Ambient non-matching state — ignore until a matching state or the timeout.
  }

  /** True when the message's acknowledgement indicator confirms receipt. */
  private isAcknowledgement(message: AckMessage, command: PendingCommand): boolean {
    if (message.status === undefined || message.status === "") return false;
    if (command.ackIndicatorValues && command.ackIndicatorValues.length > 0) {
      return command.ackIndicatorValues.includes(message.status);
    }
    return true;
  }

  /** Resolve an entry to a terminal state (guarded by the transition table). */
  private finalize(
    entry: TrackedEntry,
    to: CommandLifecycleState,
    success: boolean,
    error?: string,
  ): void {
    // Only transition when allowed; otherwise treat as a no-op idempotently.
    if (entry.state !== to && !canTransition(entry.state, to)) return;

    clearTimeout(entry.timer);
    entry.state = to;
    this.pending.delete(entry.command.correlationId);

    const resolution: PendingResolution = { lifecycleState: to, success, ...(error ? { error } : {}) };
    this.deps.onResolve?.(entry.command.correlationId, resolution, entry.command.targetDeviceId);
    entry.resolve(resolution);
  }

  /** Finalize by correlation id (used by the timeout timer). */
  private finalizeById(correlationId: string, to: CommandLifecycleState, success: boolean): void {
    const entry = this.pending.get(correlationId);
    if (!entry) return;
    this.finalize(entry, to, success);
  }
}
