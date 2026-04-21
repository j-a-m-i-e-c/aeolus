// src/api/routes/automation.routes.ts — Automation rules CRUD

import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Database } from "sql.js";
import type { AutomationEngine } from "../../automations/automation-engine.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { ActionExecutor, ActionDescriptor } from "../../automations/action-executor.js";
import type { ExecutionLog } from "../../automations/execution-log.js";
import type { EventContext } from "../../core/types.js";
import { transpile } from "../../automations/transpiler.js";
import { extractStructuredMetadata } from "../../automations/structured-metadata-extractor.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import { persistDatabase } from "../../db/database.js";
import logger from "../../logger.js";

interface StoredRule {
  id: string;
  name: string;
  trigger_topic: string;
  condition_type: string | null;
  condition_value: string | null;
  action_type: string;
  action_target: string;
  action_params: string;
  rule_type: "form" | "script";
  script_source: string | null;
  compiled_js: string | null;
  structured_metadata: string | null;
  ui_source: string | null;
  enabled: number;
  created_at: number;
}

export function createAutomationRoutes(
  engine: AutomationEngine,
  db: Database,
  registry: DeviceRegistry,
  actionExecutor: ActionExecutor,
  executionLog: ExecutionLog,
  sandboxTypesPath: string,
): Router {
  const router = Router();

  /** GET /api/automations/types — serve sandbox type definitions as text/plain */
  router.get("/types", (_req, res, next) => {
    try {
      if (!fs.existsSync(sandboxTypesPath)) {
        res.status(500).json({ error: "Type definitions not available", statusCode: 500 });
        return;
      }
      const content = fs.readFileSync(sandboxTypesPath, "utf-8");
      res.type("text/plain").send(content);
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/automations/history — return execution log entries */
  router.get("/history", (req, res) => {
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const ruleId = req.query.ruleId as string | undefined;

    let entries;
    if (ruleId) {
      entries = executionLog.getByRuleId(ruleId);
      if (limit !== undefined && limit >= 0) {
        entries = entries.slice(0, limit);
      }
    } else {
      entries = executionLog.list(limit);
    }

    res.json(entries);
  });

  /** GET /api/automations — list all rules (file + UI) */
  router.get("/", (_req, res) => {
    // File-based rules from the engine (exclude UI-registered rules by checking DB)
    const dbIds = new Set<string>();
    const dbResults = db.exec("SELECT id FROM automation_rules");
    if (dbResults.length > 0) {
      for (const values of dbResults[0].values) {
        dbIds.add(values[0] as string);
      }
    }

    const fileRules = engine.listRules()
      .filter((rule) => !dbIds.has(rule.id))
      .map((rule) => ({
        id: rule.id,
        topic: rule.topic,
        name: rule.name || null,
        hasCondition: !!rule.condition,
        source: "file" as const,
        ruleType: "file" as const,
        enabled: true,
      }));

    // UI-created rules from DB
    const results = db.exec("SELECT * FROM automation_rules ORDER BY created_at DESC");
    const dbRules: Record<string, unknown>[] = [];
    if (results.length > 0) {
      const cols = results[0].columns;
      for (const values of results[0].values) {
        const row: Record<string, unknown> = {};
        cols.forEach((col: string, i: number) => { row[col] = values[i]; });
        const ruleType = (row.rule_type as string) || "form";
        const entry: Record<string, unknown> = {
          id: row.id,
          name: row.name,
          topic: row.trigger_topic,
          hasCondition: !!row.condition_type,
          source: "ui",
          ruleType,
          enabled: row.enabled === 1,
        };
        if (ruleType === "form") {
          entry.actionType = row.action_type;
          entry.actionTarget = row.action_target;
          entry.actionParams = JSON.parse(row.action_params as string);
          entry.conditionType = row.condition_type;
          entry.conditionValue = row.condition_value;
        } else if (ruleType === "script") {
          entry.scriptSource = row.script_source;
          entry.conditionType = row.condition_type;
          entry.conditionValue = row.condition_value;
          const rawMeta = row.structured_metadata as string | null;
          entry.structured = rawMeta ? JSON.parse(rawMeta) : null;
        }
        dbRules.push(entry);
      }
    }

    res.json([...fileRules, ...dbRules]);
  });

  /** POST /api/automations — create a new UI rule (form or script) */
  router.post("/", (req, res, next) => {
    try {
      const { name, triggerTopic, ruleType, conditionType, conditionValue, actionType, actionTarget, actionParams, scriptSource } = req.body;

      if (!name || !triggerTopic) {
        throw new BadRequestError("name and triggerTopic are required");
      }

      const id = randomUUID();
      const now = Date.now();

      if (ruleType === "script") {
        // Script rule — transpile and store
        if (!scriptSource) {
          throw new BadRequestError("scriptSource is required for script rules");
        }
        const result = transpile(scriptSource);
        if (!result.success) {
          res.status(400).json({
            error: "TypeScript compilation failed",
            statusCode: 400,
            details: result.errors,
          });
          return;
        }

        const structured = extractStructuredMetadata(result.js, triggerTopic);
        const structuredJson = structured ? JSON.stringify(structured) : null;

        db.run(
          `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, script_source, compiled_js, structured_metadata, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, 'script', '', '{}', 'script', ?, ?, ?, 1, ?)`,
          [id, name, triggerTopic, conditionType || null, conditionValue || null, scriptSource, result.js, structuredJson, now]
        );
        persistDatabase();

        registerUiRule(engine, registry, actionExecutor, {
          id, name, trigger_topic: triggerTopic,
          condition_type: conditionType || null, condition_value: conditionValue || null,
          action_type: "script", action_target: "", action_params: "{}",
          rule_type: "script", script_source: scriptSource, compiled_js: result.js,
          structured_metadata: structuredJson, ui_source: null,
          enabled: 1, created_at: now,
        });

        logger.info({ ruleId: id, name, triggerTopic, ruleType: "script" }, "Script automation rule created");
        res.json({ success: true, id });
      } else {
        // Form rule (default)
        if (!actionType || !actionTarget) {
          throw new BadRequestError("actionType and actionTarget are required for form rules");
        }

        db.run(
          `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'form', 1, ?)`,
          [id, name, triggerTopic, conditionType || null, conditionValue || null, actionType, actionTarget, JSON.stringify(actionParams || {}), now]
        );
        persistDatabase();

        registerUiRule(engine, registry, actionExecutor, {
          id, name, trigger_topic: triggerTopic,
          condition_type: conditionType || null, condition_value: conditionValue || null,
          action_type: actionType, action_target: actionTarget,
          action_params: JSON.stringify(actionParams || {}),
          rule_type: "form", script_source: null, compiled_js: null,
          structured_metadata: null, ui_source: null,
          enabled: 1, created_at: now,
        });

        logger.info({ ruleId: id, name, triggerTopic }, "Form automation rule created");
        res.json({ success: true, id });
      }
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/automations/:id — update an existing UI rule */
  router.put("/:id", (req, res, next) => {
    try {
      const id = req.params.id as string;

      // Check rule exists
      const existing = queryRuleById(db, id);
      if (!existing) {
        throw new NotFoundError(`Automation rule ${id} not found`);
      }

      const { name, triggerTopic, conditionType, conditionValue, actionType, actionTarget, actionParams, scriptSource } = req.body;

      if (existing.rule_type === "script") {
        // Script rule update — re-transpile
        const updatedSource = scriptSource ?? existing.script_source;
        if (!updatedSource) {
          throw new BadRequestError("scriptSource is required for script rules");
        }
        const result = transpile(updatedSource);
        if (!result.success) {
          res.status(400).json({
            error: "TypeScript compilation failed",
            statusCode: 400,
            details: result.errors,
          });
          return;
        }

        const structured = extractStructuredMetadata(result.js, triggerTopic || existing.trigger_topic);
        const structuredJson = structured ? JSON.stringify(structured) : null;

        db.run(
          `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, script_source = ?, compiled_js = ?, structured_metadata = ? WHERE id = ?`,
          [name || existing.name, triggerTopic || existing.trigger_topic, conditionType ?? existing.condition_type, conditionValue ?? existing.condition_value, updatedSource, result.js, structuredJson, id]
        );
        persistDatabase();

        // Re-register in engine
        engine.unregister(id);
        const updated = queryRuleById(db, id)!;
        if (updated.enabled) {
          registerUiRule(engine, registry, actionExecutor, updated);
        }

        logger.info({ ruleId: id, name: updated.name }, "Script automation rule updated");
        res.json({ success: true, id });
      } else {
        // Form rule update
        db.run(
          `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, action_type = ?, action_target = ?, action_params = ? WHERE id = ?`,
          [
            name || existing.name,
            triggerTopic || existing.trigger_topic,
            conditionType ?? existing.condition_type,
            conditionValue ?? existing.condition_value,
            actionType || existing.action_type,
            actionTarget || existing.action_target,
            JSON.stringify(actionParams || JSON.parse(existing.action_params)),
            id,
          ]
        );
        persistDatabase();

        // Re-register in engine
        engine.unregister(id);
        const updated = queryRuleById(db, id)!;
        if (updated.enabled) {
          registerUiRule(engine, registry, actionExecutor, updated);
        }

        logger.info({ ruleId: id, name: updated.name }, "Form automation rule updated");
        res.json({ success: true, id });
      }
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/automations/:id — delete a UI rule */
  router.delete("/:id", (req, res, next) => {
    try {
      const id = req.params.id as string;
      const existing = queryRuleById(db, id);
      if (!existing) {
        throw new NotFoundError(`Automation rule ${id} not found`);
      }
      db.run("DELETE FROM automation_rules WHERE id = ?", [id]);
      persistDatabase();
      engine.unregister(id);
      logger.info({ ruleId: id, ruleType: existing.rule_type }, "Automation rule deleted");
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /api/automations/:id/toggle — enable/disable a UI rule */
  router.patch("/:id/toggle", (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { enabled } = req.body;

      const existing = queryRuleById(db, id);
      if (!existing) {
        throw new NotFoundError(`Automation rule ${id} not found`);
      }

      db.run("UPDATE automation_rules SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id]);
      persistDatabase();

      if (enabled) {
        // Re-register — reload from DB to get latest state
        const updated = queryRuleById(db, id)!;
        registerUiRule(engine, registry, actionExecutor, updated);
      } else {
        engine.unregister(id);
      }

      res.json({ success: true, enabled: !!enabled });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Query a single rule from the DB by ID */
function queryRuleById(db: Database, id: string): StoredRule | null {
  const results = db.exec(`SELECT * FROM automation_rules WHERE id = '${id}'`);
  if (results.length === 0 || results[0].values.length === 0) return null;
  const cols = results[0].columns;
  const row: Record<string, unknown> = {};
  cols.forEach((col: string, i: number) => { row[col] = results[0].values[0][i]; });
  return row as unknown as StoredRule;
}

/** Convert a stored UI rule into a live automation rule and register it */
function registerUiRule(
  engine: AutomationEngine,
  registry: DeviceRegistry,
  actionExecutor: ActionExecutor,
  stored: StoredRule,
): void {
  // Build condition
  let condition: ((ctx: EventContext) => boolean) | undefined;
  if (stored.condition_type === "value_above" && stored.condition_value) {
    const threshold = Number(stored.condition_value);
    condition = (ctx) => Number(ctx.state.value) > threshold;
  } else if (stored.condition_type === "value_below" && stored.condition_value) {
    const threshold = Number(stored.condition_value);
    condition = (ctx) => Number(ctx.state.value) < threshold;
  } else if (stored.condition_type === "equals" && stored.condition_value) {
    condition = (ctx) => String(ctx.state.value) === stored.condition_value;
  }

  if (stored.rule_type === "script" && stored.compiled_js) {
    // Script rule — action runs compiled JS through the Sandbox
    const compiledJs = stored.compiled_js;
    const action = async (ctx: EventContext) => {
      // Sandbox execution is handled by AutomationEngine in task 8.1
      // For now, store compiled_js on the rule so the engine can detect it
      logger.info({ ruleId: stored.id, name: stored.name }, "Script rule triggered (sandbox dispatch pending engine wiring)");
    };

    // Register with compiled_js attached so AutomationEngine can detect script rules
    const rule: Record<string, unknown> = {
      id: stored.id,
      topic: stored.trigger_topic,
      name: stored.name,
      condition,
      action,
      compiled_js: compiledJs,
    };
    engine.register(rule as unknown as import("../../core/types.js").Rule);
  } else {
    // Form rule — dispatch through ActionExecutor
    const params = JSON.parse(stored.action_params);
    const action = async (ctx: EventContext) => {
      const descriptor: ActionDescriptor = {
        type: stored.action_type as ActionDescriptor["type"],
        target: stored.action_target,
        params,
      };
      await actionExecutor.execute(descriptor, stored.id);
    };

    engine.register({
      id: stored.id,
      topic: stored.trigger_topic,
      name: stored.name,
      condition,
      action,
    });
  }
}

/** Load all enabled UI rules from DB into the engine on startup */
export function loadUiRules(
  engine: AutomationEngine,
  db: Database,
  registry: DeviceRegistry,
  actionExecutor: ActionExecutor,
): void {
  const results = db.exec("SELECT * FROM automation_rules WHERE enabled = 1");
  if (results.length === 0) return;

  const cols = results[0].columns;
  let loaded = 0;
  for (const values of results[0].values) {
    const row: Record<string, unknown> = {};
    cols.forEach((col: string, i: number) => { row[col] = values[i]; });
    registerUiRule(engine, registry, actionExecutor, row as unknown as StoredRule);
    loaded++;
  }
  logger.info({ loaded }, "Loaded UI automation rules from database");
}
