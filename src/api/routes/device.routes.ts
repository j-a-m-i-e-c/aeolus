// src/api/routes/device.routes.ts — Device CRUD and action endpoints

import { Router } from "express";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { ConnectorManager } from "../../connectors/connector-manager.js";
import type { StateHistory } from "../../core/state-history.js";
import { NotFoundError } from "../middleware/error-handler.js";
import { validateAction } from "../middleware/validators.js";
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
    res.json(device);
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
    res.json(stateHistory.getHistory(id, limit));
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
    res.json({ success: true, deleted });
  });

  /** DELETE /api/devices/history/all — clear all device history */
  router.delete("/history/all", (_req, res) => {
    if (!stateHistory) {
      return res.json({ success: true, deleted: 0 });
    }

    const deleted = stateHistory.clearAll();
    logger.info({ deleted }, "Cleared all device state history");
    res.json({ success: true, deleted });
  });

  /** POST /api/devices/:id/action — execute action on device */
  router.post("/:id/action", validateAction, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const device = registry.getById(id);
      if (!device) {
        return next(new NotFoundError(`Device not found: ${id}`));
      }

      await connectorManager.executeAction(id, {
        type: req.body.type,
        deviceId: id,
        params: req.body.params || {},
      });

      logger.info({ deviceId: id, action: req.body.type }, "Action executed");
      res.json({ success: true, deviceId: id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
