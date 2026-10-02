// src/api/routes/layout.routes.ts — Layout persistence endpoints (GET/PUT /api/layout)

import { Router } from "express";
import type { Database as DatabaseType } from "better-sqlite3";
import { BadRequestError, ConflictError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { mutationIdFromRequest, requireIfMatchRevision } from "../middleware/revision-precondition.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import type { PermissionResolver } from "../../auth/permission-resolver.js";
import { safeJsonParse } from "../../core/safe-json.js";
import { extractAutomationAssignments, extractCollectionAssignments, type PaneRef } from "../../auth/pane-reference-extractor.js";
import { CONFIGURATION_INVALIDATED, eventBus } from "../../core/event-bus.js";
import logger from "../../logger.js";

interface TabRow {
  id: string;
  name: string;
  icon: string;
  order: number;
  pinned: number;
  created_at: number;
}

interface PaneRow {
  id: string;
  tab_id: string;
  pane_type: string;
  config: string;
  x: number;
  y: number;
  w: number;
  h: number;
  created_at: number;
}

export function createLayoutRoutes(
  db: DatabaseType,
  resolver: PermissionResolver,
): Router {
  const router = Router();

  /**
   * GET /api/layout → { tabs: Tab[], panes: Pane[] }
   *
   * Admins receive the full layout. Non-admins receive only the tabs their group
   * can reach (any permission level) and the panes on those tabs, so the layout
   * does not disclose tabs and pane configuration the user has no access to.
   * Accessible tabs are resolved server-side from group assignments, never from
   * a caller-supplied tab identifier.
   */
  router.get("/", (req, res) => {
    try {
      const tabRows = db.prepare('SELECT * FROM tabs ORDER BY "order"').all() as TabRow[];
      const paneRows = db.prepare("SELECT * FROM panes").all() as PaneRow[];

      const tabs = tabRows.map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon,
        order: row.order,
        pinned: row.pinned === 1,
        createdAt: row.created_at,
      }));

      const panes = paneRows.map((row) => ({
        id: row.id,
        tabId: row.tab_id,
        paneType: row.pane_type,
        config: safeJsonParse(row.config, { paneId: row.id }, "Malformed JSON in pane config, substituting empty config") ?? {},
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        createdAt: row.created_at,
      }));

      const revision = (db.prepare("SELECT revision FROM layout_metadata WHERE singleton = 1").get() as { revision: number } | undefined)?.revision ?? 1;

      if (req.user?.role === "admin") {
        res.json({ revision, tabs, panes });
        return;
      }

      const accessible = new Set(resolver.accessibleTabIds(req.user?.userId ?? ""));
      res.json({
        revision,
        tabs: tabs.filter((t) => accessible.has(t.id)),
        panes: panes.filter((p) => accessible.has(p.tabId)),
      });
    } catch (err) {
      logger.error(err, "Failed to read layout from database");
      // A failed read must not invent a revision that could authorize a later
      // whole-layout overwrite. Clients may render the empty fallback, but
      // persistence stays disabled until a successful read supplies a revision.
      res.json({ revision: null, tabs: [], panes: [] });
    }
  });

  /** PUT /api/layout ← { tabs, panes } → { success: true } */
  router.put("/", requireAdmin, asyncHandler((req, res) => {
    const { tabs, panes } = req.body;

    if (!Array.isArray(tabs) || !Array.isArray(panes)) {
      throw new BadRequestError("Invalid layout payload: tabs and panes must be arrays");
    }
    const expectedRevision = requireIfMatchRevision(req);

    // Atomic replace using better-sqlite3 transaction
    const replaceLayout = db.transaction((tabsData: typeof tabs, panesData: typeof panes) => {
      const advanced = db.prepare(
        "UPDATE layout_metadata SET revision = revision + 1 WHERE singleton = 1 AND revision = ?",
      ).run(expectedRevision);
      if (advanced.changes !== 1) {
        throw new ConflictError("The dashboard changed while you were editing it");
      }

      db.prepare("DELETE FROM panes").run();
      db.prepare("DELETE FROM tabs").run();

      const insertTab = db.prepare(
        `INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const tab of tabsData) {
        insertTab.run(tab.id, tab.name, tab.icon, tab.order, tab.pinned ? 1 : 0, tab.createdAt);
      }

      const insertPane = db.prepare(
        `INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const pane of panesData) {
        insertPane.run(pane.id, pane.tabId, pane.paneType, JSON.stringify(pane.config ?? {}), pane.x, pane.y, pane.w, pane.h, pane.createdAt);
      }

      // Reconcile automation→tab ownership to match the new layout, in the same
      // transaction so a partial failure rolls back both. Because PUT /api/layout
      // replaces the entire layout, the desired set derived from the new panes
      // is authoritative: clear all assignments and rebuild from the new panes'
      // explicit `config.ruleId` references (dropping references to automations
      // that no longer exist). No device assignment work — device exposure is
      // computed live and needs no maintenance.
      db.prepare("DELETE FROM automation_tab_assignments").run();

      const existingAutomationIds = new Set(
        (db.prepare("SELECT id FROM automation_rules").all() as { id: string }[]).map((r) => r.id),
      );
      const paneRefs: PaneRef[] = panesData.map((pane) => ({
        tabId: pane.tabId,
        paneType: pane.paneType,
        config: (pane.config ?? {}) as Record<string, unknown>,
      }));
      const desiredByTab = extractAutomationAssignments(paneRefs, existingAutomationIds);

      const insertAssignment = db.prepare(
        "INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
      );
      for (const [tabId, automationIds] of desiredByTab) {
        for (const automationId of automationIds) {
          insertAssignment.run(automationId, tabId);
        }
      }

      // Reconcile collection→tab ownership the same way: clear and rebuild from
      // the new panes' explicit `config.collection` references. Scopes Data
      // Store live events to the tabs that surface each collection. A collection
      // name is a plain reference (no FK), so a pane may point at a not-yet-
      // created collection without failing the write.
      db.prepare("DELETE FROM collection_tab_assignments").run();
      const desiredCollectionsByTab = extractCollectionAssignments(paneRefs);
      const insertCollectionAssignment = db.prepare(
        "INSERT OR IGNORE INTO collection_tab_assignments (collection_name, tab_id) VALUES (?, ?)",
      );
      for (const [tabId, collectionNames] of desiredCollectionsByTab) {
        for (const collectionName of collectionNames) {
          insertCollectionAssignment.run(collectionName, tabId);
        }
      }
    });

    replaceLayout(tabs, panes);

    const revision = (db.prepare("SELECT revision FROM layout_metadata WHERE singleton = 1").get() as { revision: number }).revision;
    eventBus.emit(CONFIGURATION_INVALIDATED, {
      resource: "layout",
      revision,
      mutationId: mutationIdFromRequest(req),
    });
    logger.info({ tabs: tabs.length, panes: panes.length, revision }, "Layout persisted");
    res.json({ success: true, revision });
  }));

  return router;
}
