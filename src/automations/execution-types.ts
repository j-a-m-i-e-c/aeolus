// src/automations/execution-types.ts — Shared execution/command result types (unified-command-boundary)

import type { ActionResult } from "../core/types.js";

/**
 * The per-command outcome value returned by {@link CommandService}.
 *
 * A `Command_Result` is exactly the {@link ActionResult} from
 * device-action-system-uplift carrying a `lifecycleState` from
 * verified-command-execution. It is reused here, not redefined — this alias
 * only documents intent at call sites that deal with a single physical
 * command's outcome.
 */
export type CommandResult = ActionResult;

/**
 * The structured outcome of one Automation_Execution (Req 4.1).
 *
 * A single instance flows through both form-rule and script-rule execution and
 * is consumed by the Execution_Owner to record history, metrics, the completion
 * event, and audit — all derived from this one value.
 */
export interface AutomationExecutionResult {
  /** Unique among concurrently-active executions; not reused while active (Req 4.2). */
  executionId: string;
  /** True iff logic completed AND every commandResult.success is true (Req 4.4, 4.7). */
  success: boolean;
  /** Each issued command's Command_Result, in the order issued (Req 4.3). */
  commandResults: CommandResult[];
  /** Present iff success === false; identifies the failure cause (Req 4.5, 4.6, 4.8). */
  failureReason?: string;
}
