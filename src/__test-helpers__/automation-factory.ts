import type { EventEmitter } from "node:events";
import { AutomationEngine } from "../automations/automation-engine.js";
import { ExecutionLog } from "../automations/execution-log.js";
import { ExecutionRecorder } from "../automations/execution-recorder.js";
import { CommandResultCollector } from "../automations/command-result-collector.js";
import logger from "../logger.js";

export interface TestAutomationEngine {
  engine: AutomationEngine;
  executionLog: ExecutionLog;
}

/**
 * Create an AutomationEngine wired to the event bus with an execution log.
 * No sandbox (isolated-vm) — tests use direct action rules only.
 *
 * The engine records through the single Execution_Owner (ExecutionRecorder),
 * built here around the shared ExecutionLog (unified-command-boundary).
 */
export function createTestAutomationEngine(
  eventBus: EventEmitter,
): TestAutomationEngine {
  const executionLog = new ExecutionLog();
  const executionRecorder = new ExecutionRecorder({ eventBus, executionLog, logger });
  const collector = new CommandResultCollector();
  const engine = new AutomationEngine(eventBus, { executionRecorder, collector });
  return { engine, executionLog };
}
