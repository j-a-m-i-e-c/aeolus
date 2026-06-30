// src/api/routes/automation.routes.ts — Automation rules CRUD

import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Database as DatabaseType } from "better-sqlite3";
import type { AutomationEngine } from "../../automations/automation-engine.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { ActionExecutor, ActionDescriptor } from "../../automations/action-executor.js";
import type { ExecutionLog } from "../../automations/execution-log.js";
import type { EventContext, NormalizedEvent, Rule } from "../../core/types.js";
import type { ConditionRegistry } from "../../automations/condition-registry.js";
import { transpile, transpileUi } from "../../automations/transpiler.js";
import { extractStructuredMetadata } from "../../automations/structured-metadata-extractor.js";
import { buildSnippetCatalog } from "../../automations/snippet-catalog.js";
import { isValidCron } from "../../automations/cron-utils.js";
import type { ConnectorRegistry } from "../../connectors/connector-registry.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createAutomationBodySchema, updateAutomationBodySchema, automationIdParamsSchema, toggleAutomationBodySchema, automationStateBodySchema } from "../schemas/automation.schemas.js";
import { requireTabPermission } from "../../auth/auth-middleware.js";
import { eventBus, AUTOMATION_STATE_CHANGE, DEVICE_STATE_CHANGE } from "../../core/event-bus.js";
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
  db: DatabaseType,
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
  router.get("/types", asyncHandler((_req, res) => {
    if (!fs.existsSync(sandboxTypesPath)) {
      res.status(500).json({ error: "Type definitions not available", statusCode: 500 });
      return;
    }
    const content = fs.readFileSync(sandboxTypesPath, "utf-8");
    res.type("text/plain").send(content);
  }));

  /** GET /api/automations/ui-types — serve custom UI component type definitions as text/plain */
  router.get("/ui-types", asyncHandler((_req, res) => {
    // Resolve ui-types.d.ts relative to sandbox-types.d.ts (same directory)
    const uiTypesPath = sandboxTypesPath.replace("sandbox-types.d.ts", "ui-types.d.ts");
    if (!fs.existsSync(uiTypesPath)) {
      res.status(500).json({ error: "UI type definitions not available", statusCode: 500 });
      return;
    }
    const content = fs.readFileSync(uiTypesPath, "utf-8");
    res.type("text/plain").send(content);
  }));

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

  /** POST /api/automations/trigger/:name — fire a named trigger event (replaces services trigger) */
  router.post("/trigger/:name", requireTabPermission("interact"), (req, res) => {
    const { name } = req.params;
    const body = req.body ?? {};
    const firedAt = Date.now();

    const event: NormalizedEvent = {
      deviceId: "service-trigger",
      deviceType: "sensor",
      state: {
        triggerName: name,
        payload: body,
        firedAt,
      },
      topic: `service/trigger/${name}`,
      timestamp: firedAt,
      integration: "service",
    };

    eventBus.emit(DEVICE_STATE_CHANGE, event);

    logger.info({ triggerName: name }, "API trigger fired");
    res.json({ success: true, trigger: name });
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
    const dbIdRows = db.prepare("SELECT id FROM automation_rules").all() as Array<{ id: string }>;
    for (const row of dbIdRows) {
      dbIds.add(row.id);
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
    const rows = db.prepare("SELECT * FROM automation_rules ORDER BY created_at DESC").all() as StoredRule[];
    const dbRules: Record<string, unknown>[] = [];
    for (const row of rows) {
      const ruleType = row.rule_type || "form";
      const triggerType = row.trigger_type || "mqtt";
      const cronExpression = row.cron_expression;
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
        entry.actionParams = JSON.parse(row.action_params);
        entry.conditionType = row.condition_type;
        entry.conditionValue = row.condition_value;
      } else if (ruleType === "script") {
        entry.scriptSource = row.script_source;
        entry.conditionType = row.condition_type;
        entry.conditionValue = row.condition_value;
        const rawMeta = row.structured_metadata;
        entry.structured = rawMeta ? JSON.parse(rawMeta) : null;
      }
      if (row.ui_source != null) {
        entry.uiSource = row.ui_source;
      }
      dbRules.push(entry);
    }

    res.json([...fileRules, ...dbRules]);
  });

  /** POST /api/automations — create a new UI rule (form or script) */
  router.post("/", requireTabPermission("write"), validate({ body: createAutomationBodySchema }), asyncHandler((req, res) => {
    const { name, triggerTopic, ruleType, conditionType, conditionValue, actionType, actionTarget, actionParams, scriptSource, uiSource, triggerType: rawTriggerType, cronExpression } = req.body;

    if (!name) {
      throw new BadRequestError("name is required");
    }

    const { triggerType, effectiveTriggerTopic, effectiveCronExpression } =
      resolveTriggerConfig({ rawTriggerType, triggerTopic, cronExpression });

    const { uiSourceValue, compiledUiValue } = resolveUiSource(uiSource);

    const id = randomUUID();
    const now = Date.now();

    if (ruleType === "script") {
      // Script rule — transpile and store
      if (!scriptSource) {
        throw new BadRequestError("scriptSource is required for script rules");
      }
      const { compiledJs, structuredJson } = compileScriptSource(scriptSource, effectiveTriggerTopic);

      db.prepare(
        `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, script_source, compiled_js, structured_metadata, ui_source, compiled_ui, trigger_type, cron_expression, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 'script', '', '{}', 'script', ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(id, name, effectiveTriggerTopic, conditionType || null, conditionValue || null, scriptSource, compiledJs, structuredJson, uiSourceValue, compiledUiValue, triggerType, effectiveCronExpression, now);

      registerUiRule(engine, registry, actionExecutor, {
        id, name, trigger_topic: effectiveTriggerTopic,
        condition_type: conditionType || null, condition_value: conditionValue || null,
        action_type: "script", action_target: "", action_params: "{}",
        rule_type: "script", script_source: scriptSource, compiled_js: compiledJs,
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

      db.prepare(
        `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, ui_source, compiled_ui, trigger_type, cron_expression, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'form', ?, ?, ?, ?, 1, ?)`
      ).run(id, name, effectiveTriggerTopic, conditionType || null, conditionValue || null, actionType, actionTarget, JSON.stringify(actionParams || {}), uiSourceValue, compiledUiValue, triggerType, effectiveCronExpression, now);

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
  }));

  /** PUT /api/automations/:id — update an existing UI rule */
  router.put("/:id", requireTabPermission("write"), validate({ body: updateAutomationBodySchema, params: automationIdParamsSchema }), asyncHandler((req, res) => {
    const id = req.params.id as string;

    // Check rule exists
    const existing = queryRuleById(db, id);
    if (!existing) {
      throw new NotFoundError(`Automation rule ${id} not found`);
    }

    const { name, triggerTopic, conditionType, conditionValue, actionType, actionTarget, actionParams, scriptSource, uiSource, triggerType: rawTriggerType, cronExpression } = req.body;

    const { triggerType, effectiveTriggerTopic, effectiveCronExpression } =
      resolveTriggerConfig({ rawTriggerType, triggerTopic, cronExpression }, existing);

    const { uiSourceValue, compiledUiValue } = resolveUiSource(uiSource, existing);

    if (existing.rule_type === "script") {
      // Script rule update — re-transpile
      const updatedSource = scriptSource ?? existing.script_source;
      if (!updatedSource) {
        throw new BadRequestError("scriptSource is required for script rules");
      }
      const { compiledJs, structuredJson } = compileScriptSource(updatedSource, effectiveTriggerTopic);

      db.prepare(
        `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, script_source = ?, compiled_js = ?, structured_metadata = ?, ui_source = ?, compiled_ui = ?, trigger_type = ?, cron_expression = ? WHERE id = ?`
      ).run(name || existing.name, effectiveTriggerTopic, conditionType ?? existing.condition_type, conditionValue ?? existing.condition_value, updatedSource, compiledJs, structuredJson, uiSourceValue, compiledUiValue, triggerType, effectiveCronExpression, id);

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
      db.prepare(
        `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, action_type = ?, action_target = ?, action_params = ?, ui_source = ?, compiled_ui = ?, trigger_type = ?, cron_expression = ? WHERE id = ?`
      ).run(
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
      );

      // Re-register in engine
      engine.unregister(id);
      const updated = queryRuleById(db, id)!;
      if (updated.enabled) {
        registerUiRule(engine, registry, actionExecutor, updated, conditionRegistry);
      }

      logger.info({ ruleId: id, name: updated.name }, "Form automation rule updated");
      res.json({ success: true, id });
    }
  }));

  /** DELETE /api/automations/:id — delete a UI rule */
  router.delete("/:id", requireTabPermission("write"), asyncHandler((req, res) => {
    const id = req.params.id as string;
    const existing = queryRuleById(db, id);
    if (!existing) {
      throw new NotFoundError(`Automation rule ${id} not found`);
    }
    if (stateStore) {
      stateStore.deleteAll(id);
    }
    db.prepare("DELETE FROM automation_rules WHERE id = ?").run(id);
    engine.unregister(id);
    logger.info({ ruleId: id, ruleType: existing.rule_type }, "Automation rule deleted");
    res.json({ success: true });
  }));

  /** PATCH /api/automations/:id/toggle — enable/disable a UI rule */
  router.patch("/:id/toggle", requireTabPermission("write"), validate({ body: toggleAutomationBodySchema, params: automationIdParamsSchema }), asyncHandler((req, res) => {
    const id = req.params.id as string;
    const { enabled } = req.body;

    const existing = queryRuleById(db, id);
    if (!existing) {
      throw new NotFoundError(`Automation rule ${id} not found`);
    }

    db.prepare("UPDATE automation_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);

    if (enabled) {
      // Re-register — reload from DB to get latest state
      const updated = queryRuleById(db, id)!;
      registerUiRule(engine, registry, actionExecutor, updated, conditionRegistry);
    } else {
      engine.unregister(id);
    }

    res.json({ success: true, enabled: !!enabled });
  }));

  /** POST /api/automations/:id/fire — manually fire a specific automation rule */
  router.post("/:id/fire", requireTabPermission("interact"), asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const rule = engine.getRule(id);
    if (!rule) {
      throw new NotFoundError(`Automation rule ${id} not found or not enabled`);
    }

    // Build context — supports three modes:
    // 1. body.context = { topic, state } — full context override (used by saveAndFire)
    // 2. body.eventName — UI emit helper (topic = ui/{ruleId}/{eventName})
    // 3. Default — synthetic manual-fire context
    const body = req.body ?? {};

    let context: EventContext;

    if (body.context && typeof body.context === "object" && typeof body.context.topic === "string") {
      // Mode 1: Full context override
      context = {
        topic: body.context.topic,
        deviceId: `ui-${id}`,
        state: body.context.state ?? {},
        timestamp: Date.now(),
      };
    } else {
      // Mode 2/3: eventName-based or default
      const eventName = typeof body.eventName === "string" ? body.eventName : undefined;
      const { eventName: _discarded, ...statePayload } = body;

      context = {
        topic: eventName ? `ui/${id}/${eventName}` : rule.topic,
        deviceId: eventName ? `ui-${id}` : "manual-fire",
        state: statePayload,
        timestamp: Date.now(),
      };
    }

    // Fire through the engine (routes script rules through sandbox)
    await engine.fire(id, context);

    logger.info({ ruleId: id, ruleName: rule.name }, "Automation rule manually fired");
    res.json({ success: true, ruleId: id });
  }));

  /** GET /api/automations/:id/state — return all state key-value pairs for a rule */
  router.get("/:id/state", (req, res) => {
    const id = req.params.id as string;
    const state = stateStore ? stateStore.getAll(id) : {};
    res.json(state);
  });

  /** PUT /api/automations/:id/state — upsert a key-value pair, persist + broadcast */
  router.put("/:id/state", requireTabPermission("interact"), validate({ body: automationStateBodySchema, params: automationIdParamsSchema }), asyncHandler((req, res) => {
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
  }));

  /** DELETE /api/automations/:id/state/:key — remove a single key-value pair */
  router.delete("/:id/state/:key", requireTabPermission("interact"), asyncHandler((req, res) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    if (stateStore) {
      stateStore.delete(id, key);
    }
    res.json({ success: true });
  }));

  return router;
}

/** Query a single rule from the DB by ID */
function queryRuleById(db: DatabaseType, id: string): StoredRule | null {
  const row = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(id) as StoredRule | undefined;
  return row ?? null;
}

/** Build a BadRequestError that carries transpiler diagnostics in `details`. */
function compilationError(message: string, details: unknown): BadRequestError {
  const err = new BadRequestError(message);
  err.details = details;
  return err;
}

interface ResolvedTrigger {
  triggerType: string;
  effectiveTriggerTopic: string;
  effectiveCronExpression: string | null;
}

/**
 * Resolve and validate trigger configuration shared by create (POST) and
 * update (PUT). On update, pass `existing` so omitted fields fall back to the
 * stored rule's values. Throws BadRequestError on an invalid trigger type or
 * cron expression.
 */
function resolveTriggerConfig(
  input: { rawTriggerType?: unknown; triggerTopic?: unknown; cronExpression?: unknown },
  existing?: StoredRule,
): ResolvedTrigger {
  const triggerType = (input.rawTriggerType as string) || existing?.trigger_type || "mqtt";
  if (!["mqtt", "cron", "none"].includes(triggerType)) {
    throw new BadRequestError("triggerType must be 'mqtt', 'cron', or 'none'");
  }

  const rawCron = input.cronExpression;

  if (triggerType === "cron") {
    const effectiveExpr = rawCron !== undefined ? rawCron : existing?.cron_expression;
    if (!effectiveExpr || typeof effectiveExpr !== "string" || !effectiveExpr.trim()) {
      throw new BadRequestError("cronExpression is required when triggerType is 'cron'");
    }
    if (!isValidCron(effectiveExpr)) {
      throw new BadRequestError("Invalid cron expression");
    }
  }

  if (triggerType === "cron") {
    return {
      triggerType,
      effectiveTriggerTopic: "",
      effectiveCronExpression: rawCron !== undefined
        ? (rawCron as string).trim()
        : (existing?.cron_expression || ""),
    };
  }

  if (triggerType === "none") {
    return { triggerType, effectiveTriggerTopic: "", effectiveCronExpression: null };
  }

  // mqtt — use provided triggerTopic, else keep existing (update) or default to "" (create)
  const rawTopic = input.triggerTopic;
  const effectiveTriggerTopic = existing
    ? (rawTopic !== undefined ? (rawTopic as string) : existing.trigger_topic)
    : ((rawTopic && typeof rawTopic === "string") ? rawTopic.trim() : "");

  return { triggerType, effectiveTriggerTopic, effectiveCronExpression: null };
}

interface ResolvedUi {
  uiSourceValue: string | null;
  compiledUiValue: string | null;
}

/**
 * Resolve `ui_source` / `compiled_ui` shared by create and update. On update,
 * pass `existing` so an omitted (or whitespace-only) uiSource keeps the stored
 * values, while an explicit "" or null clears them. Throws BadRequestError on
 * TSX compile failure.
 */
function resolveUiSource(uiSource: unknown, existing?: StoredRule): ResolvedUi {
  if (uiSource === "" || uiSource === null) {
    return { uiSourceValue: null, compiledUiValue: null };
  }

  if (typeof uiSource === "string" && uiSource.trim()) {
    const uiResult = transpileUi(uiSource);
    if (!uiResult.success) {
      throw compilationError("TSX compilation failed", uiResult.errors);
    }
    return { uiSourceValue: uiSource, compiledUiValue: uiResult.js };
  }

  // uiSource omitted or whitespace-only — keep existing (create resolves to null)
  return {
    uiSourceValue: existing?.ui_source ?? null,
    compiledUiValue: existing?.compiled_ui ?? null,
  };
}

interface ResolvedScript {
  compiledJs: string;
  structuredJson: string | null;
}

/**
 * Transpile a script rule's source and extract its structured metadata.
 * Throws BadRequestError on TypeScript compile failure.
 */
function compileScriptSource(source: string, triggerTopic: string): ResolvedScript {
  const result = transpile(source);
  if (!result.success) {
    throw compilationError("TypeScript compilation failed", result.errors);
  }
  const structured = extractStructuredMetadata(result.js, triggerTopic);
  return {
    compiledJs: result.js,
    structuredJson: structured ? JSON.stringify(structured) : null,
  };
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
    const action = async (_context: EventContext) => {
      // Sandbox execution is handled by AutomationEngine in task 8.1
      logger.info({ ruleId: stored.id, name: stored.name }, "Script rule triggered (sandbox dispatch pending engine wiring)");
    };

    // Register with compiled_js attached so AutomationEngine can detect script rules
    const rule: Rule = {
      id: stored.id,
      topic: effectiveTopic,
      name: stored.name,
      condition,
      action,
      compiled_js: compiledJs,
      triggerType,
      cronExpression,
    };
    engine.register(rule);
  } else {
    // Form rule — dispatch through ActionExecutor
    const params = JSON.parse(stored.action_params);
    const action = async (_context: EventContext) => {
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
  db: DatabaseType,
  registry: DeviceRegistry,
  actionExecutor: ActionExecutor,
  conditionRegistry?: ConditionRegistry,
): void {
  const rows = db.prepare("SELECT * FROM automation_rules WHERE enabled = 1").all() as StoredRule[];
  if (rows.length === 0) return;

  let loaded = 0;
  for (const row of rows) {
    registerUiRule(engine, registry, actionExecutor, row, conditionRegistry);
    loaded++;
  }
  logger.info({ loaded }, "Loaded UI automation rules from database");
}
