import type { EventEmitter } from "node:events";
import { AutomationEngine } from "../automations/automation-engine.js";
import { ExecutionLog } from "../automations/execution-log.js";

export interface TestAutomationEngine {
  engine: AutomationEngine;
  executionLog: ExecutionLog;
}

/**
 * Create an AutomationEngine wired to the event bus with an execution log.
 * No sandbox (isolated-vm) — tests use direct action rules only.
 */
export function createTestAutomationEngine(
  eventBus: EventEmitter,
): TestAutomationEngine {
  const executionLog = new ExecutionLog();
  const engine = new AutomationEngine(eventBus, { executionLog });
  return { engine, executionLog };
}
