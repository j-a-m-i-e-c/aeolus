// src/api/routes/automation.routes.ts — Automation rules endpoint

import { Router } from "express";
import type { AutomationEngine } from "../../automations/automation-engine.js";

export function createAutomationRoutes(engine: AutomationEngine): Router {
  const router = Router();

  /** GET /api/automations — list all registered rules */
  router.get("/", (_req, res) => {
    const rules = engine.listRules().map((rule) => ({
      id: rule.id,
      topic: rule.topic,
      name: rule.name || null,
      hasCondition: !!rule.condition,
    }));
    res.json(rules);
  });

  return router;
}
