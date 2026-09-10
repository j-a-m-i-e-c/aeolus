// frontend/src/sandbox/ui-kit/command-execution.ts
// showcase-cleanup §2.7 — one operation's worth of proof, not one command's.
//
// `commandProof()` answers "what did this command prove?". That is the wrong unit
// whenever a single operator click causes several physical actions. A stage cue moves
// the lighting desk and then fires the effects rack: two commands, one thing the
// operator did. Rendered as two independent receipts they read as unrelated activity;
// rendered as one they read as what happened.
//
// Worse, the pattern the showcase had actually LOST information. Logic kept a single
// `lastCommand` state key, so the second command overwrote the first and the pane
// reported half the operation while looking complete.
//
// The grouping key is the executionId the platform already stamps on every command,
// so this module invents no relationship — it projects one that is already durable.
//
// Two things it deliberately does not do:
//
//   It does not give the group a tier. A cue whose lighting desk reached OBSERVED and
//   whose effects rack reached ACKNOWLEDGED has no single tier, and picking either one
//   would misreport the other. The group reports how many commands proved what was
//   asked of them; each command keeps its own tier.
//
//   It does not guess the trigger. The trigger is read from the command records, where
//   the runtime stamped it at acceptance. Deriving it from the button that was clicked
//   would produce nothing for a device-triggered execution and would disagree with the
//   record whenever the two drifted.

import { commandProof, type CommandProof } from "./command-proof";
import { asRecord, asText, toFiniteNumber } from "./primitives";

/** Everything one automation execution proved, as one object a pane can render. */
export interface CommandExecutionProof {
  executionId: string;
  /**
   * What caused the execution, in human terms — `operator "start-cue"`,
   * `sensor/mine/gas` — or `""` when the records carry no trigger.
   */
  trigger: string;
  /** One proof per command, in the order they were issued. */
  commands: CommandProof[];
  /** How many commands the execution issued. */
  count: number;
  /** True once every command in the group has stopped waiting. */
  settled: boolean;
  /** True only when every command settled AND proved the tier asked of it. */
  proven: boolean;
  /** How many proved their tier. The group's actual verdict. */
  provenCount: number;
  /**
   * The group's standing, e.g. `"3 OF 3 PROVEN"`. Never a tier: a group of commands
   * that reached different tiers does not have one.
   */
  headline: string;
  /** Single-character status glyph, safe in any font. */
  mark: string;
  /** Wall time from the first request to the last settlement, or `null` if unsettled. */
  durationMs: number | null;
  /** `"3 commands · 2.1 s"`, or `"3 commands"` when it has not settled. */
  summary: string;
}

/**
 * Read the trigger off a command record.
 *
 * The topic is preferred because it is the field that is always recorded — the
 * manual/operator fire path builds its context without event metadata, so `kind`
 * is absent for exactly the executions a visitor is most likely to be looking at.
 *
 * A UI fire arrives as `ui/<ruleId>/<eventName>`, which is machine-facing. The rule
 * id is noise to an operator (they are looking at that automation's pane), so it is
 * dropped and the event name is quoted verbatim. Verbatim rather than prettified:
 * the event name is what the automation actually handled, and rewriting it would put
 * a caption between the operator and the record.
 */
export function describeTrigger(evidence: unknown): string {
  const record = asRecord(evidence);
  if (!record) return "";

  const topic = asText(record.triggerTopic);
  const kind = asText(record.triggerKind);
  const id = asText(record.triggerId);

  if (topic !== "") {
    const ui = /^ui\/[^/]+\/(.+)$/.exec(topic);
    if (ui) return `operator "${ui[1]}"`;
    return topic;
  }

  // No topic recorded. Fall back to the originator, which at least names a class.
  if (kind === "") return "";
  return id === "" ? kind : `${kind} ${id}`;
}

/** Round to one decimal place and drop a trailing `.0`, so 2100ms reads "2.1 s". */
function formatSeconds(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
}

/**
 * Build the grouped proof for one execution.
 *
 * Accepts exactly what `devices.executionEvidence()` returns, so Logic projects it
 * with no reshaping. A bare array of evidence records is accepted too, for a pane
 * that assembled the group itself.
 *
 * Returns `null` when there is no execution to describe or when it issued no
 * readable commands, so a pane renders nothing rather than an empty group header
 * asserting an operation that may not have happened.
 */
export function commandExecutionProof(evidence: unknown): CommandExecutionProof | null {
  const group = asRecord(evidence);
  const rawCommands = Array.isArray(evidence)
    ? evidence
    : group && Array.isArray(group.commands)
      ? group.commands
      : null;
  if (!rawCommands || rawCommands.length === 0) return null;

  const commands: CommandProof[] = [];
  let firstRequestedAt: number | null = null;
  let lastTerminalAt: number | null = null;
  let allSettled = true;

  for (const entry of rawCommands) {
    const proof = commandProof(entry);
    // Skip an unreadable member rather than failing the group: a receipt for two of
    // three commands is worth more than none, and the count reports what was read.
    if (!proof) continue;
    commands.push(proof);

    const record = asRecord(entry);
    const requestedAt = toFiniteNumber(record?.requestedAt);
    const terminalAt = toFiniteNumber(record?.terminalAt);
    if (requestedAt !== null && (firstRequestedAt === null || requestedAt < firstRequestedAt)) {
      firstRequestedAt = requestedAt;
    }
    if (terminalAt !== null && (lastTerminalAt === null || terminalAt > lastTerminalAt)) {
      lastTerminalAt = terminalAt;
    }
    if (!proof.settled) allSettled = false;
  }

  if (commands.length === 0) return null;

  const provenCount = commands.filter((proof) => proof.proven).length;
  const proven = allSettled && provenCount === commands.length;

  // Duration spans the whole group, first request to last settlement — the elapsed
  // time of the operation, which is what an operator is judging. Only claimed once
  // everything has settled; a partial span would understate a group still running.
  const durationMs =
    allSettled && firstRequestedAt !== null && lastTerminalAt !== null
      ? Math.max(0, lastTerminalAt - firstRequestedAt)
      : null;

  const noun = commands.length === 1 ? "command" : "commands";
  const summary =
    durationMs === null
      ? `${commands.length} ${noun}`
      : `${commands.length} ${noun} · ${formatSeconds(durationMs)}`;

  // Fall back to the group's own executionId, then to any member's. A pane that
  // passed a bare array still gets the id every member agrees on.
  const executionId =
    asText(group?.executionId) !== "" ? asText(group?.executionId) : commands[0]!.executionId;

  return {
    executionId,
    // The group object carries the trigger when the host built it; otherwise read it
    // off the first member, which was stamped from the same execution.
    trigger:
      describeTrigger(group) !== "" ? describeTrigger(group) : describeTrigger(rawCommands[0]),
    commands,
    count: commands.length,
    settled: allSettled,
    proven,
    provenCount,
    headline: !allSettled ? "IN FLIGHT" : `${provenCount} OF ${commands.length} PROVEN`,
    mark: !allSettled ? "○" : proven ? "✓" : "✕",
    durationMs,
    summary,
  };
}
