// frontend/src/sandbox/ui-kit/command-proof.ts — the fixed four-stage Command Proof
//
// Aeolus distinguishes asking for a physical action from proving what actually
// happened. This module is where that distinction becomes something an operator can
// read, and its central design decision is that the scaffold is FIXED:
//
//     REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED
//
// always four stages, always in that order, whatever the command managed to prove.
//
// The previous model returned only the rungs that happened. That was honest but it
// taught nothing: a dispatch-only command rendered as a tidy two-line list, so a
// visitor had no way to learn that ACKNOWLEDGED and OBSERVED exist, let alone that
// this particular device cannot reach them. A variable-length ladder hides exactly
// the capability gap that makes Aeolus interesting.
//
// So an unreached stage is still rendered, and it has to say WHY it was not reached.
// Those reasons are genuinely different and must never be conflated:
//
//   unavailable      the hardware cannot do this — no ack capability exists
//   not-required     it could have, but this command did not ask
//   not-configured   no observation contract was attached to this command
//   pending          still expected; the command has not settled
//   failed           this is where proof stopped
//   not-reached      an earlier stage failed, so this never came up
//
// What this module will not do: derive, infer or soften. A stage reads `reached` only
// when a transition recorded it. `unavailable` is asserted only from a recorded
// capability snapshot, never guessed from a stage's absence — absence is not evidence
// of incapability, and a command from before the snapshot existed says "not recorded"
// instead of inventing a `false`.
//
// The input is exactly what `devices.commandEvidence()` returns, so Logic projects it
// with no reshaping.

import { asRecord, asText, toFiniteNumber, tokens } from "./primitives";

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** The four canonical stages, in lifecycle order. */
export const PROOF_STAGES = ["REQUESTED", "DISPATCHED", "ACKNOWLEDGED", "OBSERVED"] as const;

export type ProofStage = (typeof PROOF_STAGES)[number];

/**
 * What a stage is saying.
 *
 * Six of these render as "not a tick", and keeping them distinct is the whole point:
 * `unavailable` is a fact about the hardware, `not-required` a fact about this
 * command, `not-configured` a fact about its contract, and `failed` the only one that
 * is bad news.
 */
export type ProofStageStatus =
  | "reached"
  | "pending"
  | "failed"
  | "unavailable"
  | "not-required"
  | "not-configured"
  | "not-reached"
  | "not-recorded";

/** One stage of the fixed scaffold, ready to render. */
export interface CommandProofStage {
  /** Canonical Aeolus lifecycle term. Render it verbatim, in brackets, to teach the model. */
  state: ProofStage;
  /** Bespoke, command-specific line, e.g. "Flow meter reports litresPerMinute > 0". */
  label: string;
  status: ProofStageStatus;
  /** When the stage was reached, or `null`. */
  at: number | null;
  /** Supporting evidence, or `""`. */
  detail: string;
}

/** A command's proof, as one object a pane can render compactly or in full. */
export interface CommandProof {
  /** What the operation was. The author's `evidence.intent`, else a derived fallback. */
  intent: string;
  /** The tier actually proven, or the failure. Never a bare "verified". */
  headline: string;
  /** Single-character status glyph, safe in any font. */
  mark: string;
  /** True once the command stopped waiting, either way. */
  settled: boolean;
  /** True only when it satisfied its required tier. */
  proven: boolean;
  /** "Transfer Pump → Transfer Flow Meter", or just the actuator when nothing observed it. */
  chain: string;
  /** Exactly four stages, REQUESTED first. */
  stages: CommandProofStage[];
  /** The tier this command was held to. */
  tier: string;
  /** The highest tier it could have proven, or `""` when not recorded. */
  ceiling: string;
  /** True when the author asked for a tier the command could not prove. */
  clamped: boolean;
  /** The clamp explained, or `""`. */
  clampNote: string;
  /** Actuator display name, or `""`. */
  targetDeviceName: string;
  /** Observing device display name, or `""`. */
  observedDeviceName: string;
  /** The observation contract read aloud, e.g. "litresPerMinute > 0", or `""`. */
  conditionText: string;
  commandId: string;
  executionId: string;
}

const FAILURE_STATES: ReadonlySet<string> = new Set(["FAILED", "TIMED_OUT", "STATE_MISMATCH"]);

