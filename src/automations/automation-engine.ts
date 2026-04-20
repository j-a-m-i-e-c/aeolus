// src/automations/automation-engine.ts — Rule evaluation engine

import type { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEVICE_STATE_CHANGE, AUTOMATION_FIRED } from "../core/event-bus.js";
import type { NormalizedEvent, EventContext, Rule } from "../core/types.js";
import type { Sandbox, SandboxContext } from "./sandbox.js";
import type { ActionExecutor } from "./action-executor.js";
import type { ExecutionLog, ExecutionLogEntry } from "./execution-log.js";
import { RuleRegistry } from "./rule-registry.js";
import logger from "../logger.js";

/** Optional dependencies for script/form rule execution. */
export interface AutomationEngineDeps {
  sandbox?: Sandbox;
  actionExecutor?: ActionExecutor;
  executionLog?: ExecutionLog;
}

export class AutomationEngine {
  private registry: RuleRegistry;
  private eventBus: EventEmitter;
  private sandbox?: Sandbox;
  private actionExecutor?: ActionExecutor;
  private executionLog?: ExecutionLog;

  constructor(eventBus: EventEmitter, deps?: AutomationEngineDeps) {
    this.registry = new RuleRegistry();
    this.eventBus = eventBus;
    this.sandbox = deps?.sandbox;
    this.actionExecutor = deps?.actionExecutor;
    this.executionLog = deps?.executionLog;
    this.eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
      this.evaluate(event);
    });
  }

  /** Register a rule */
  register(rule: Rule): void {
    this.registry.register(rule);
    logger.debug({ ruleId: rule.id, topic: rule.topic, name: rule.name }, "Rule registered");
  }

  /** Remove a rule */
  unregister(ruleId: string): void {
    this.registry.unregister(ruleId);
  }

  /** List all rules */
  listRules(): Rule[] {
    return this.registry.listRules();
  }

  /** Get a rule by ID */
  getRule(id: string): Rule | undefined {
    return this.registry.getRule(id);
  }

  /** Get rule count */
  get ruleCount(): number {
    return this.registry.size;
  }

  /** Load rule files from a directory */
  async loadRulesFromDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      logger.warn({ dir }, "Automations directory does not exist, skipping");
      return;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    let loaded = 0;

    for (const file of files) {
      try {
        const filePath = path.resolve(dir, file);
        const fileUrl = pathToFileURL(filePath).href;
        const mod = await import(fileUrl);

        // Support default export (single rule) or named exports (multiple rules)
        if (mod.default && typeof mod.default === "object" && mod.default.id) {
          this.register(mod.default as Rule);
          loaded++;
        }

        // Also check for named rule exports
        for (const [key, value] of Object.entries(mod)) {
          if (key !== "default" && typeof value === "object" && value !== null && "id" in value && "topic" in value) {
            this.register(value as Rule);
            loaded++;
          }
        }
      } catch (err) {
        logger.error({ file, error: (err as Error).message }, "Failed to load rule file, skipping");
      }
    }

    logger.info({ dir, loaded, total: files.length }, "Loaded automation rules");
  }

  /** Evaluate all matching rules for an event */
  private evaluate(event: NormalizedEvent): void {
    const ctx: EventContext = {
      topic: event.topic,
      deviceId: event.deviceId,
      state: event.state,
      timestamp: event.timestamp,
    };

    const rules = this.registry.listRules();

    for (const rule of rules) {
      if (!this.topicMatches(rule.topic, event.topic)) continue;

      try {
        if (rule.condition && !rule.condition(ctx)) continue;

        // Check if this is a script rule (has compiled_js attached)
        const compiledJs = (rule as unknown as Record<string, unknown>).compiled_js as string | undefined;

        if (compiledJs && this.sandbox) {
          // Script rule — dispatch through Sandbox
          this.executeScriptRule(rule, compiledJs, ctx);
        } else {
          // File-based DSL rule or form rule — execute action directly
          this.executeDirectRule(rule, ctx);
        }
      } catch (err) {
        logger.error(
          { ruleId: rule.id, topic: event.topic, error: (err as Error).message },
          "Rule action threw error",
        );
      }
    }
  }

  /** Execute a script rule through the Sandbox with execution logging. */
  private executeScriptRule(rule: Rule, compiledJs: string, ctx: EventContext): void {
    const start = Date.now();
    const sandboxContext: SandboxContext = {
      topic: ctx.topic,
      deviceId: ctx.deviceId,
      state: ctx.state,
      timestamp: ctx.timestamp,
    };

    const promise = this.sandbox!.execute(compiledJs, sandboxContext, rule.id);
    promise
      .then(() => {
        const duration = Date.now() - start;
        this.recordExecution(rule, ctx, duration, true);
        this.eventBus.emit(AUTOMATION_FIRED, {
          ruleId: rule.id,
          ruleName: rule.name || "Unnamed Rule",
          topic: ctx.topic,
          deviceId: ctx.deviceId,
          timestamp: Date.now(),
        });
      })
      .catch((err) => {
        const duration = Date.now() - start;
        this.recordExecution(rule, ctx, duration, false, (err as Error).message);
        logger.error(
          { ruleId: rule.id, error: (err as Error).message },
          "Script rule execution failed",
        );
      });
  }

  /** Execute a file-based DSL rule or form rule directly. */
  private executeDirectRule(rule: Rule, ctx: EventContext): void {
    const start = Date.now();

    const result = rule.action(ctx);

    // Emit automation fired event for the event log
    this.eventBus.emit(AUTOMATION_FIRED, {
      ruleId: rule.id,
      ruleName: rule.name || "Unnamed Rule",
      topic: ctx.topic,
      deviceId: ctx.deviceId,
      timestamp: Date.now(),
    });

    if (result instanceof Promise) {
      result
        .then(() => {
          const duration = Date.now() - start;
          this.recordExecution(rule, ctx, duration, true);
        })
        .catch((err) => {
          const duration = Date.now() - start;
          this.recordExecution(rule, ctx, duration, false, (err as Error).message);
          logger.error(
            { ruleId: rule.id, error: (err as Error).message },
            "Async rule action failed",
          );
        });
    } else {
      const duration = Date.now() - start;
      this.recordExecution(rule, ctx, duration, true);
    }
  }

  /** Record an execution entry in the ExecutionLog if available. */
  private recordExecution(
    rule: Rule,
    ctx: EventContext,
    duration: number,
    success: boolean,
    error?: string,
  ): void {
    if (!this.executionLog) return;

    const compiledJs = (rule as unknown as Record<string, unknown>).compiled_js as string | undefined;
    const ruleType: ExecutionLogEntry["ruleType"] = compiledJs ? "script" : "file";

    const entry: ExecutionLogEntry = {
      id: randomUUID(),
      ruleId: rule.id,
      ruleName: rule.name || "Unnamed Rule",
      ruleType,
      triggerTopic: ctx.topic,
      actions: [
        {
          type: ruleType === "script" ? "script" : "action",
          target: ctx.topic,
          success,
          ...(error ? { error } : {}),
        },
      ],
      duration,
      timestamp: Date.now(),
    };

    this.executionLog.push(entry);
  }

  /** Check if a rule topic pattern matches an event topic */
  private topicMatches(pattern: string, topic: string): boolean {
    // Exact match
    if (pattern === topic) return true;

    // MQTT wildcard matching
    const patternParts = pattern.split("/");
    const topicParts = topic.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === "#") return true; // Multi-level wildcard
      if (patternParts[i] === "+") continue; // Single-level wildcard
      if (i >= topicParts.length || patternParts[i] !== topicParts[i]) return false;
    }

    return patternParts.length === topicParts.length;
  }
}