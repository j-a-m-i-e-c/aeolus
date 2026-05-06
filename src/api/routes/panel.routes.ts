// src/api/routes/panel.routes.ts — Custom Panels CRUD API

import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import type { Database } from "sql.js";
import { transpileUi } from "../../automations/transpiler.js";
import { PANEL_STATE_CHANGE } from "../../core/event-bus.js";
import { persistDatabase } from "../../db/database.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import type { PanelStateStore } from "../../panels/panel-state-store.js";

/** Default TSX template for newly created panels */
const DEFAULT_TEMPLATE = `import type { CustomPanelProps } from "./types";

export default function MyPanel(props: CustomPanelProps) {
  const { devices, panelName } = props;

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm font-semibold text-[#E6EDF3]">{panelName}</div>
      <div className="text-xs text-[#9AA6B2]">{devices.length} devices available</div>
    </div>
  );
}
`;

interface StoredPanel {
  id: string;
  name: string;
  ui_source: string | null;
  compiled_ui: string | null;
  created_at: number;
  updated_at: number;
}

function queryPanelById(db: Database, id: string): StoredPanel | null {
  const results = db.exec("SELECT * FROM custom_panels WHERE id = ?", [id]);
  if (results.length === 0 || results[0].values.length === 0) return null;

  const cols = results[0].columns;
  const row = results[0].values[0];
  const obj: Record<string, unknown> = {};
  cols.forEach((col, i) => {
    obj[col] = row[i];
  });
  return obj as unknown as StoredPanel;
}

function formatPanel(panel: StoredPanel) {
  return {
    id: panel.id,
    name: panel.name,
    uiSource: panel.ui_source,
    compiledUi: panel.compiled_ui,
    createdAt: panel.created_at,
    updatedAt: panel.updated_at,
  };
}

export function createPanelRoutes(
  db: Database,
  panelStateStore: PanelStateStore,
  eventBus: EventEmitter,
): Router {
  const router = Router();

  /** GET /api/panels — list all panels */
  router.get("/", (_req, res) => {
    const results = db.exec("SELECT * FROM custom_panels ORDER BY created_at DESC");
    if (results.length === 0) {
      res.json([]);
      return;
    }

    const cols = results[0].columns;
    const panels = results[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        obj[col] = row[i];
      });
      return formatPanel(obj as unknown as StoredPanel);
    });

    res.json(panels);
  });

  /** POST /api/panels — create a new panel */
  router.post("/", (req, res, next) => {
    try {
      const { name } = req.body;

      if (!name) {
        throw new BadRequestError("name is required");
      }

      const id = randomUUID();
      const now = Date.now();

      // Transpile the default template
      const uiResult = transpileUi(DEFAULT_TEMPLATE);
      const compiledUi = uiResult.success ? uiResult.js : null;

      db.run(
        `INSERT INTO custom_panels (id, name, ui_source, compiled_ui, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, name, DEFAULT_TEMPLATE, compiledUi, now, now],
      );
      persistDatabase();

      const panel = queryPanelById(db, id)!;
      res.json(formatPanel(panel));
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/panels/:id — get a single panel */
  router.get("/:id", (req, res, next) => {
    try {
      const id = req.params.id;
      const panel = queryPanelById(db, id);

      if (!panel) {
        throw new NotFoundError("Panel not found");
      }

      res.json(formatPanel(panel));
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/panels/:id — update panel name and/or uiSource */
  router.put("/:id", (req, res, next) => {
    try {
      const id = req.params.id;
      const existing = queryPanelById(db, id);

      if (!existing) {
        throw new NotFoundError("Panel not found");
      }

      const { name, uiSource } = req.body;
      const now = Date.now();

      let uiSourceValue: string | null = existing.ui_source;
      let compiledUiValue: string | null = existing.compiled_ui;

      if (typeof uiSource === "string") {
        // Transpile the new source
        const uiResult = transpileUi(uiSource);
        if (!uiResult.success) {
          res.status(400).json({
            error: "TSX compilation failed",
            statusCode: 400,
            details: uiResult.errors,
          });
          return;
        }
        uiSourceValue = uiSource;
        compiledUiValue = uiResult.js;
      }

      db.run(
        `UPDATE custom_panels SET name = ?, ui_source = ?, compiled_ui = ?, updated_at = ? WHERE id = ?`,
        [name || existing.name, uiSourceValue, compiledUiValue, now, id],
      );
      persistDatabase();

      const updated = queryPanelById(db, id)!;
      res.json(formatPanel(updated));
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/panels/:id — delete panel and cascade state */
  router.delete("/:id", (req, res, next) => {
    try {
      const id = req.params.id;
      const panel = queryPanelById(db, id);

      if (!panel) {
        throw new NotFoundError("Panel not found");
      }

      // Cascade delete state
      panelStateStore.deleteAll(id);

      db.run("DELETE FROM custom_panels WHERE id = ?", [id]);
      persistDatabase();

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/panels/:id/state — return all state as JSON object */
  router.get("/:id/state", (req, res, next) => {
    try {
      const id = req.params.id;
      const panel = queryPanelById(db, id);

      if (!panel) {
        throw new NotFoundError("Panel not found");
      }

      const state = panelStateStore.getAll(id);
      res.json(state);
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/panels/:id/state — persist key-value and emit event */
  router.put("/:id/state", (req, res, next) => {
    try {
      const id = req.params.id;
      const panel = queryPanelById(db, id);

      if (!panel) {
        throw new NotFoundError("Panel not found");
      }

      const { key, value } = req.body;

      if (key === undefined || key === null || key === "") {
        throw new BadRequestError("key and value are required");
      }
      if (value === undefined) {
        throw new BadRequestError("key and value are required");
      }

      panelStateStore.set(id, key, value);

      eventBus.emit(PANEL_STATE_CHANGE, { panelId: id, key, value });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/panels/:id/ui-module — serve compiled UI as JavaScript */
  router.get("/:id/ui-module", (req, res, next) => {
    try {
      const id = req.params.id;
      const panel = queryPanelById(db, id);

      if (!panel) {
        throw new NotFoundError("Panel not found");
      }

      if (!panel.compiled_ui) {
        res.status(404).json({ error: "No compiled UI module" });
        return;
      }

      res.set("Content-Type", "application/javascript");
      res.set("Cache-Control", "no-cache");
      res.send(panel.compiled_ui);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
