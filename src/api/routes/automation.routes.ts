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
import type { ConditionRegistry } from "../../automations/condition-registry.js";
import { transpile, transpileUi } from "../../automations/transpiler.js";
import { extractStructuredMetadata } from "../../automations/structured-metadata-extractor.js";
import { buildSnippetCatalog } from "../../automations/snippet-catalog.js";
import { isValidCron } from "../../automations/cron-utils.js";
import type { ConnectorRegistry } from "../../connectors/connector-registry.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import { validate } from "../middleware/validate.js";
import { createAutomationBodySchema, updateAutomationBodySchema, automationIdParamsSchema, toggleAutomationBodySchema, automationStateBodySchema } from "../schemas/automation.schemas.js";
import { persistDatabase } from "../../db/database.js";
import { eventBus, AUTOMATION_STATE_CHANGE } from "../../core/event-bus.js";
import type { AutomationStateStore } from "../../automations/automation-state-store.js";
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
  compiled_ui: string | null;
  trigger_type: string | null;
  cron_expression: string | null;
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
  connectorRegistry?: ConnectorRegistry,
  stateStore?: AutomationStateStore,
  conditionRegistry?: ConditionRegistry,
): Router {
  const router = Router();

  /** GET /api/automations/snippets — return the snippet catalog */
  router.get("/snippets", (req, res) => {
    const mode = req.query.mode === "ui" ? "ui" : "logic";
    const catalog = connectorRegistry
      ? buildSnippetCatalog(connectorRegistry, mode)
      : [];
    res.json(catalog);
  });

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

  /** GET /api/automations/ui-types — serve custom UI component type definitions as text/plain */
  router.get("/ui-types", (_req, res, next) => {
    try {
      // Resolve ui-types.d.ts relative to sandbox-types.d.ts (same directory)
      const uiTypesPath = sandboxTypesPath.replace("sandbox-types.d.ts", "ui-types.d.ts");
      if (!fs.existsSync(uiTypesPath)) {
        res.status(500).json({ error: "UI type definitions not available", statusCode: 500 });
        return;
      }
      const content = fs.readFileSync(uiTypesPath, "utf-8");
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

  /** GET /api/automations/:id/ui-module — serve compiled UI module as JavaScript */
  router.get("/:id/ui-module", (req, res) => {
    const id = req.params.id as string;
    const rule = queryRuleById(db, id);
    if (!rule) {
      res.status(404).json({ error: "Automation rule not found" });
      return;
    }
    if (!rule.compiled_ui) {
      res.status(404).json({ error: "No compiled UI module" });
      return;
    }
    res.set("Content-Type", "application/javascript");
    res.set("Cache-Control", "no-cache");
    res.send(rule.compiled_ui);
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
        const triggerType = (row.trigger_type as string) || "mqtt";
        const cronExpression = row.cron_expression as string | null;
        const entry: Record<string, unknown> = {
          id: row.id,
          name: row.name,
          topic: row.trigger_topic,
          hasCondition: !!row.condition_type,
          source: "ui",
          ruleType,
          enabled: row.enabled === 1,
          triggerType,
          cronExpression: cronExpression || null,
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
        if (row.ui_source != null) {
          entry.uiSource = row.ui_source;
        }
        dbRules.push(entry);
      }
    }

    res.json([...fileRules, ...dbRules]);
  });

  /** POST /api/automations — create a new UI rule (form or script) */
  router.post("/", validate({ body: createAutomationBodySchema }), (req, res, next) => {
    try {
      const { name, triggerTopic, ruleType, conditionType, conditionValue, actionType, actionTarget, actionParams, scriptSource, uiSource, triggerType: rawTriggerType, cronExpression } = req.body;

      if (!name) {
        throw new BadRequestError("name is required");
      }

      // Determine trigger type (default to "mqtt" for backward compat)
      const triggerType = rawTriggerType || "mqtt";
      if (!["mqtt", "cron", "none"].includes(triggerType)) {
        throw new BadRequestError("triggerType must be 'mqtt', 'cron', or 'none'");
      }

      // Validate cron expression if trigger type is "cron"
      if (triggerType === "cron") {
        if (!cronExpression || typeof cronExpression !== "string" || !cronExpression.trim()) {
          throw new BadRequestError("cronExpression is required when triggerType is 'cron'");
        }
        if (!isValidCron(cronExpression)) {
          throw new BadRequestError("Invalid cron expression");
        }
      }

      // Determine effective trigger topic and cron expression for storage
      let effectiveTriggerTopic: string;
      let effectiveCronExpression: string | null;

      if (triggerType === "cron" || triggerType === "none") {
        effectiveTriggerTopic = "";
        effectiveCronExpression = triggerType === "cron" ? cronExpression.trim() : null;
      } else {
        // mqtt — use provided triggerTopic
        effectiveTriggerTopic = (triggerTopic && typeof triggerTopic === "string") ? triggerTopic.trim() : "";
        effectiveCronExpression = null;
      }

      const id = randomUUID();
      const now = Date.now();

      // Transpile uiSource if provided
      const uiSourceValue = (typeof uiSource === "string" && uiSource.trim()) ? uiSource : null;
      let compiledUiValue: string | null = null;
      if (uiSourceValue) {
        const uiResult = transpileUi(uiSourceValue);
        if (!uiResult.success) {
          res.status(400).json({
            error: "TSX compilation failed",
            statusCode: 400,
            details: uiResult.errors,
          });
          return;
        }
        compiledUiValue = uiResult.js;
      }

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

        const structured = extractStructuredMetadata(result.js, effectiveTriggerTopic);
        const structuredJson = structured ? JSON.stringify(structured) : null;

        db.run(
          `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, script_source, compiled_js, structured_metadata, ui_source, compiled_ui, trigger_type, cron_expression, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, 'script', '', '{}', 'script', ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [id, name, effectiveTriggerTopic, conditionType || null, conditionValue || null, scriptSource, result.js, structuredJson, uiSourceValue, compiledUiValue, triggerType, effectiveCronExpression, now]
        );
        persistDatabase();

        registerUiRule(engine, registry, actionExecutor, {
          id, name, trigger_topic: effectiveTriggerTopic,
          condition_type: conditionType || null, condition_value: conditionValue || null,
          action_type: "script", action_target: "", action_params: "{}",
          rule_type: "script", script_source: scriptSource, compiled_js: result.js,
          structured_metadata: structuredJson, ui_source: uiSourceValue, compiled_ui: compiledUiValue,
          trigger_type: triggerType, cron_expression: effectiveCronExpression,
          enabled: 1, created_at: now,
        }, conditionRegistry);

        logger.info({ ruleId: id, name, triggerTopic: effectiveTriggerTopic, ruleType: "script" }, "Script automation rule created");
        res.json({ success: true, id });
      } else {
        // Form rule (default)
        if (!actionType || !actionTarget) {
          throw new BadRequestError("actionType and actionTarget are required for form rules");
        }

        db.run(
          `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, ui_source, compiled_ui, trigger_type, cron_expression, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'form', ?, ?, ?, ?, 1, ?)`,
          [id, name, effectiveTriggerTopic, conditionType || null, conditionValue || null, actionType, actionTarget, JSON.stringify(actionParams || {}), uiSourceValue, compiledUiValue, triggerType, effectiveCronExpression, now]
        );
        persistDatabase();

        registerUiRule(engine, registry, actionExecutor, {
          id, name, trigger_topic: effectiveTriggerTopic,
          condition_type: conditionType || null, condition_value: conditionValue || null,
          action_type: actionType, action_target: actionTarget,
          action_params: JSON.stringify(actionParams || {}),
          rule_type: "form", script_source: null, compiled_js: null,
          structured_metadata: null, ui_source: uiSourceValue, compiled_ui: compiledUiValue,
          trigger_type: triggerType, cron_expression: effectiveCronExpression,
          enabled: 1, created_at: now,
        }, conditionRegistry);

        logger.info({ ruleId: id, name, triggerTopic: effectiveTriggerTopic }, "Form automation rule created");
        res.json({ success: true, id });
      }
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/automations/:id — update an existing UI rule */
  router.put("/:id", validate({ body: updateAutomationBodySchema, params: automationIdParamsSchema }), (req, res, next) => {
    try {
      const id = req.params.id as string;

      // Check rule exists
      const existing = queryRuleById(db, id);
      if (!existing) {
        throw new NotFoundError(`Automation rule ${id} not found`);
      }

      const { name, triggerTopic, conditionType, conditionValue, actionType, actionTarget, actionParams, scriptSource, uiSource, triggerType: rawTriggerType, cronExpression } = req.body;

      // Determine trigger type (keep existing if not provided)
      const triggerType = rawTriggerType || existing.trigger_type || "mqtt";
      if (!["mqtt", "cron", "none"].includes(triggerType)) {
        throw new BadRequestError("triggerType must be 'mqtt', 'cron', or 'none'");
      }

      // Validate cron expression if trigger type is "cron"
      if (triggerType === "cron") {
        const effectiveExpr = cronExpression !== undefined ? cronExpression : existing.cron_expression;
        if (!effectiveExpr || typeof effectiveExpr !== "string" || !effectiveExpr.trim()) {
          throw new BadRequestError("cronExpression is required when triggerType is 'cron'");
        }
        if (!isValidCron(effectiveExpr)) {
          throw new BadRequestError("Invalid cron expression");
        }
      }

      // Determine effective trigger topic and cron expression for storage
      let effectiveTriggerTopic: string;
      let effectiveCronExpression: string | null;

      if (triggerType === "cron" || triggerType === "none") {
        effectiveTriggerTopic = "";
        effectiveCronExpression = triggerType === "cron" ? (cronExpression !== undefined ? cronExpression.trim() : (existing.cron_expression || "")) : null;
      } else {
        // mqtt — use provided triggerTopic or keep existing
        effectiveTriggerTopic = triggerTopic !== undefined ? triggerTopic : existing.trigger_topic;
        effectiveCronExpression = null;
      }

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

        const structured = extractStructuredMetadata(result.js, effectiveTriggerTopic);
        const structuredJson = structured ? JSON.stringify(structured) : null;

        // Determine ui_source value: explicit empty/null means clear, non-empty means update, undefined means keep existing
        let uiSourceValue: string | null;
        if (uiSource === "" || uiSource === null) {
          uiSourceValue = null;
        } else if (typeof uiSource === "string" && uiSource.trim()) {
          uiSourceValue = uiSource;
        } else {
          uiSourceValue = existing.ui_source;
        }

        // Transpile uiSource if updated, clear compiled_ui if uiSource cleared
        let compiledUiValue: string | null;
        if (uiSource === "" || uiSource === null) {
          compiledUiValue = null;
        } else if (typeof uiSource === "string" && uiSource.trim()) {
          const uiResult = transpileUi(uiSourceValue!);
          if (!uiResult.success) {
            res.status(400).json({
              error: "TSX compilation failed",
              statusCode: 400,
              details: uiResult.errors,
            });
            return;
          }
          compiledUiValue = uiResult.js;
        } else {
          compiledUiValue = existing.compiled_ui;
        }

        db.run(
          `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, script_source = ?, compiled_js = ?, structured_metadata = ?, ui_source = ?, compiled_ui = ?, trigger_type = ?, cron_expression = ? WHERE id = ?`,
          [name || existing.name, effectiveTriggerTopic, conditionType ?? existing.condition_type, conditionValue ?? existing.condition_value, updatedSource, result.js, structuredJson, uiSourceValue, compiledUiValue, triggerType, effectiveCronExpression, id]
        );
        persistDatabase();

        // Re-register in engine
        engine.unregister(id);
        const updated = queryRuleById(db, id)!;
        if (updated.enabled) {
          registerUiRule(engine, registry, actionExecutor, updated, conditionRegistry);
        }

        logger.info({ ruleId: id, name: updated.name }, "Script automation rule updated");
        res.json({ success: true, id });
      } else {
        // Form rule update
        // Determine ui_source value: explicit empty/null means clear, non-empty means update, undefined means keep existing
        let uiSourceValue: string | null;
        if (uiSource === "" || uiSource === null) {
          uiSourceValue = null;
        } else if (typeof uiSource === "string" && uiSource.trim()) {
          uiSourceValue = uiSource;
        } else {
          uiSourceValue = existing.ui_source;
        }

        // Transpile uiSource if updated, clear compiled_ui if uiSource cleared
        let compiledUiValue: string | null;
        if (uiSource === "" || uiSource === null) {
          compiledUiValue = null;
        } else if (typeof uiSource === "string" && uiSource.trim()) {
          const uiResult = transpileUi(uiSourceValue!);
          if (!uiResult.success) {
            res.status(400).json({
              error: "TSX compilation failed",
              statusCode: 400,
              details: uiResult.errors,
            });
            return;
          }
          compiledUiValue = uiResult.js;
        } else {
          compiledUiValue = existing.compiled_ui;
        }

        db.run(
          `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, action_type = ?, action_target = ?, action_params = ?, ui_source = ?, compiled_ui = ?, trigger_type = ?, cron_expression = ? WHERE id = ?`,
          [
            name || existing.name,
            effectiveTriggerTopic,
            conditionType ?? existing.condition_type,
            conditionValue ?? existing.condition_value,
            actionType || existing.action_type,
            actionTarget || existing.action_target,
            JSON.stringify(actionParams || JSON.parse(existing.action_params)),
            uiSourceValue,
            compiledUiValue,
            triggerType,
            effectiveCronExpression,
            id,
          ]
        );
        persistDatabase();

        // Re-register in engine
        engine.unregister(id);
        const updated = queryRuleById(db, id)!;
        if (updated.enabled) {
          registerUiRule(engine, registry, actionExecutor, updated, conditionRegistry);
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
      if (stateStore) {
        stateStore.deleteAll(id);
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
  router.patch("/:id/toggle", validate({ body: toggleAutomationBodySchema, params: automationIdParamsSchema }), (req, res, next) => {
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
        registerUiRule(engine, registry, actionExecutor, updated, conditionRegistry);
      } else {
        engine.unregister(id);
      }

      res.json({ success: true, enabled: !!enabled });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/automations/:id/fire — manually fire a specific automation rule */
  router.post("/:id/fire", async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const rule = engine.getRule(id);
      if (!rule) {
        throw new NotFoundError(`Automation rule ${id} not found or not enabled`);
      }

      // Build a synthetic context for manual firing
      const context = {
        topic: rule.topic,
        deviceId: "manual-fire",
        state: req.body ?? {},
        timestamp: Date.now(),
      };

      // Check if it's a script rule (has compiled_js)
      const compiledJs = (rule as unknown as Record<string, unknown>).compiled_js as string | undefined;

      if (compiledJs) {
        // Script rule — need to get the sandbox from the engine
        // For now, just call the rule's action directly which logs
        // The automation engine will handle sandbox dispatch
        await rule.action(context);
      } else {
        await rule.action(context);
      }

      logger.info({ ruleId: id, ruleName: rule.name }, "Automation rule manually fired");
      res.json({ success: true, ruleId: id });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/automations/:id/state — return all state key-value pairs for a rule */
  router.get("/:id/state", (req, res) => {
    const id = req.params.id as string;
    const state = stateStore ? stateStore.getAll(id) : {};
    res.json(state);
  });

  /** PUT /api/automations/:id/state — upsert a key-value pair, persist + broadcast */
  router.put("/:id/state", validate({ body: automationStateBodySchema, params: automationIdParamsSchema }), (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { key, value } = req.body;
      if (!key || typeof key !== "string") {
        throw new BadRequestError("key is required and must be a string");
      }
      if (!stateStore) {
        throw new BadRequestError("State store not available");
      }
      stateStore.set(id, key, value);
      eventBus.emit(AUTOMATION_STATE_CHANGE, { ruleId: id, key, value });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/automations/:id/state/:key — remove a single key-value pair */
  router.delete("/:id/state/:key", (req, res, next) => {
    try {
      const id = req.params.id as string;
      const key = req.params.key as string;
      if (stateStore) {
        stateStore.delete(id, key);
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Query a single rule from the DB by ID */
function queryRuleById(db: Database, id: string): StoredRule | null {
  const results = db.exec("SELECT * FROM automation_rules WHERE id = ?", [id]);
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
  conditionRegistry?: ConditionRegistry,
): void {
  // If trigger_topic is empty, the rule is manual-only — still register it
  // so it's accessible via getRule() for the /fire endpoint, but it will
  // never match any incoming event topic (empty string won't match).
  const effectiveTopic = stored.trigger_topic || "";

  // Determine trigger type and cron expression
  const triggerType = (stored.trigger_type as "mqtt" | "cron" | "none") || "mqtt";
  const cronExpression = stored.cron_expression || undefined;

  // Build condition via the registry (falls back to undefined if type/value are null or unregistered)
  const condition = conditionRegistry
    ? conditionRegistry.buildCondition(stored.condition_type, stored.condition_value)
    : undefined;

  if (stored.rule_type === "script" && stored.compiled_js) {
    // Script rule — action runs compiled JS through the Sandbox
    const compiledJs = stored.compiled_js;
    const action = async (context: EventContext) => {
      // Sandbox execution is handled by AutomationEngine in task 8.1
      // For now, store compiled_js on the rule so the engine can detect it
      logger.info({ ruleId: stored.id, name: stored.name }, "Script rule triggered (sandbox dispatch pending engine wiring)");
    };

    // Register with compiled_js attached so AutomationEngine can detect script rules
    const rule: Record<string, unknown> = {
      id: stored.id,
      topic: effectiveTopic,
      name: stored.name,
      condition,
      action,
      compiled_js: compiledJs,
      triggerType,
      cronExpression,
    };
    engine.register(rule as unknown as import("../../core/types.js").Rule);
  } else {
    // Form rule — dispatch through ActionExecutor
    const params = JSON.parse(stored.action_params);
    const action = async (context: EventContext) => {
      const descriptor: ActionDescriptor = {
        type: stored.action_type,
        target: stored.action_target,
        params,
      };
      await actionExecutor.execute(descriptor, stored.id);
    };

    engine.register({
      id: stored.id,
      topic: effectiveTopic,
      name: stored.name,
      condition,
      action,
      triggerType,
      cronExpression,
    });
  }
}

/** Load all enabled UI rules from DB into the engine on startup */
export function loadUiRules(
  engine: AutomationEngine,
  db: Database,
  registry: DeviceRegistry,
  actionExecutor: ActionExecutor,
  conditionRegistry?: ConditionRegistry,
): void {
  const results = db.exec("SELECT * FROM automation_rules WHERE enabled = 1");
  if (results.length === 0) return;

  const cols = results[0].columns;
  let loaded = 0;
  for (const values of results[0].values) {
    const row: Record<string, unknown> = {};
    cols.forEach((col: string, i: number) => { row[col] = values[i]; });
    registerUiRule(engine, registry, actionExecutor, row as unknown as StoredRule, conditionRegistry);
    loaded++;
  }
  logger.info({ loaded }, "Loaded UI automation rules from database");
}
