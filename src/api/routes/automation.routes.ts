// src/api/routes/automation.routes.ts — Automation rules CRUD

import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { demoWriteRateLimiter, demoFireRateLimiter } from "../middleware/rate-limiter.js";
import type { Database as DatabaseType } from "better-sqlite3";
import type { AutomationEngine } from "../../automations/automation-engine.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { CommandService, ActionDescriptor } from "../../automations/command-service.js";
import type { ExecutionLog } from "../../automations/execution-log.js";
import type { EventContext, NormalizedEvent, Rule } from "../../core/types.js";
import type { ConditionRegistry } from "../../automations/condition-registry.js";
import { transpileUi } from "../../automations/transpiler.js";
import { compileAutomationProject, readAutomationProject, saveAutomationProject, AutomationProjectCompileError, type AutomationProject } from "../../automations/automation-project.js";
import { buildSnippetCatalog } from "../../automations/snippet-catalog.js";
import { isValidCron } from "../../automations/cron-utils.js";
import type { ConnectorRegistry } from "../../connectors/connector-registry.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "../middleware/error-handler.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createAutomationBodySchema, updateAutomationBodySchema, automationProjectSchema, automationIdParamsSchema, toggleAutomationBodySchema, automationStateBodySchema, demoAccessBodySchema } from "../schemas/automation.schemas.js";
import { requireTabPermission, requireAdmin } from "../../auth/auth-middleware.js";
import type { RequestHandler } from "express";
import type { PermissionLevel } from "../../auth/permission-service.js";
import type { PermissionResolver } from "../../auth/permission-resolver.js";
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
  authored_unrestricted: number;
  owner_tab_id: string | null;
  enabled: number;
  created_at: number;
}

/**
 * PATCH-style field merge: undefined (omitted) preserves the existing value;
 * null (explicit clear) stores null; any other value replaces.
 * Used for condition_type and condition_value so that an unrelated update never
 * silently erases a previously-authored setting.
 *
 * Requirements: 8.1–8.5 (pre-promotion-release-gates spec)
 */
function preserveOrReplace<T>(incoming: T | null | undefined, current: T | null): T | null {
  return incoming === undefined ? current : incoming;
}

