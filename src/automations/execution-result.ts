// src/automations/execution-result.ts — Pure assembly of AutomationExecutionResult (unified-command-boundary)

import type { AutomationExecutionResult, CommandResult } from "./execution-types.js";

/** The outcome of a rule's execution logic, independent of individual commands. */
export interface LogicOutcome {
  /** Did the rule's execution logic complete without error? */
  ok: boolean;
  /** Logic failure detail (sandbox failure reason/message, thrown error). */
  error?: string;
}

/**
 * Combine the execution logic outcome with the collected command results into
 * the single {@link AutomationExecutionResult} (Req 4.4–4.8, 5.2, 5.4, 5.7).
 *
 * Semantics:
 *  - `success === true` **iff** `logic.ok` AND every present `commandResults[i].success === true`.
 *  - Zero commands + `logic.ok` ⇒ `success:true` with an empty `commandResults` (Req 4.7).
 *  - Any failing command ⇒ `success:false`, `failureReason` identifies at least the
 *    first failing result (Req 4.5).
 *  - A `null`/`undefined` entry (Command_Service returned no result) ⇒ `success:false`,
 *    `failureReason` indicates the missing command result (Req 5.7).
 *  - Logic failed with no failing/missing command ⇒ `success:false`, `failureReason`
 *    describes the logic failure (Req 4.6).
 *  - A populated `failureReason` is never paired with `success:true` (Req 4.8) — it is
 *    only ever set on the `success:false` branch.
 */
export function assembleExecutionResult(
  executionId: string,
  logic: LogicOutcome,
  commandResults: ReadonlyArray<CommandResult | null | undefined>,
): AutomationExecutionResult {
  const results = [...commandResults] as CommandResult[];

  // First problem in issue order: a missing (null/undefined) or failing command.
  const firstProblemIndex = commandResults.findIndex(
    (r) => r === null || r === undefined || r.success === false,
  );

  if (logic.ok && firstProblemIndex === -1) {
    return { executionId, success: true, commandResults: results };
  }

  let failureReason: string;
  if (firstProblemIndex !== -1) {
    const problem = commandResults[firstProblemIndex];
    if (problem === null || problem === undefined) {
      failureReason = `Missing command result at index ${firstProblemIndex}`;
    } else {
      failureReason = problem.error != null && problem.error.length > 0
        ? `Command ${firstProblemIndex} failed: ${problem.error}`
        : `Command ${firstProblemIndex} failed`;
    }
  } else {
    failureReason = logic.error != null && logic.error.length > 0
      ? logic.error
      : "Automation execution logic failed";
  }

  return { executionId, success: false, commandResults: results, failureReason };
}