/** Rank of the stage a tier requires: dispatch reaches stage 1, observed stage 3. */
const TIER_TARGET_RANK: Record<string, number> = {
  dispatch: 1,
  acknowledged: 2,
  observed: 3,
};

/** The status word for a command that satisfied its tier. Scaled to the tier, never inflated. */
const TIER_HEADLINES: Record<string, string> = {
  dispatch: "DISPATCHED",
  acknowledged: "ACKNOWLEDGED",
  observed: "OBSERVED",
};

/** How each failure reads as a headline. */
const FAILURE_HEADLINES: Record<string, string> = {
  FAILED: "FAILED",
  TIMED_OUT: "TIMED OUT",
  STATE_MISMATCH: "STATE MISMATCH",
};

/**
 * How each transport reads in a DISPATCHED line.
 *
 * Named because "Dispatched via MQTT" is a true and useful statement, where "Sent to
 * the device" was neither: dispatch proves Aeolus handed the command to a transport,
 * and nothing about what the hardware then did with it.
 */
const TRANSPORT_LABELS: Record<string, string> = {
  mqtt: "MQTT",
  hue: "the Hue bridge",
  kasa: "the Kasa connector",
};

const CONDITION_OPS: Record<string, string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

// ── Condition rendering ──────────────────────────────────────────────────────

/**
 * Render an observed-state condition the way it would be read aloud.
 *
 * The condition is the most explanatory part of a verified command: "measuredRpm ≥
 * 2000" says what a bare "verified" never can.
 */
export function describeCondition(condition: unknown): string {
  const spec = asRecord(condition);
  if (!spec) return "";

  for (const [key, joiner] of [["all", " and "], ["any", " or "]] as const) {
    const branch = spec[key];
    if (Array.isArray(branch)) {
      const parts = branch.map((entry) => describeCondition(entry)).filter((part) => part.length > 0);
      return parts.length > 0 ? parts.join(joiner) : "";
    }
  }

  const field = asText(spec.field);
  const op = typeof spec.op === "string" ? CONDITION_OPS[spec.op] : undefined;
  if (field === "" || op === undefined || spec.value === undefined) return "";
  return `${field} ${op} ${String(spec.value)}`;
}

// ── Internal shape reading ───────────────────────────────────────────────────

interface ReachedStage {
  at: number | null;
  detail: string;
}

/** The evidence text for one recorded rung, preferring the recorded reason. */
function rungDetail(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const reason = asText(details.reason);
  const condition = describeCondition(details.condition);
  if (condition === "") return reason;
  const waited = `waiting for ${condition}`;
  return reason === "" ? waited : `${reason} · ${waited}`;
}

/** Index the recorded transitions by the stage they reached, plus any failure. */
function readTransitions(record: Record<string, unknown>): {
  reached: Map<ProofStage, ReachedStage>;
  failure: { state: string; at: number | null; detail: string } | null;
} {
  const reached = new Map<ProofStage, ReachedStage>();
  let failure: { state: string; at: number | null; detail: string } | null = null;

  const transitions = Array.isArray(record.transitions) ? record.transitions : [];
  for (const entry of transitions) {
    const transition = asRecord(entry);
    if (!transition) continue;
    const state = asText(transition.toState);
    if (state === "") continue;
    const at = toFiniteNumber(transition.timestamp);
    const detail = rungDetail(asRecord(transition.details));

    if (FAILURE_STATES.has(state)) {
      failure = { state, at, detail };
      continue;
    }
    if ((PROOF_STAGES as readonly string[]).includes(state)) {
      reached.set(state as ProofStage, { at, detail });
    }
  }

  return { reached, failure };
}

// ── Stage labels ─────────────────────────────────────────────────────────────

/**
 * The bespoke line for a reached stage.
 *
 * Bespoke where the record supports it and generic only where it does not, because
 * "Flow meter reports litresPerMinute > 0" teaches what "Effect observed" cannot.
 * The canonical term still travels alongside in `state`, so readability never costs
 * the standard vocabulary.
 */
