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
  /**
   * Documented acknowledgement outcome. `true` confirms the command; `false`
   * is a terminal device-reported failure.
   */
  success?: boolean;
  /** Device-supplied reason when {@link success} is `false`. */
  error?: string;
  /**
   * Convenience extraction of the default acknowledgement indicator
   * (`payload.status`). Non-empty counts as an ack when no explicit
   * {@link PendingCommand.ackIndicatorField} is configured. For an arbitrary
   * configured indicator field the tracker reads {@link payload} directly.
   */
  status?: string;
  /**
   * The full parsed JSON ack body, when the reply was a JSON object. Used to
   * read a device-configured acknowledgement indicator field (e.g.
   * `ackIndicatorField: "result"`). Never itself treated as an observation.
   */
  payload?: Record<string, unknown>;
  /**
   * A settled observation the device explicitly supplied alongside its ack, in
   * a dedicated `state` object (e.g. `{ correlationId, success, state: { running: true } }`).
   *
   * This is ONLY set when the device deliberately reports observed state on the
   * ack channel — a plain `{ success: true }` ack carries no observation and must
   * NOT be evaluated against an observation predicate. Ambient observation still
   * arrives through {@link PendingCommandTracker.observeState} from device state.
   */
  state?: Record<string, unknown>;
}

/** The confirmation tier a pending command must reach to resolve as success. */
export type RequiredTier = "acknowledged" | "observed";

/** A dispatched command awaiting acknowledgement and/or observation. */
export interface PendingCommand {
  /**
   * Stable Aeolus command identity (phase-1). Carried from `CommandService` so
   * intermediate transitions can be attributed without a correlation→command DB
   * lookup (locked decision 6). Optional until the transition hook lands in Task 4.
   */
  commandId?: string;
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
   * Name of the ack-payload field whose value confirms receipt. Defaults to
   * `"status"`. Lets arbitrary MQTT hardware acknowledge through a custom field
   * (e.g. `{ result: "executed" }` with `ackIndicatorField: "result"`).
   */
  ackIndicatorField?: string;
  /**
   * Acknowledgement_Indicator values that count as an ack. When omitted, any
   * non-empty indicator-field value counts as acknowledgement.
   */
  ackIndicatorValues?: string[];
}

/** The completion resolution of a pending command at its configured tier. */
export interface PendingResolution {
  lifecycleState: CommandLifecycleState;
  success: boolean;
  error?: string;
}

/**
 * An intermediate (non-terminal) lifecycle transition observed by the tracker,
 * reported so the composition layer can persist it (phase-1 Req 3.5). Carries
 * `commandId` so the recorder needs no correlation→command DB lookup (locked
 * decision 7). The tracker itself never touches the database.
 */
export interface PendingCommandTransition {
  commandId?: string;
  correlationId: string;
  targetDeviceId: string;
  fromState: CommandLifecycleState;
  toState: CommandLifecycleState;
  timestamp: number;
}

/** Optional logging hook for late/duplicate arrivals and completion transitions. */
export interface PendingCommandTrackerDeps {
  onResolve?: (correlationId: string, resolution: PendingResolution, targetDeviceId: string) => void;
  onLateMessage?: (correlationId: string) => void;
  /**
   * Reports an intermediate transition (currently ACKNOWLEDGED reached while an
   * observed-tier command keeps waiting for OBSERVED). Completion transitions are
   * recorded by the CommandService from the awaited resolution, so they are not
   * re-emitted here. Never invoked with the database — the recorder is composed.
   */
  onTransition?: (event: PendingCommandTransition) => void;
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
 * The tracker owns the wiring between MQTT acknowledgement ingestion and the CommandService:
 * `register()` is called by the CommandService after dispatch, and `route()` /
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
   * Returns a promise that resolves exactly once with the configured completion resolution
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

    // A device can explicitly reject a command using the documented response
    // envelope. This must win over any accompanying status or state payload:
    // a failed command cannot become acknowledged or observed successfully.
    if (message.success === false) {
      this.finalize(
        entry,
        "FAILED",
        false,
        message.error || "Device reported command failure",
      );
      return;
    }

    // 1. Acknowledgement — advance to ACKNOWLEDGED at most once.
    if (this.isAcknowledgement(message, entry.command)) {
      const advanced = canTransition(entry.state, "ACKNOWLEDGED");
      if (advanced) {
        entry.state = "ACKNOWLEDGED";
      }
      if (entry.command.requiredTier === "acknowledged") {
        // ACKNOWLEDGED completes an ack-tier wait; the CommandService records it
        // from the awaited resolution, so no intermediate emission. It is not a
        // lifecycle-final state in the shared transition vocabulary.
        this.finalize(entry, "ACKNOWLEDGED", true);
        return;
      }
      // Observed-tier: ACK is an intermediate milestone before observation.
      // Report it (once) so the durable timeline keeps both the ACKNOWLEDGED and
      // the later observed/failure completion transition (Req 3.5).
      if (advanced) {
        this.deps.onTransition?.({
          ...(entry.command.commandId ? { commandId: entry.command.commandId } : {}),
          correlationId: entry.command.correlationId,
          targetDeviceId: entry.command.targetDeviceId,
          fromState: "DISPATCHED",
          toState: "ACKNOWLEDGED",
          timestamp: Date.now(),
        });
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

  /**
   * Cancel an outstanding command because its dispatch failed to complete.
   *
   * Clears the timeout timer, removes the entry from the pending map, and
   * settles the `register()` promise by RESOLVING it with a lifecycle-final FAILED
   * resolution so any awaiter unblocks (Req 12.4, 12.5). This is a dispatch
   * unwind, not a confirmation outcome, so `deps.onResolve` is intentionally
   * NOT invoked — the CommandService owns the returned FAILED result and its
   * logging. Idempotent: a second cancel (or any late routed message) finds no
   * entry and does nothing.
   */
  cancel(correlationId: string): void {
    const entry = this.pending.get(correlationId);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(correlationId);
    entry.resolve({ lifecycleState: "FAILED", success: false });
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
    // `success: true` is Aeolus' documented acknowledgement protocol. It is
    // independent of connector-specific/custom indicator-field values.
    if (message.success === true) return true;

    const indicator = this.ackIndicatorValue(message, command);
    if (indicator === undefined || indicator === "") return false;
    if (command.ackIndicatorValues && command.ackIndicatorValues.length > 0) {
      return command.ackIndicatorValues.includes(indicator);
    }
    return true;
  }

  /**
   * Read the acknowledgement indicator value from the ack message using the
   * command's configured {@link PendingCommand.ackIndicatorField} (default
   * `"status"`). Prefers the value carried in the full parsed {@link
   * AckMessage.payload}; falls back to the pre-extracted {@link
   * AckMessage.status} for the default field (so callers that build an
   * AckMessage with only `status` still work). Only string indicator values are
   * honoured.
   */
  private ackIndicatorValue(message: AckMessage, command: PendingCommand): string | undefined {
    const field = command.ackIndicatorField ?? "status";
    const fromPayload = message.payload?.[field];
    if (typeof fromPayload === "string") return fromPayload;
    if (field === "status" && typeof message.status === "string") return message.status;
    return undefined;
  }

  /** Resolve an entry at its configured completion state (guarded by the transition table). */
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
