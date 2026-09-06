// src/automations/command-lifecycle.ts — Central command lifecycle transition table and tier selection

import type { CommandLifecycleState } from "../core/types.js";

/**
 * Allowed forward transitions for the command lifecycle. Any transition not
 * listed here is rejected as a no-op by {@link canTransition}, which centrally
 * enforces the monotonic-advance property.
 *
 *   REQUESTED    -> DISPATCHED | FAILED
 *   DISPATCHED   -> ACKNOWLEDGED | OBSERVED | FAILED | TIMED_OUT | STATE_MISMATCH
 *   ACKNOWLEDGED -> OBSERVED | FAILED | TIMED_OUT | STATE_MISMATCH
 *   FAILED, OBSERVED, TIMED_OUT, STATE_MISMATCH are terminal.
 */
const ALLOWED_TRANSITIONS: Record<CommandLifecycleState, readonly CommandLifecycleState[]> = {
  REQUESTED: ["DISPATCHED", "FAILED"],
  DISPATCHED: ["ACKNOWLEDGED", "OBSERVED", "FAILED", "TIMED_OUT", "STATE_MISMATCH"],
  ACKNOWLEDGED: ["OBSERVED", "FAILED", "TIMED_OUT", "STATE_MISMATCH"],
  OBSERVED: [],
  FAILED: [],
  TIMED_OUT: [],
  STATE_MISMATCH: [],
};

/** Lifecycle-final states — no later evidence can advance them. */
const TERMINAL_STATES: ReadonlySet<CommandLifecycleState> = new Set([
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
]);

/**
 * States that can satisfy a configured completion tier. `DISPATCHED` and
 * `ACKNOWLEDGED` are completion states, not lifecycle-final states: later
 * evidence may still advance the lifecycle when the command is being tracked.
 * Callers combine this with the command's required tier to decide success.
 */
const SUCCESS_STATES: ReadonlySet<CommandLifecycleState> = new Set([
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
]);

/** The confirmation tier a command must reach to resolve as success. */
export type ConfirmationTier = "dispatch" | "acknowledged" | "observed";

/**
 * Per-rung evidence recorded alongside a lifecycle transition.
 *
 * Persisted to `command_transitions.details`, which is durable and — through an
 * automation's own projection — operator-visible. It is therefore a named shape
 * rather than free-form JSON: what an operator is told about a rung is a
 * decision, not whatever happened to be in scope at the call site.
 *
 * Every field is optional because the rungs genuinely differ. `REQUESTED` states
 * the contract the command must satisfy; `TIMED_OUT` restates it because that is
 * precisely what went unmet; `DISPATCHED` has little to add beyond having
 * happened.
 */
export interface CommandEvidence {
  /** The completion tier this command must reach to count as proven. */
  tier?: ConfirmationTier;
  /** Device whose observed state settles the question, when not the target. */
  observedDeviceId?: string;
  /**
   * The condition being waited for, as plain data. Recorded so an operator can be
   * told WHAT was required, not merely that something was. Never re-evaluated
   * from here — the live predicate is owned by the tracker.
   */
  condition?: Record<string, unknown>;
  /** Bound on the confirmation wait, in ms. */
  timeoutMs?: number;
  /** Short operator-facing account of why this rung was reached. */
  reason?: string;
}

/**
 * Build a {@link CommandEvidence} from parts, or `undefined` when nothing is
 * known.
 *
 * Returning `undefined` for an empty result keeps `details` NULL rather than
 * writing `{}`, so "no evidence recorded" stays distinguishable from "evidence
 * recorded, and it was empty".
 */
export function buildCommandEvidence(parts: CommandEvidence): CommandEvidence | undefined {
  const evidence: CommandEvidence = {};
  if (parts.tier !== undefined) evidence.tier = parts.tier;
  if (parts.observedDeviceId !== undefined) evidence.observedDeviceId = parts.observedDeviceId;
  if (parts.condition !== undefined) evidence.condition = parts.condition;
  if (parts.timeoutMs !== undefined) evidence.timeoutMs = parts.timeoutMs;
  if (parts.reason !== undefined && parts.reason !== "") evidence.reason = parts.reason;
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

/**
 * The standing account of what each terminal rung means, in operator language.
 *
 * Kept next to the transition table so a new lifecycle state cannot be added
 * without deciding what it tells an operator.
 */
const RUNG_REASONS: Record<CommandLifecycleState, string> = {
  REQUESTED: "Command accepted into the pipeline; nothing has been dispatched yet",
  DISPATCHED: "The connector accepted the dispatch",
  ACKNOWLEDGED: "The device acknowledged receiving the command",
  OBSERVED: "Observed device state satisfied the required condition",
  FAILED: "The command failed",
  TIMED_OUT: "No satisfying reply arrived within the confirmation window",
  STATE_MISMATCH: "The device reported a state that contradicts the command",
};

/**
 * Describe a rung for an operator. `error` wins when present, because a device's
 * own account of a failure is better evidence than a generic label.
 */
export function describeRung(state: CommandLifecycleState, error?: string): string {
  return error && error.length > 0 ? error : RUNG_REASONS[state];
}

/**
 * Return true when a command may advance from `from` to `to`.
 *
 * Rejecting a disallowed transition (returning false) lets the caller treat it
 * as a no-op, preserving the monotonic-advance invariant even under duplicate
 * or late messages.
 */
export function canTransition(from: CommandLifecycleState, to: CommandLifecycleState): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Return true only when no lifecycle transition can follow `state`. */
export function isTerminal(state: CommandLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Return true when `state` can satisfy some success/completion tier
 * (DISPATCHED, ACKNOWLEDGED, OBSERVED). This does not imply lifecycle finality.
 */
export function isSuccessState(state: CommandLifecycleState): boolean {
  return SUCCESS_STATES.has(state);
}

/**
 * Select the highest confirmation tier available for a command, following the
 * ordering Observed > Acknowledged > Dispatch (Req 9.6):
 *   - `observed`     when Confirmation_Options are supplied
 *   - `acknowledged` when no confirm but the connector declares an ack capability
 *   - `dispatch`     otherwise
 */
export function selectRequiredTier(hasConfirm: boolean, hasAckCapability: boolean): ConfirmationTier {
  if (hasConfirm) return "observed";
  if (hasAckCapability) return "acknowledged";
  return "dispatch";
}
