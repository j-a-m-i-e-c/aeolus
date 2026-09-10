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
 * The capability context a command was accepted under, frozen at acceptance.
 *
 * Presentation has to tell three different stories apart, all of which leave the
 * ACKNOWLEDGED stage unreached: the device cannot acknowledge at all, an
 * acknowledgement was not required for this particular command, or one was required
 * and never arrived. Only recorded context separates them, and it has to be recorded
 * rather than looked up later — a device profile edited next month must not rewrite
 * what last month's command could have proven.
 *
 * `observationConfigured` is a statement about THIS command, not about the site. A
 * `false` means this command carried no observation contract; it never means the
 * effect was inherently unobservable or that no suitable sensor exists.
 */
export interface CommandCapabilitySnapshot {
  /** The highest tier this command could have proven, given the target and its inputs. */
  capabilityCeiling: ConfirmationTier;
  /** True when the target declared a correlated-acknowledgement capability. */
  ackAvailable: boolean;
  /** True when this command carried an observation contract. */
  observationConfigured: boolean;
  /** Device whose telemetry settles the question. May be the target itself. */
  observedDeviceId?: string;
  /** The observation contract as plain data, exactly as accepted. Never re-evaluated. */
  conditionSpec?: Record<string, unknown>;
  /** Integration the command was handed to, e.g. "mqtt". Names the transport, not the device. */
  transportKind?: string;
  /** Target device's display name at acceptance, so old evidence still reads in human terms. */
  targetDeviceName?: string;
  /** Observing device's display name at acceptance. */
  observedDeviceName?: string;
}

/**
 * Author-supplied semantic context for a command.
 *
 * This is the one part of a command record the author gets to write, and it is
 * deliberately narrow: what the operation *was*, and what a satisfied observation
 * *means*. The lifecycle state, the tier, the devices and the condition stay
 * platform-owned, so no author text can dress a dispatch up as an observation.
 */
export interface CommandIntent {
  /** What this operation was, e.g. "Transfer 500 L". */
  intent?: string;
  /** What a satisfied observation means, e.g. "Flow detected". */
  observedLabel?: string;
}

/**
 * Longest author-supplied evidence label kept.
 *
 * Present because these strings are persisted per command and rendered in a compact
 * receipt. A label is a caption, not a place to narrate; anything longer is the
 * author using the wrong field.
 */
export const MAX_EVIDENCE_LABEL_LENGTH = 120;

/**
 * Normalise one author-supplied label, or `undefined` when nothing usable was given.
 *
 * Control characters are stripped rather than escaped at render time: the value
 * crosses into a durable record, an admin API and a sandboxed UI, and the narrow
 * fix at the boundary is cheaper to reason about than trusting three consumers to
 * neutralise it. Whitespace is collapsed so a multi-line template literal cannot
 * break the receipt's layout.
 */
export function sanitiseEvidenceLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length > MAX_EVIDENCE_LABEL_LENGTH
    ? collapsed.slice(0, MAX_EVIDENCE_LABEL_LENGTH)
    : collapsed;
}

/** Normalise an author-supplied {@link CommandIntent}, dropping empty fields. */
export function sanitiseCommandIntent(intent: CommandIntent | undefined): CommandIntent | undefined {
  if (!intent) return undefined;
  const label = sanitiseEvidenceLabel(intent.intent);
  const observedLabel = sanitiseEvidenceLabel(intent.observedLabel);
  if (label === undefined && observedLabel === undefined) return undefined;
  return {
    ...(label !== undefined ? { intent: label } : {}),
    ...(observedLabel !== undefined ? { observedLabel } : {}),
  };
}

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
  // Deliberately says handed-to-transport, never received-by-device. Aeolus knows
  // the transport accepted the command; whether the hardware got it is the next
  // rung's question, and only a device that can acknowledge ever answers it.
  DISPATCHED: "Aeolus handed the command to the device transport; receipt is not yet proven",
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
