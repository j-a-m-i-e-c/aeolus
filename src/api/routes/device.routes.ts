// src/api/routes/device.routes.ts — Device CRUD and action endpoints

import { Router } from "express";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { IntegrationManager } from "../../integrations/integration-manager.js";
import { NotFoundError } from "../middleware/error-handler.js";
import { validateAction } from "../middleware/validators.js";
import logger from "../../logger.js";

export function createDeviceRoutes(
  registry: DeviceRegistry,
  integrationManager: IntegrationManager
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

  /** POST /api/devices/:id/action — execute action on device */
  router.post("/:id/action", validateAction, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const device = registry.getById(id);
      if (!device) {
        return next(new NotFoundError(`Device not found: ${id}`));
      }

      await integrationManager.execute(id, {
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