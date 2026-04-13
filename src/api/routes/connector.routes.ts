// src/api/routes/connector.routes.ts — Generic Connector REST API

import { Router } from "express";
import type { ConnectorManager } from "../../connectors/connector-manager.js";
import type { ConnectorRegistry } from "../../connectors/connector-registry.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import logger from "../../logger.js";

/**
 * Create Express router for all connector endpoints.
 *
 * Provides a single set of REST endpoints that replace per-connector route files.
 * All connector-specific behaviour is driven through the Connector interface.
 */
export function createConnectorRoutes(
  connectorManager: ConnectorManager,
  connectorRegistry: ConnectorRegistry,
): Router {
  const router = Router();

  /** GET /api/connectors/available — list discovered connector types with metadata and configSchema */
  router.get("/available", (_req, res) => {
    const available = connectorRegistry.listAvailable();
    res.json(available);
  });

  /** GET /api/connectors — list enabled connector instances with redacted passwords */
  router.get("/", (_req, res) => {
    const enabled = connectorManager.listEnabled();

    const redacted = enabled.map((instance) => {
      const mod = connectorRegistry.getModule(instance.connectorType);
      const redactedConfig = redactPasswords(instance.config, mod);
      return { ...instance, config: redactedConfig };
    });

    res.json(redacted);
  });

  /** POST /api/connectors — enable a new connector instance */
  router.post("/", async (req, res, next) => {
    try {
      const { connector_type, config } = req.body;

      const mod = connectorRegistry.getModule(connector_type);
      if (!mod) {
        throw new NotFoundError(`Connector type '${connector_type}' not found`);
      }

      // Validate required config fields against the configSchema
      const missingFields = getMissingRequiredFields(config ?? {}, mod.configSchema);
      if (missingFields.length > 0) {
        throw new BadRequestError(
          `Missing required fields: ${missingFields.join(", ")}`,
        );
      }

      const instanceId = await connectorManager.enable(connector_type, config ?? {});
      logger.info({ connector_type, instanceId }, "Connector enabled via API");
      res.json({ success: true, id: instanceId });
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /api/connectors/:id — update connector config */
  router.patch("/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      const { config } = req.body;

      await connectorManager.updateConfig(id, config ?? {});
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/connectors/:id — disable a connector */
  router.delete("/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      await connectorManager.disable(id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/connectors/:id/status — get connector health status */
  router.get("/:id/status", (req, res) => {
    const { id } = req.params;
    const status = connectorManager.getStatus(id);

    if (!status) {
      res.status(404).json({ error: `Connector instance '${id}' not found` });
      return;
    }

    res.json(status);
  });

  /** POST /api/connectors/:id/setup/:stepId — execute a setup step */
  router.post("/:id/setup/:stepId", async (req, res, next) => {
    try {
      const { id, stepId } = req.params;
      const params = req.body ?? {};

      const result = await connectorManager.executeSetupStep(id, stepId, params);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/connectors/:id/retry — retry connection */
  router.post("/:id/retry", async (req, res, next) => {
    try {
      const { id } = req.params;
      await connectorManager.retry(id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Redact password fields in a connector's config based on its configSchema.
 * Fields with type "password" have their values replaced with "********".
 */
function redactPasswords(
  config: Record<string, unknown>,
  mod: ReturnType<ConnectorRegistry["getModule"]>,
): Record<string, unknown> {
  if (!mod) return { ...config };

  const passwordFieldIds = new Set(
    mod.configSchema
      .filter((field) => field.type === "password")
      .map((field) => field.id),
  );

  if (passwordFieldIds.size === 0) return { ...config };

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    redacted[key] = passwordFieldIds.has(key) ? "********" : value;
  }
  return redacted;
}

/**
 * Check which required fields from the configSchema are missing in the provided config.
 * Returns an array of missing field ids.
 */
function getMissingRequiredFields(
  config: Record<string, unknown>,
  configSchema: import("../../connectors/connector.interface.js").ConnectorConfigSchema,
): string[] {
  return configSchema
    .filter((field) => field.required)
    .filter((field) => config[field.id] === undefined || config[field.id] === null || config[field.id] === "")
    .map((field) => field.id);
}
