// src/api/routes/automation.routes.ts — Automation rules CRUD

import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Database } from "sql.js";
import type { AutomationEngine } from "../../automations/automation-engine.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { EventContext } from "../../core/types.js";
import { BadRequestError } from "../middleware/error-handler.js";
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
  enabled: number;
  created_at: number;
}

export function createAutomationRoutes(
  engine: AutomationEngine,
  db: Database,
  registry: DeviceRegistry
): Router {
  const router = Router();

  /** GET /api/automations — list all rules (file + UI) */
  router.get("/", (_req, res) => {
    // File-based rules
    const fileRules = engine.listRules().map((rule) => ({
      id: rule.id,
      topic: rule.topic,
      name: rule.name || null,
      hasCondition: !!rule.condition,
      source: "file",
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
        dbRules.push({
          id: row.id,
          name: row.name,
          topic: row.trigger_topic,
          hasCondition: !!row.condition_type,
          source: "ui",
          enabled: row.enabled === 1,
          actionType: row.action_type,
          actionTarget: row.action_target,
          actionParams: JSON.parse(row.action_params as string),
          conditionType: row.condition_type,
          conditionValue: row.condition_value,
        });
      }
    }

    res.json([...fileRules, ...dbRules]);
  });

  /** POST /api/automations — create a new UI rule */
  router.post("/", (req, res, next) => {
    try {
      const { name, triggerTopic, conditionType, conditionValue, actionType, actionTarget, actionParams } = req.body;

      if (!name || !triggerTopic || !actionType || !actionTarget) {
        throw new BadRequestError("name, triggerTopic, actionType, and actionTarget are required");
      }

      const id = randomUUID();
      const now = Date.now();

      // Store in DB
      db.run(
        `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [id, name, triggerTopic, conditionType || null, conditionValue || null, actionType, actionTarget, JSON.stringify(actionParams || {}), now]
      );
      persistDatabase();

      // Register in the live engine
      registerUiRule(engine, registry, {
        id, name, trigger_topic: triggerTopic,
        condition_type: conditionType || null, condition_value: conditionValue || null,
        action_type: actionType, action_target: actionTarget,
        action_params: JSON.stringify(actionParams || {}),
        enabled: 1, created_at: now,
      });

      logger.info({ ruleId: id, name, triggerTopic }, "UI automation rule created");
      res.json({ success: true, id });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/automations/:id — delete a UI rule */
  router.delete("/:id", (req, res, next) => {
    try {
      const id = req.params.id as string;
      db.run("DELETE FROM automation_rules WHERE id = ?", [id]);
      persistDatabase();
      engine.unregister(id);
      logger.info({ ruleId: id }, "UI automation rule deleted");
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
      db.run("UPDATE automation_rules SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id]);
      persistDatabase();

      if (enabled) {
        // Re-register
        const results = db.exec(`SELECT * FROM automation_rules WHERE id = '${id}'`);
        if (results.length > 0 && results[0].values.length > 0) {
          const cols = results[0].columns;
          const row: Record<string, unknown> = {};
          cols.forEach((col: string, i: number) => { row[col] = results[0].values[0][i]; });
          registerUiRule(engine, registry, row as unknown as StoredRule);
        }
      } else {
        engine.unregister(id);
      }

      res.json({ success: true, enabled });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Convert a stored UI rule into a live automation rule */
function registerUiRule(engine: AutomationEngine, registry: DeviceRegistry, stored: StoredRule): void {
  const params = JSON.parse(stored.action_params);

  const action = (ctx: EventContext) => {
    switch (stored.action_type) {
      case "publish":
        // Publish MQTT message — handled by the MQTT service
        logger.info({ rule: stored.name, target: stored.action_target, params }, "UI rule action: publish");
        break;
      case "toggle":
        logger.info({ rule: stored.name, target: stored.action_target }, "UI rule action: toggle device");
        break;
      case "log":
        logger.info({ rule: stored.name, message: params.message || "Rule fired", ctx }, "UI rule action: log");
        break;
      default:
        logger.warn({ rule: stored.name, actionType: stored.action_type }, "Unknown UI rule action type");
    }
  };

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

  engine.register({
    id: stored.id,
    topic: stored.trigger_topic,
    name: stored.name,
    condition,
    action,
  });
}

/** Load all enabled UI rules from DB into the engine on startup */
export function loadUiRules(engine: AutomationEngine, db: Database, registry: DeviceRegistry): void {
  const results = db.exec("SELECT * FROM automation_rules WHERE enabled = 1");
  if (results.length === 0) return;

  const cols = results[0].columns;
  let loaded = 0;
  for (const values of results[0].values) {
    const row: Record<string, unknown> = {};
    cols.forEach((col: string, i: number) => { row[col] = values[i]; });
    registerUiRule(engine, registry, row as unknown as StoredRule);
    loaded++;
  }
  logger.info({ loaded }, "Loaded UI automation rules from database");
}