function reachedLabel(stage: ProofStage, ctx: ProofContext): string {
  switch (stage) {
    case "REQUESTED":
      return "Accepted by Aeolus";
    case "DISPATCHED": {
      const transport = ctx.transportKind === "" ? "" : (TRANSPORT_LABELS[ctx.transportKind] ?? ctx.transportKind);
      // Never "sent to the device": dispatch is a fact about the transport.
      return transport === "" ? "Command dispatched" : `Dispatched via ${transport}`;
    }
    case "ACKNOWLEDGED":
      return ctx.targetDeviceName === ""
        ? "Device acknowledged the command"
        : `${ctx.targetDeviceName} acknowledged the command`;
    case "OBSERVED": {
      // Prefer the author's account of what the reading means, then the sensor and
      // its contract, then the bare fact.
      const source = ctx.observedDeviceName === "" ? "" : ctx.observedDeviceName;
      if (ctx.observedLabel !== "") {
        return source === "" ? ctx.observedLabel : `${source}: ${ctx.observedLabel}`;
      }
      if (source !== "" && ctx.conditionText !== "") return `${source} reports ${ctx.conditionText}`;
      if (source !== "") return `${source} confirmed the effect`;
      if (ctx.conditionText !== "") return `Measured ${ctx.conditionText}`;
      return "Physical effect observed";
    }
  }
}

/** The line for a stage that was never reached, naming the reason. */
function unreachedLabel(stage: ProofStage, status: ProofStageStatus, ctx: ProofContext): string {
  if (status === "pending") {
    switch (stage) {
      case "DISPATCHED":
        return "Waiting to be dispatched";
      case "ACKNOWLEDGED":
        return "Waiting for the device to acknowledge";
      case "OBSERVED":
        return ctx.conditionText === ""
          ? "Waiting for the physical effect"
          : `Waiting for ${ctx.conditionText}`;
      default:
        return "Waiting";
    }
  }

  if (status === "failed") {
    return stage === "DISPATCHED" ? "Dispatch failed" : "Never proven";
  }

  if (status === "not-reached") return "Not reached";

  if (status === "not-recorded") {
    // A command older than the capability snapshot. Saying so is better than
    // asserting a capability it never recorded either way.
    return "Not recorded for this command";
  }

  switch (stage) {
    case "ACKNOWLEDGED":
      if (status === "unavailable") return "No acknowledgement capability on this device";
      return "Acknowledgement not required for this command";
    case "OBSERVED":
      if (status === "not-configured") return "No physical observation configured";
      return "Observation not required for this command";
    default:
      return "Not applicable";
  }
}

// ── Status resolution ────────────────────────────────────────────────────────

interface ProofContext {
  transportKind: string;
  targetDeviceName: string;
  observedDeviceName: string;
  observedLabel: string;
  conditionText: string;
  ackAvailable: boolean | undefined;
  observationConfigured: boolean | undefined;
  targetRank: number;
}

/**
 * Why a stage above the command's required tier was skipped.
 *
 * The distinction the spec insists on: if the hardware cannot acknowledge, say
 * unavailable; if it can but this command did not ask, say not required. Guessing
 * either from the stage's absence would be the exact dishonesty this model exists to
 * remove, so an unrecorded capability says so.
 */
function skipStatus(stage: ProofStage, ctx: ProofContext): ProofStageStatus {
  if (stage === "ACKNOWLEDGED") {
    if (ctx.ackAvailable === false) return "unavailable";
    if (ctx.ackAvailable === undefined) return "not-recorded";
    return "not-required";
  }
  if (stage === "OBSERVED") {
    if (ctx.observationConfigured === false) return "not-configured";
    if (ctx.observationConfigured === undefined) return "not-recorded";
    return "not-required";
  }
  return "not-required";
}

/**
 * Resolve every stage's status in one pass over the fixed scaffold.
 *
 * The ordering rule that matters: a failure attaches to the lowest stage that was
 * both REQUIRED and unreached. Attaching it to the next stage numerically would blame
 * ACKNOWLEDGED for an observation timeout on a device that never had an ack
 * capability to begin with.
 */
