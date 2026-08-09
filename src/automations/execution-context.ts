// src/automations/execution-context.ts
// phase-1-runtime-foundations Task 7 — narrow, read-only active-execution context.
//
// Carries the active automation execution identity and its triggering causation
// across the async execution chain via AsyncLocalStorage. CommandService reads
// it through the ExecutionContextProvider boundary (design §2.3) to stamp
// commands with executionId/causationId WITHOUT coupling to the automation
// runtime. Commands issued outside an automation see `undefined`.

import { AsyncLocalStorage } from "node:async_hooks";

import type { EventMetadata } from "../core/types.js";

/** The active automation execution context, when a command runs inside one. */
export interface ActiveExecutionContext {
  executionId: string;
  /** Triggering event id (causation) so emitted commands/events link back. */
  causationId?: string;
  /** Authoring automation rule id. */
  automationId?: string;
  /**
   * Full metadata of the triggering event, when the trigger carried one. Used
   * to propagate the trace id and enforce the bounded causal depth of emitted
   * Automation Events (phase-1 Req 6.15).
   */
  triggerMeta?: EventMetadata;
}

const store = new AsyncLocalStorage<ActiveExecutionContext>();

/** Run `fn` with `ctx` as the active execution context. */
export function runInExecutionContext<T>(ctx: ActiveExecutionContext, fn: () => T): T {
  return store.run(ctx, fn);
}

/** The active execution context, or undefined outside any automation execution. */
export function currentExecutionContext(): ActiveExecutionContext | undefined {
  return store.getStore();
}
