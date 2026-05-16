// src/api/routes/service.routes.ts — Generic Service REST API

import { Router } from "express";
import type { ServiceManager } from "../../services/service-manager.js";
import type { ServiceRegistry } from "../../services/service-registry.js";
import { TriggerServiceInstance } from "../../services/trigger/index.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import logger from "../../logger.js";

/**
 * Create Express router for all service endpoints.
 *
 * Provides REST endpoints for managing services — mirrors the connector
 * routes pattern. Mounted at `/api/services` in the Express app.
 */
export function createServiceRoutes(
  serviceManager: ServiceManager,
  serviceRegistry: ServiceRegistry,
): Router {
  const router = Router();

  /** GET /api/services/available — list registered service types with metadata and configSchema */
  router.get("/available", (_req, res) => {
    const available = serviceRegistry.listAvailable();
    res.json(available);
  });

  /** GET /api/services/topics — list available service event topics for all enabled services */
  router.get("/topics", (_req, res) => {
    const topics: string[] = [];
    const enabled = serviceManager.listEnabled();

    for (const svc of enabled) {
      if (svc.serviceType === "cron") {
        const instance = serviceManager.getServiceInstance("cron");
        const state = instance?.getState?.();
        if (state && Array.isArray(state.schedules)) {
          for (const schedule of state.schedules as Array<{ name: string }>) {
            topics.push(`service/cron/${schedule.name}`);
          }
        }
      } else if (svc.serviceType === "trigger") {
        topics.push("service/trigger/{name}");
      } else if (svc.serviceType === "system") {
        topics.push("service/system/startup");
        topics.push("service/system/shutdown");
      }
    }

    res.json(topics);
  });

  /** GET /api/services — list enabled service instances with health, config, and service type */
  router.get("/", (_req, res) => {
    const enabled = serviceManager.listEnabled();
    res.json(enabled);
  });

  /** POST /api/services — enable a service */
  router.post("/", requireAdmin, async (req, res, next) => {
    try {
      const { service_type, config } = req.body;

      const mod = serviceRegistry.getModule(service_type);
      if (!mod) {
        throw new NotFoundError(`Service type '${service_type}' not found`);
      }

      // Validate required config fields against the configSchema
      const missingFields = getMissingRequiredFields(config ?? {}, mod.configSchema);
      if (missingFields.length > 0) {
        throw new BadRequestError(
          `Missing required fields: ${missingFields.join(", ")}`,
        );
      }

      const instanceId = await serviceManager.enable(service_type, config ?? {});
      logger.info({ service_type, instanceId }, "Service enabled via API");
      res.json({ success: true, id: instanceId });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/services/trigger/:name — fire an API trigger event */
  router.post("/trigger/:name", (req, res) => {
    const { name } = req.params;
    const body = req.body ?? {};

    const instance = serviceManager.getServiceInstance("trigger") as TriggerServiceInstance | undefined;
    if (instance) {
      instance.emitTrigger(name, body);
    }

    logger.info({ triggerName: name }, "API trigger fired");
    res.json({ success: true, trigger: name });
  });

  /** PATCH /api/services/:id — update service config */
  router.patch("/:id", requireAdmin, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { config } = req.body;

      await serviceManager.updateConfig(id, config ?? {});
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/services/:id — disable and dispose a service */
  router.delete("/:id", requireAdmin, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      await serviceManager.disable(id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/services/:id/status — get detailed health status */
  router.get("/:id/status", (req, res) => {
    const id = req.params.id as string;
    const status = serviceManager.getStatus(id);

    if (!status) {
      res.status(404).json({ error: `Service instance '${id}' not found` });
      return;
    }

    res.json(status);
  });

  /** POST /api/services/:id/retry — retry starting a stopped service */
  router.post("/:id/retry", requireAdmin, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      await serviceManager.retry(id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Check which required fields from the configSchema are missing in the provided config.
 * Returns an array of missing field ids.
 */
function getMissingRequiredFields(
  config: Record<string, unknown>,
  configSchema: import("../../services/service.interface.js").ServiceConfigSchema,
): string[] {
  return configSchema
    .filter((field) => field.required)
    .filter((field) => config[field.id] === undefined || config[field.id] === null || config[field.id] === "")
    .map((field) => field.id);
}
