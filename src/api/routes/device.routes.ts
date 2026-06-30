// src/api/routes/device.routes.ts — Device CRUD and action endpoints

import { Router } from "express";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { ConnectorManager } from "../../connectors/connector-manager.js";
import type { StateHistory } from "../../core/state-history.js";
import { NotFoundError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { validateAction } from "../middleware/validators.js";
import { requireTabPermission } from "../../auth/auth-middleware.js";
import logger from "../../logger.js";

export function createDeviceRoutes(
  registry: DeviceRegistry,
  connectorManager: ConnectorManager,
  stateHistory?: StateHistory,
): Router {
  const router = Router();

  /** GET /api/devices — list all devices */
  router.get("/", (_req, res) => {
    res.json(registry.getAll());
  });

  /** GET /api/devices/:id — get single device */
  router.get("/:id", (req, res, next) => {
    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      return next(new NotFoundError(`Device not found: ${id}`));
    }
    return res.json(device);
  });

  /** GET /api/devices/:id/actions — return the action catalog for a device */
  router.get("/:id/actions", (req, res) => {
    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      res.status(404).json({ error: `Device not found: ${id}` });
      return;
    }

    // Delegate catalog resolution to ConnectorManager
    const catalog = connectorManager.getActionCatalog(id);
    res.json(catalog);
  });

  /** GET /api/devices/:id/history — get state history for a device */
  router.get("/:id/history", (req, res, next) => {
    if (!stateHistory) {
      return res.json([]);
    }

    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      return next(new NotFoundError(`Device not found: ${id}`));
    }

    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;

    if (from !== undefined && to !== undefined) {
      return res.json(stateHistory.getHistoryRange(id, from, to));
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    return res.json(stateHistory.getHistory(id, limit));
  });

  /** DELETE /api/devices/:id/history — clear history for a specific device */
  router.delete("/:id/history", (req, res, next) => {
    if (!stateHistory) {
      return res.json({ success: true, deleted: 0 });
    }

    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      return next(new NotFoundError(`Device not found: ${id}`));
    }

    const deleted = stateHistory.clearDevice(id);
    logger.info({ deviceId: id, deleted }, "Cleared device state history");
    return res.json({ success: true, deleted });
  });

  /** DELETE /api/devices/history/all — clear all device history */
  router.delete("/history/all", (_req, res) => {
    if (!stateHistory) {
      return res.json({ success: true, deleted: 0 });
    }

    const deleted = stateHistory.clearAll();
    logger.info({ deleted }, "Cleared all device state history");
    return res.json({ success: true, deleted });
  });

  /** POST /api/devices/:id/action — execute action on device */
  router.post("/:id/action", requireTabPermission("interact"), validateAction, asyncHandler(async (req, res) => {
    const id = req.params.id as string;

    const result = await connectorManager.executeAction(id, {
      type: req.body.type,
      deviceId: id,
      params: req.body.params || {},
    });

    if (result.success) {
      logger.info({ deviceId: id, action: req.body.type }, "Action executed");
    } else {
      logger.warn({ deviceId: id, action: req.body.type, error: result.error }, "Action failed");
    }

    // Always HTTP 200 — callers must inspect ActionResult.success
    res.json(result);
  }));

  return router;
}
