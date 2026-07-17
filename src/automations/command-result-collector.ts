// src/automations/command-result-collector.ts — Per-execution Command_Result sink (unified-command-boundary)

import { AsyncLocalStorage } from "node:async_hooks";
import type { CommandResult } from "./execution-types.js";

/**
 * Collects the Command_Results issued during an Automation_Execution, keyed by
 * `executionId`, preserving the exact order in which commands were issued
 * (Req 4.3, 5.1, 5.3).
 *
 * Form-rule closures push explicitly via {@link push}; sandbox host callbacks —
 * whose signatures stay unchanged — push via {@link pushCurrent}, which resolves
 * the active `executionId` from the {@link context} AsyncLocalStorage. This lets
 * results be attributed to the correct execution even when multiple executions
 * interleave (Req 6.7).
 */
export class CommandResultCollector {
  private readonly buffers = new Map<string, CommandResult[]>();

  /** Carries the active executionId across the async execution chain. */
  readonly context = new AsyncLocalStorage<string>();

  /** Begin collecting for an execution. Resets any prior buffer for the id. */
  open(executionId: string): void {
    this.buffers.set(executionId, []);
  }

  /**
   * Append a Command_Result in issue order for an explicit execution. If the
   * execution was not opened, a buffer is created so no result is ever dropped.
   */
  push(executionId: string, result: CommandResult): void {
    const buffer = this.buffers.get(executionId);
    if (buffer === undefined) {
      this.buffers.set(executionId, [result]);
      return;
    }
    buffer.push(result);
  }

  /**
   * Append for the execution currently on the AsyncLocalStorage context. A no-op
   * when there is no active execution context.
   */
  pushCurrent(result: CommandResult): void {
    const executionId = this.context.getStore();
    if (executionId === undefined) return;
    this.push(executionId, result);
  }

  /**
   * Finish collecting and return the ordered results for an execution (Req 4.3).
   * Removes the buffer; a subsequent close for the same id returns an empty list.
   */
  close(executionId: string): CommandResult[] {
    const buffer = this.buffers.get(executionId) ?? [];
    this.buffers.delete(executionId);
    return buffer;
  }
}