function resolveStages(
  reached: Map<ProofStage, ReachedStage>,
  failure: { state: string; at: number | null; detail: string } | null,
  settled: boolean,
  ctx: ProofContext,
): CommandProofStage[] {
  // Which stages this command actually had to pass through.
  const required = new Map<ProofStage, boolean>();
  PROOF_STAGES.forEach((stage, index) => {
    const rank = index;
    if (rank === 0 || rank === 1) {
      required.set(stage, true); // every command is requested and dispatched
      return;
    }
    if (rank > ctx.targetRank) {
      required.set(stage, false);
      return;
    }
    if (stage === "ACKNOWLEDGED") required.set(stage, ctx.ackAvailable !== false);
    else if (stage === "OBSERVED") required.set(stage, ctx.observationConfigured !== false);
    else required.set(stage, true);
  });

  // The failure lands on the first required stage that never happened.
  const failedStage = failure
    ? (PROOF_STAGES.find((stage) => required.get(stage) === true && !reached.has(stage)) ?? null)
    : null;
  const failedRank = failedStage === null ? -1 : PROOF_STAGES.indexOf(failedStage);

  return PROOF_STAGES.map((stage, rank) => {
    const hit = reached.get(stage);
    if (hit) {
      return { state: stage, label: reachedLabel(stage, ctx), status: "reached" as const, at: hit.at, detail: hit.detail };
    }

    let status: ProofStageStatus;
    if (failure && stage === failedStage) {
      status = "failed";
    } else if (failure && failedRank >= 0 && rank > failedRank) {
      // Everything past the break genuinely never came up.
      status = required.get(stage) === true ? "not-reached" : skipStatus(stage, ctx);
    } else if (required.get(stage) !== true) {
      status = skipStatus(stage, ctx);
    } else if (!settled) {
      status = "pending";
    } else {
      // Settled, required, no failure, yet unreached: the command's own requirement
      // was met at another stage, so this one was never the thing being proven.
      status = skipStatus(stage, ctx);
    }

    const detail = status === "failed" && failure ? failure.detail : "";
    return { state: stage, label: unreachedLabel(stage, status, ctx), status, at: null, detail };
  });
}

// ── Public builder ───────────────────────────────────────────────────────────

/**
 * Build the fixed four-stage proof for a command.
 *
 * Returns `null` when there is no command to describe, so a pane renders nothing
 * rather than an empty scaffold asserting a command that may not exist.
 */
export function commandProof(evidence: unknown): CommandProof | null {
  const record = asRecord(evidence);
  if (!record) return null;
  const lifecycleState = asText(record.lifecycleState);
  if (lifecycleState === "") return null;

  const tier = asText(record.effectiveTier) === "" ? "dispatch" : asText(record.effectiveTier);
  const requested = asText(record.requestedTier);
  const ceiling = asText(record.capabilityCeiling);
  const settled = toFiniteNumber(record.terminalAt) !== null;
  const proven = settled && record.success === true;

  const conditionText = describeCondition(record.conditionSpec);
  const targetDeviceName = asText(record.targetDeviceName);
  const observedDeviceName = asText(record.observedDeviceName);

  const ctx: ProofContext = {
    transportKind: asText(record.transportKind),
    targetDeviceName,
    observedDeviceName,
    observedLabel: asText(record.observedLabel),
    conditionText,
    ackAvailable: typeof record.ackAvailable === "boolean" ? record.ackAvailable : undefined,
    observationConfigured:
      typeof record.observationConfigured === "boolean" ? record.observationConfigured : undefined,
    targetRank: TIER_TARGET_RANK[tier] ?? 1,
  };

  const { reached, failure } = readTransitions(record);
  const stages = resolveStages(reached, failure, settled, ctx);

  // A clamp is the ask exceeding what the DEVICE can prove, measured against the
  // recorded ceiling. Comparing the ask to the effective tier alone cannot tell "the
  // device could not" from "the author asked for less on purpose", and the spec is
  // explicit that a deliberate lower tier is correct rather than embarrassing — asking
  // for less than the ceiling is a choice, so `requested` below `ceiling` is never a
  // clamp.
  //
  // This used to additionally require `ceiling === tier`, which silently dropped the
  // case the distinction explains best: a command asking for `observed` on a device
  // whose ceiling is `acknowledged` but which only reached `dispatch`. The ceiling row
  // appeared and the clamp note did not, so the one command that was BOTH overruled and
  // then failed short of even its ceiling was the one that explained neither.
  //
  // Where the command also fell short of the ceiling, that is a separate fact and the
  // stages already carry it. The note speaks only to the clamp, which is why it names
  // the device's limit rather than this command's outcome.
  const requestedRank = TIER_TARGET_RANK[requested] ?? 0;
  const ceilingRank = TIER_TARGET_RANK[ceiling] ?? 0;
  const clamped = requested !== "" && ceiling !== "" && requestedRank > ceilingRank;

  return {
    intent: proofIntent(record, ctx),
    headline: !settled
      ? "IN FLIGHT"
      : proven
        ? (TIER_HEADLINES[tier] ?? "PROVEN")
        : (FAILURE_HEADLINES[lifecycleState] ?? "NOT PROVEN"),
    mark: !settled ? "○" : proven ? "✓" : "✕",
    settled,
    proven,
    chain:
      observedDeviceName !== "" && observedDeviceName !== targetDeviceName
        ? `${targetDeviceName} → ${observedDeviceName}`
        : targetDeviceName,
    stages,
    tier,
    ceiling,
    clamped,
    clampNote: clamped ? `Asked for ${requested}; this device can prove at most ${ceiling}` : "",
    targetDeviceName,
    observedDeviceName,
    conditionText,
    commandId: asText(record.commandId),
    executionId: asText(record.executionId),
  };
}

