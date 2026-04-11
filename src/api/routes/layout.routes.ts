// src/api/routes/layout.routes.ts — Layout persistence endpoints (GET/PUT /api/layout)

import { Router } from "express";
import type { Database } from "sql.js";
import { BadRequestError } from "../middleware/error-handler.js";
import { persistDatabase } from "../../db/database.js";
import logger from "../../logger.js";

export function createLayoutRoutes(db: Database): Router {
  const router = Router();

  /** GET /api/layout → { tabs: Tab[], panes: Pane[] } */
  router.get("/", (_req, res) => {
    try {
      const tabResults = db.exec('SELECT * FROM tabs ORDER BY "order"');
      const paneResults = db.exec("SELECT * FROM panes");

      const tabs = rowsToObjects(tabResults).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        icon: row.icon as string,
        order: row.order as number,
        pinned: row.pinned === 1,
        createdAt: row.created_at as number,
      }));

      const panes = rowsToObjects(paneResults).map((row) => ({
        id: row.id as string,
        tabId: row.tab_id as string,
        paneType: row.pane_type as string,
        config: safeJsonParse(row.config as string),
        x: row.x as number,
        y: row.y as number,
        w: row.w as number,
        h: row.h as number,
        createdAt: row.created_at as number,
      }));

      res.json({ tabs, panes });
    } catch (err) {
      logger.error(err, "Failed to read layout from database");
      res.json({ tabs: [], panes: [] });
    }
  });

  /** PUT /api/layout ← { tabs, panes } → { success: true } */
  router.put("/", (req, res, next) => {
    try {
      const { tabs, panes } = req.body;

      if (!Array.isArray(tabs) || !Array.isArray(panes)) {
        throw new BadRequestError("Invalid layout payload: tabs and panes must be arrays");
      }

      // Atomic replace: delete all then insert all
      db.run("BEGIN TRANSACTION");
      try {
        db.run("DELETE FROM panes");
        db.run("DELETE FROM tabs");

        for (const tab of tabs) {
          db.run(
            `INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [tab.id, tab.name, tab.icon, tab.order, tab.pinned ? 1 : 0, tab.createdAt],
          );
        }

        for (const pane of panes) {
          db.run(
            `INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [pane.id, pane.tabId, pane.paneType, JSON.stringify(pane.config ?? {}), pane.x, pane.y, pane.w, pane.h, pane.createdAt],
          );
        }

        db.run("COMMIT");
      } catch (txErr) {
        db.run("ROLLBACK");
        throw txErr;
      }

      persistDatabase();
      logger.info({ tabs: tabs.length, panes: panes.length }, "Layout persisted");
      res.json({ success: true });
    } catch (err) {
      if (err instanceof BadRequestError) {
        next(err);
        return;
      }
      logger.error(err, "Failed to persist layout");
      next(err);
    }
  });

  return router;
}

/** Convert sql.js exec results into an array of plain objects */
function rowsToObjects(results: ReturnType<Database["exec"]>): Record<string, unknown>[] {
  if (results.length === 0) return [];
  const { columns, values } = results[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

/** Safely parse a JSON string, returning {} on failure */
function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    logger.warn({ raw: str }, "Malformed JSON in pane config, substituting empty config");
    return {};
  }
}
