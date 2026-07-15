/**
 * Execution History — in-memory ring buffer for automation execution logs.
 *
 * Records every automation execution for debugging. Capped at 200 entries
 * to keep memory usage bounded on constrained devices (Raspberry Pi).
 */

import type { CommandLifecycleState } from "../core/types.js";
import type { SandboxFailureReason } from "./sandbox.js";

export interface ExecutionLogEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: "form" | "script";
  triggerTopic: string;
  actions: Array<{
    type: string;
    target: string;
    success: boolean;
    error?: string;
    /** Categorized script-failure cause (script rules only). Additive — optional. */
    reason?: SandboxFailureReason;
    /** Final command lifecycle state (device commands). Additive — optional. */
    lifecycleState?: CommandLifecycleState;
  }>;
  duration: number; // ms
  timestamp: number;
}

export class ExecutionLog {
  private entries: ExecutionLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  /** Append an entry, evicting the oldest if the buffer is full. */
  push(entry: ExecutionLogEntry): void {
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }
    this.entries.push(entry);
  }

  /** Return the most recent entries (newest first). */
  list(limit?: number): ExecutionLogEntry[] {
    const reversed = [...this.entries].reverse();
    if (limit !== undefined && limit >= 0) {
      return reversed.slice(0, limit);
    }
    return reversed;
  }

  /** Return all entries for a given rule ID (newest first). */
  getByRuleId(ruleId: string): ExecutionLogEntry[] {
    return [...this.entries].filter((e) => e.ruleId === ruleId).reverse();
  }
}