/**
 * What to call this command.
 *
 * The author's intent when there is one, because "Transfer 500 L" is what an operator
 * recognises. Falling back to the action type is deliberately last: `device_action`
 * names the mechanism rather than the operation, which is why intent exists at all.
 */
function proofIntent(record: Record<string, unknown>, ctx: ProofContext): string {
  const intent = asText(record.intentLabel);
  if (intent !== "") return intent;
  const actionType = asText(record.actionType);
  if (ctx.targetDeviceName !== "") {
    return actionType === "" ? ctx.targetDeviceName : `${ctx.targetDeviceName} · ${actionType}`;
  }
  return actionType === "" ? "Physical command" : actionType;
}

// ── Presentation ─────────────────────────────────────────────────────────────

/** Presentation for one stage: a glyph plus the style matching its status. */
export interface ProofStageVisual {
  /** A single character standing in for the status, safe in any font. */
  mark: string;
  style: Record<string, string | number>;
  /** Style for the canonical `(REQUESTED)` term rendered alongside the label. */
  termStyle: Record<string, string | number>;
}

const STAGE_BASE: Record<string, string | number> = {
  fontFamily: tokens.font.sans,
  fontSize: 11,
  display: "flex",
  gap: 6,
  alignItems: "baseline",
  padding: "2px 0",
};

const TERM_BASE: Record<string, string | number> = {
  fontFamily: tokens.font.mono,
  fontSize: 9.5,
  letterSpacing: ".06em",
  color: tokens.color.textMuted,
  marginLeft: "auto",
  flexShrink: 0,
};

/**
 * Resolve how a stage should look.
 *
 * Kept here rather than in each pane so the statuses cannot come to mean different
 * things on different tabs. The three "not a tick" families are visually distinct on
 * purpose: a failure is an error, a pending stage is warm and unresolved, and a stage
 * that was never applicable is muted — it is not bad news and must not read as if it
 * were.
 */
export function proofStageProps(stage: CommandProofStage): ProofStageVisual {
  const term = { ...TERM_BASE };
  switch (stage.status) {
    case "reached":
      return { mark: "✓", style: { ...STAGE_BASE, color: tokens.color.success }, termStyle: term };
    case "failed":
      return { mark: "✕", style: { ...STAGE_BASE, color: tokens.color.error }, termStyle: term };
    case "pending":
      return { mark: "○", style: { ...STAGE_BASE, color: tokens.color.warning }, termStyle: term };
    default:
      // unavailable | not-required | not-configured | not-reached | not-recorded.
      // An em dash rather than a cross: nothing went wrong here.
      return {
        mark: "—",
        style: { ...STAGE_BASE, color: tokens.color.textMuted, opacity: 0.75 },
        termStyle: term,
      };
  }
}

/** Style for a {@link CommandProof} headline, matching the stage colours. */
export function proofHeadlineProps(proof: CommandProof): Record<string, string | number> {
  const color = !proof.settled
    ? tokens.color.warning
    : proof.proven
      ? tokens.color.success
      : tokens.color.error;
  return {
    fontFamily: tokens.font.sans,
    fontSize: 11,
    fontWeight: 850,
    letterSpacing: ".08em",
    color,
  };
}