export function createAutomationRoutes(
  engine: AutomationEngine,
  db: DatabaseType,
  registry: DeviceRegistry,
  commandService: CommandService,
  executionLog: ExecutionLog,
  sandboxTypesPath: string,
  requireAutomation: (level: PermissionLevel) => RequestHandler,
  resolver: PermissionResolver,
  connectorRegistry?: ConnectorRegistry,
  stateStore?: AutomationStateStore,
  conditionRegistry?: ConditionRegistry,
): Router {
  const router = Router();

  /** True when the requesting user may read the automation without a resource check. */
  function canReadAutomation(req: import("express").Request, id: string): boolean {
    if (req.user?.role === "admin") {
      return true;
    }
    return resolver.hasResourcePermission(req.user?.userId ?? "", "automation", id, "read");
  }

  /**
   * Guard mutation of an automation by its *authoring authority*, not just its
   * resource exposure. A non-admin holding `write` on a tab that exposes an
   * unrestricted (admin-authored / pre-scoping) automation must NOT be able to
   * modify, delete, or toggle it — otherwise they could replace its Logic and
   * inherit its system-wide authority (raw MQTT, every device, every collection,
   * outbound HTTP). Scoped automations carry `authored_unrestricted = 0` and
   * remain editable by a user with resource `write` on their owning/exposing tab.
   */
  function assertMayMutateAuthority(
    req: import("express").Request,
    existing: { authored_unrestricted?: number },
  ): void {
    if (existing.authored_unrestricted === 1 && req.user?.role !== "admin") {
      throw new ForbiddenError();
    }
  }

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

  /** GET /api/automations/:id/project — authored multi-file source tree. */
  router.get("/:id/project", (req, res) => {
    const id = req.params.id as string;
    const project = readAutomationProject(db, id);
    if (!project) {
      res.status(404).json({ error: "Automation rule not found" });
      return;
    }
    if (!canReadAutomation(req, id)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(project);
  });

  /**
   * PUT /api/automations/:id/project — compile and atomically replace a project.
   * The authored file tree is persisted separately while the existing
   * automation_rules compiled columns remain the runtime projection.
   */
  router.put("/:id/project", requireAutomation("write"), validate({ body: automationProjectSchema, params: automationIdParamsSchema }), asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = queryRuleById(db, id);
    if (!existing) throw new NotFoundError(`Automation rule ${id} not found`);
    assertMayMutateAuthority(req, existing);
    if (existing.rule_type !== "script") throw new BadRequestError("Only script automations can use Automation Projects");

    let compiled: Awaited<ReturnType<typeof compileAutomationProject>>;
    try {
      compiled = await compileAutomationProject(req.body as AutomationProject);
    } catch (error) {
      if (error instanceof AutomationProjectCompileError) {
        throw compilationError("Automation Project compilation failed", error.details);
      }
      throw error;
    }

    db.transaction(() => {
      db.prepare(`UPDATE automation_rules
        SET script_source = ?, compiled_js = ?, structured_metadata = NULL,
            ui_source = ?, compiled_ui = ?
        WHERE id = ?`)
        .run(compiled.logicSource, compiled.compiledJs, compiled.uiSource, compiled.compiledUi, id);
      saveAutomationProject(db, id, compiled);
    })();

    engine.unregister(id);
    const updated = queryRuleById(db, id)!;
    if (updated.enabled) registerUiRule(engine, registry, commandService, updated, conditionRegistry);
    res.json({ success: true, id, project: readAutomationProject(db, id) });
  }));

  /**
   * GET /api/automations/history — return execution log entries, filtered by
   * automation read permission. Admins see everything. A `ruleId` query targets
   * one automation and requires read on it (403 otherwise); the global list is
   * filtered to the automations the user can read, applying the read filter
   * BEFORE any `limit` so a non-admin still receives up to `limit` readable
   * entries.
   */
  router.get("/history", (req, res) => {
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const ruleId = req.query.ruleId as string | undefined;
    const isAdmin = req.user?.role === "admin";

    if (ruleId) {
      if (!canReadAutomation(req, ruleId)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      let entries = executionLog.getByRuleId(ruleId);
      if (limit !== undefined && limit >= 0) {
        entries = entries.slice(0, limit);
      }
      res.json(entries);
      return;
    }

    if (isAdmin) {
      res.json(executionLog.list(limit));
      return;
    }

    // Non-admin global list: filter to readable automations, then apply limit.
    const all = executionLog.list();
    const ruleIds = [...new Set(all.map((e) => e.ruleId))];
    const readable = new Set(
      resolver.filterByPermission(req.user?.userId ?? "", "automation", ruleIds, "read"),
    );
    let entries = all.filter((e) => readable.has(e.ruleId));
    if (limit !== undefined && limit >= 0) {
      entries = entries.slice(0, limit);
    }
    res.json(entries);
  });

  /**
   * POST /api/automations/trigger/:name — fire a named trigger event.
   *
   * A named trigger emits a global `service/trigger/{name}` event that any
   * automation can subscribe to, so the supplied tab was never tied to the
   * automations that actually run. `requireTabPermission("interact")` therefore
   * let any interact-permitted tab fire a trigger consumed by an automation
   * outside that tab. Until trigger→automation ownership is persisted and
   * authorized server-side, generic named triggers are admin-only (R3).
   */
  router.post("/trigger/:name", requireAdmin, (req, res) => {
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
    // Existence checked above (404); resource read permission checked here (403).
    if (!canReadAutomation(req, id)) {
      res.status(403).json({ error: "Forbidden" });
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

  /** GET /api/automations — list all UI rules (form + script) */
  router.get("/", (req, res) => {
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
        ownerTabId: row.owner_tab_id ?? null,
        authoredUnrestricted: row.authored_unrestricted === 1,
        hasUi: row.compiled_ui != null,
      };
      if (ruleType === "form") {
        entry.actionType = row.action_type;
        entry.actionTarget = row.action_target;
        entry.actionParams = JSON.parse(row.action_params);
        entry.conditionType = row.condition_type;
        entry.conditionValue = row.condition_value;
      } else if (ruleType === "script") {
        entry.conditionType = row.condition_type;
        entry.conditionValue = row.condition_value;
        const rawMeta = row.structured_metadata;
        entry.structured = rawMeta ? JSON.parse(rawMeta) : null;
      }
      dbRules.push(entry);
    }

    // Admins see every rule; non-admins see only rules exposed by a tab their
    // group can reach at >= read.
    if (req.user?.role === "admin") {
      res.json(dbRules);
      return;
    }
    const readable = new Set(
      resolver.filterByPermission(
        req.user?.userId ?? "",
        "automation",
        dbRules.map((r) => r.id as string),
        "read",
      ),
    );
    res.json(dbRules.filter((r) => readable.has(r.id as string)));
  });

  /** POST /api/automations — create a new UI rule (form or script) */
  router.post("/", requireTabPermission("write"), validate({ body: createAutomationBodySchema }), asyncHandler(async (req, res) => {
    const { name, triggerTopic, ruleType, conditionType, conditionValue, actionType, actionTarget, actionParams, project, uiSource, triggerType: rawTriggerType, cronExpression } = req.body;

    if (!name) {
      throw new BadRequestError("name is required");
    }

    const { triggerType, effectiveTriggerTopic, effectiveCronExpression } =
      resolveTriggerConfig({ rawTriggerType, triggerTopic, cronExpression });

    const id = randomUUID();
    const now = Date.now();

    // Bind the automation's authorization scope from the caller's server-side
    // role. Admins author unrestricted (system-wide) automations; a non-admin
    // authors a scoped automation confined to the tab they named — the
    // `requireTabPermission("write")` guard already verified they hold write on
    // it, and that named tab is both the ownership binding and the authority
    // ceiling (it can never grant authority over another tab).
    const authoredUnrestricted = req.user?.role === "admin" ? 1 : 0;
    const ownerTabId =
      authoredUnrestricted === 1
        ? null
        : ((req.body?.tabId ?? req.query.tabId) as string);

    if (ruleType === "script") {
      if (uiSource !== undefined) {
        throw new BadRequestError("script UI source must be supplied through the Automation Project");
      }
      // Automation Projects are the only new script-authoring contract. Legacy
      // runtime columns remain as a projection for execution and upgrades, but
      // callers cannot create a second single-file authoring path.
      if (!project) {
        throw new BadRequestError("project is required for script rules");
      }
      let compiledProject: Awaited<ReturnType<typeof compileAutomationProject>>;
      try {
        compiledProject = await compileAutomationProject(project as AutomationProject);
      } catch (error) {
        if (error instanceof AutomationProjectCompileError) {
          throw compilationError("Automation Project compilation failed", error.details);
        }
        throw error;
      }
      const effectiveScriptSource = compiledProject.logicSource;
      const effectiveUiSource = compiledProject.uiSource;
      const compiledJs = compiledProject.compiledJs;
      const compiledUi = compiledProject.compiledUi;
      const structuredJson: string | null = null;

      db.transaction(() => {
        db.prepare(
          `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, script_source, compiled_js, structured_metadata, ui_source, compiled_ui, trigger_type, cron_expression, authored_unrestricted, owner_tab_id, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, 'script', '', '{}', 'script', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        ).run(id, name, effectiveTriggerTopic, conditionType || null, conditionValue || null, effectiveScriptSource, compiledJs, structuredJson, effectiveUiSource, compiledUi, triggerType, effectiveCronExpression, authoredUnrestricted, ownerTabId, now);
        saveAutomationProject(db, id, compiledProject);
      })();

      registerUiRule(engine, registry, commandService, {
        id, name, trigger_topic: effectiveTriggerTopic,
        condition_type: conditionType || null, condition_value: conditionValue || null,
        action_type: "script", action_target: "", action_params: "{}",
        rule_type: "script", script_source: effectiveScriptSource ?? null, compiled_js: compiledJs,
        structured_metadata: structuredJson, ui_source: effectiveUiSource, compiled_ui: compiledUi,
        trigger_type: triggerType, cron_expression: effectiveCronExpression,
        authored_unrestricted: authoredUnrestricted, owner_tab_id: ownerTabId,
        enabled: 1, created_at: now,
      }, conditionRegistry);

      logger.info({ ruleId: id, name, triggerTopic: effectiveTriggerTopic, ruleType: "script", ownerTabId }, "Script automation rule created");
      res.json({ success: true, id, ownerTabId, authoredUnrestricted: authoredUnrestricted === 1 });
    } else {
      // Form rule (default). Legacy form rules may still pair a single UI
      // source blob; script rules use Automation Project UI exclusively.
      const { uiSourceValue, compiledUiValue } = resolveUiSource(uiSource);
      if (!actionType || !actionTarget) {
        throw new BadRequestError("actionType and actionTarget are required for form rules");
      }

      db.prepare(
        `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, ui_source, compiled_ui, trigger_type, cron_expression, authored_unrestricted, owner_tab_id, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'form', ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(id, name, effectiveTriggerTopic, conditionType || null, conditionValue || null, actionType, actionTarget, JSON.stringify(actionParams || {}), uiSourceValue, compiledUiValue, triggerType, effectiveCronExpression, authoredUnrestricted, ownerTabId, now);

      registerUiRule(engine, registry, commandService, {
        id, name, trigger_topic: effectiveTriggerTopic,
        condition_type: conditionType || null, condition_value: conditionValue || null,
        action_type: actionType, action_target: actionTarget,
        action_params: JSON.stringify(actionParams || {}),
        rule_type: "form", script_source: null, compiled_js: null,
        structured_metadata: null, ui_source: uiSourceValue, compiled_ui: compiledUiValue,
        trigger_type: triggerType, cron_expression: effectiveCronExpression,
        authored_unrestricted: authoredUnrestricted, owner_tab_id: ownerTabId,
        enabled: 1, created_at: now,
      }, conditionRegistry);

      logger.info({ ruleId: id, name, triggerTopic: effectiveTriggerTopic, ownerTabId }, "Form automation rule created");
      res.json({ success: true, id, ownerTabId, authoredUnrestricted: authoredUnrestricted === 1 });
    }
  }));

  /** PUT /api/automations/:id — update an existing UI rule */
  router.put("/:id", requireAutomation("write"), validate({ body: updateAutomationBodySchema, params: automationIdParamsSchema }), asyncHandler(async (req, res) => {
    const id = req.params.id as string;

    // Check rule exists
    const existing = queryRuleById(db, id);
    if (!existing) {
      throw new NotFoundError(`Automation rule ${id} not found`);
    }
    // A non-admin cannot edit an unrestricted automation's Logic/config and thereby
    // inherit its system-wide authority (audit Critical 1).
    assertMayMutateAuthority(req, existing);

    const { name, triggerTopic, conditionType, conditionValue, actionType, actionTarget, actionParams, project, uiSource, triggerType: rawTriggerType, cronExpression } = req.body;

    const { triggerType, effectiveTriggerTopic, effectiveCronExpression } =
      resolveTriggerConfig({ rawTriggerType, triggerTopic, cronExpression }, existing);

    if (existing.rule_type === "script") {
      if (uiSource !== undefined) {
        throw new BadRequestError("script UI source must be supplied through the Automation Project");
      }
      let updatedSource = existing.script_source;
      let updatedUiSource = existing.ui_source;
      let compiledJs = existing.compiled_js;
      let compiledUi = existing.compiled_ui;
      let structuredJson = existing.structured_metadata;
      let compiledProject: Awaited<ReturnType<typeof compileAutomationProject>> | null = null;

      if (project) {
        try {
          compiledProject = await compileAutomationProject(project as AutomationProject);
        } catch (error) {
          if (error instanceof AutomationProjectCompileError) {
            throw compilationError("Automation Project compilation failed", error.details);
          }
          throw error;
        }
        updatedSource = compiledProject.logicSource;
        updatedUiSource = compiledProject.uiSource;
        compiledJs = compiledProject.compiledJs;
        compiledUi = compiledProject.compiledUi;
        structuredJson = null;
      }

      if (!updatedSource || !compiledJs) {
        throw new BadRequestError("script automation has no compiled Automation Project runtime projection");
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, script_source = ?, compiled_js = ?, structured_metadata = ?, ui_source = ?, compiled_ui = ?, trigger_type = ?, cron_expression = ? WHERE id = ?`
        ).run(
          name || existing.name,
          effectiveTriggerTopic,
          preserveOrReplace(conditionType, existing.condition_type),   // Req 8.5
          preserveOrReplace(conditionValue, existing.condition_value), // Req 8.5
          updatedSource, compiledJs, structuredJson, updatedUiSource, compiledUi,
          triggerType, effectiveCronExpression, id,
        );
        if (compiledProject) {
          saveAutomationProject(db, id, compiledProject);
        }
      })();

      // Re-register in engine
      engine.unregister(id);
      const updated = queryRuleById(db, id)!;
      if (updated.enabled) {
        registerUiRule(engine, registry, commandService, updated, conditionRegistry);
      }

      logger.info({ ruleId: id, name: updated.name }, "Script automation rule updated");
      res.json({ success: true, id });
    } else {
      // Form rule update. Script UI source comes only from its Project.
      const { uiSourceValue, compiledUiValue } = resolveUiSource(uiSource, existing);
      // Resolve the effective action target (use submitted or existing).
      const effectiveActionTarget = actionTarget || existing.action_target;

      db.prepare(
        `UPDATE automation_rules SET name = ?, trigger_topic = ?, condition_type = ?, condition_value = ?, action_type = ?, action_target = ?, action_params = ?, ui_source = ?, compiled_ui = ?, trigger_type = ?, cron_expression = ? WHERE id = ?`
      ).run(
        name || existing.name,
        effectiveTriggerTopic,
        preserveOrReplace(conditionType, existing.condition_type),   // Req 8.5
        preserveOrReplace(conditionValue, existing.condition_value), // Req 8.5
        actionType || existing.action_type,
        effectiveActionTarget,
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
        registerUiRule(engine, registry, commandService, updated, conditionRegistry);
      }

      logger.info({ ruleId: id, name: updated.name }, "Form automation rule updated");
      res.json({ success: true, id });
    }
  }));

  /** DELETE /api/automations/:id — delete a UI rule */
  router.delete("/:id", requireAutomation("write"), asyncHandler((req, res) => {
    const id = req.params.id as string;
    const existing = queryRuleById(db, id);
    if (!existing) {
      throw new NotFoundError(`Automation rule ${id} not found`);
    }
    // A non-admin cannot delete an unrestricted automation (audit Critical 1).
    assertMayMutateAuthority(req, existing);
    if (stateStore) {
      stateStore.deleteAll(id);
    }
    db.prepare("DELETE FROM automation_rules WHERE id = ?").run(id);
    engine.unregister(id);
    logger.info({ ruleId: id, ruleType: existing.rule_type }, "Automation rule deleted");
    res.json({ success: true });
  }));

  /** PATCH /api/automations/:id/toggle — enable/disable a UI rule */
  router.patch("/:id/toggle", requireAutomation("write"), validate({ body: toggleAutomationBodySchema, params: automationIdParamsSchema }), asyncHandler((req, res) => {
    const id = req.params.id as string;
    const { enabled } = req.body;

    const existing = queryRuleById(db, id);
    if (!existing) {
      throw new NotFoundError(`Automation rule ${id} not found`);
    }
    // A non-admin cannot enable/disable an unrestricted automation (audit Critical 1).
    assertMayMutateAuthority(req, existing);

    db.prepare("UPDATE automation_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);

    if (enabled) {
      // Re-register — reload from DB to get latest state
      const updated = queryRuleById(db, id)!;
      registerUiRule(engine, registry, commandService, updated, conditionRegistry);
    } else {
      engine.unregister(id);
    }

    res.json({ success: true, enabled: !!enabled });
  }));

  /** POST /api/automations/:id/fire — manually fire a specific automation rule */
  router.post("/:id/fire", demoFireRateLimiter, requireAutomation("interact"), asyncHandler(async (req, res) => {
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
    const result = await engine.fire(id, context);

    logger.info({ ruleId: id, ruleName: rule.name }, "Automation rule manually fired");
    res.json({
      success: result.success,
      ruleId: id,
      executionId: result.executionId,
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    });
  }));

  /** GET /api/automations/:id/state — return all state key-value pairs for a rule */
  router.get("/:id/state", (req, res, next) => {
    const id = req.params.id as string;
    // Existence before permission (404 before 403).
    if (!queryRuleById(db, id)) {
      return next(new NotFoundError(`Automation rule ${id} not found`));
    }
    if (!canReadAutomation(req, id)) {
      return next(new ForbiddenError());
    }
    const state = stateStore ? stateStore.getAll(id) : {};
    return res.json(state);
  });

  /** PUT /api/automations/:id/state — upsert a key-value pair, persist + broadcast */
  router.put("/:id/state", demoWriteRateLimiter, requireAutomation("interact"), validate({ body: automationStateBodySchema, params: automationIdParamsSchema }), asyncHandler((req, res) => {
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
  router.delete("/:id/state/:key", requireAutomation("interact"), asyncHandler((req, res) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    if (stateStore) {
      stateStore.delete(id, key);
    }
    res.json({ success: true });
  }));

  /**
   * PATCH /api/automations/:id/demo-access — set the per-rule public-demo
   * allowlist (public-demo-mode spec). Admin-only: this is demo configuration
   * authored by the Aeolus project (used by the demo seed), not runtime user
   * data. Stores the JSON on automation_rules.demo_access; passing an empty body
   * clears it.
   */
  router.patch("/:id/demo-access", requireAdmin, validate({ body: demoAccessBodySchema, params: automationIdParamsSchema }), asyncHandler((req, res) => {
    const id = req.params.id as string;
    if (!automationExists(db, id)) {
      throw new NotFoundError(`Automation rule ${id} not found`);
    }
    const { writableStateKeys, fireEvents } = req.body;
    const hasAny = writableStateKeys !== undefined || fireEvents !== undefined;
    const value = hasAny ? JSON.stringify({ writableStateKeys, fireEvents }) : null;
    db.prepare("UPDATE automation_rules SET demo_access = ? WHERE id = ?").run(value, id);
    res.json({ success: true });
  }));

  return router;
}

/** Query a single rule from the DB by ID */
function queryRuleById(db: DatabaseType, id: string): StoredRule | null {
  const row = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(id) as StoredRule | undefined;
  return row ?? null;
}

/**
 * Existence predicate for the automation authorization middleware. Kept in this
 * module so the middleware's 404 check and the handlers agree on whether a rule
 * exists.
 */
export function automationExists(db: DatabaseType, id: string): boolean {
  return queryRuleById(db, id) !== null;
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

/** Convert a stored UI rule into a live automation rule and register it */
function registerUiRule(
  engine: AutomationEngine,
  registry: DeviceRegistry,
  commandService: CommandService,
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
    // Form rule — dispatch through CommandService without a requested tier, so the
    // boundary resolves the highest tier the TARGET DEVICE can actually prove.
    const params = JSON.parse(stored.action_params);
    const action = async (_context: EventContext) => {
      const descriptor: ActionDescriptor = {
        type: stored.action_type,
        target: stored.action_target,
        params,
      };
      return commandService.execute(descriptor, stored.id);
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
  commandService: CommandService,
  conditionRegistry?: ConditionRegistry,
): void {
  const rows = db.prepare("SELECT * FROM automation_rules WHERE enabled = 1").all() as StoredRule[];
  if (rows.length === 0) return;

  let loaded = 0;
  for (const row of rows) {
    registerUiRule(engine, registry, commandService, row, conditionRegistry);
    loaded++;
  }
  logger.info({ loaded }, "Loaded UI automation rules from database");
}
