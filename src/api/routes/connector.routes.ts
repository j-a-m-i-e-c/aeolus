// src/api/routes/connector.routes.ts — Generic Connector REST API

import { Router } from "express";
import type { ConnectorManager } from "../../connectors/connector-manager.js";
import type { ConnectorRegistry } from "../../connectors/connector-registry.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import logger from "../../logger.js";
import { ConnectorConfigError, missingRequiredFields, redactConfig } from "../../connectors/connector-config.js";

/** A refused config is the caller's error (400), with the problems listed. */
async function withConfigErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConnectorConfigError) throw new BadRequestError(error.message);
    throw error;
  }
}

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
  router.post("/", requireAdmin, asyncHandler(async (req, res) => {
    const { connector_type, config } = req.body;

    const mod = connectorRegistry.getModule(connector_type);
    if (!mod) {
      throw new NotFoundError(`Connector type '${connector_type}' not found`);
    }

    if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
      throw new BadRequestError("config must be an object");
    }

    const missingFields = getMissingRequiredFields(config ?? {}, mod.configSchema);
    if (missingFields.length > 0) {
      throw new BadRequestError(`Missing required fields: ${missingFields.join(", ")}`);
    }

    // The module's own checks and refusal of the password-mask placeholder happen
    // in the manager before anything is persisted.
    const instanceId = await withConfigErrors(() => connectorManager.enable(connector_type, config ?? {}));
    logger.info({ connector_type, instanceId }, "Connector enabled via API");
    res.json({ success: true, id: instanceId });
  }));

  /** PATCH /api/connectors/:id — update connector config */
  router.patch("/:id", requireAdmin, asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const { config } = req.body;
    if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
      throw new BadRequestError("config must be an object");
    }

    // A password field posted as the mask keeps its stored secret (connector-config.ts).
    await withConfigErrors(() => connectorManager.updateConfig(id, config ?? {}));
    res.json({ success: true });
  }));

  /** DELETE /api/connectors/:id — disable a connector */
  router.delete("/:id", requireAdmin, asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    await connectorManager.disable(id);
    res.json({ success: true });
  }));

  /** GET /api/connectors/:id/setup-steps — get setup step descriptors for a connector instance */
  router.get("/:id/setup-steps", requireAdmin, (req, res) => {
    const id = req.params.id as string;
    const instance = connectorManager.getStatus(id);
    if (!instance) {
      res.status(404).json({ error: `Connector instance '${id}' not found` });
      return;
    }
    const steps = connectorManager.getSetupSteps(id);
    res.json(steps);
  });

  /**
   * GET /api/connectors/:id/status — get connector health status.
   *
   * Available to any authenticated user for health display, so the raw instance
   * config (which can include secrets such as a Hue bridge API key) must be
   * redacted the same way the list endpoint redacts it. Without this, a
   * `password`-typed field would leak to non-admins through the status payload.
   */
  router.get("/:id/status", (req, res) => {
    const id = req.params.id as string;
    const status = connectorManager.getStatus(id);

    if (!status) {
      res.status(404).json({ error: `Connector instance '${id}' not found` });
      return;
    }

    const mod = connectorRegistry.getModule(status.connectorType);
    const redactedConfig = redactPasswords(status.config, mod);
    res.json({ ...status, config: redactedConfig });
  });

  /** POST /api/connectors/:id/setup/:stepId — execute a setup step */
  router.post("/:id/setup/:stepId", requireAdmin, asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const stepId = req.params.stepId as string;
    const params = req.body ?? {};

    const result = await connectorManager.executeSetupStep(id, stepId, params);
    res.json(result);
  }));

  /** POST /api/connectors/:id/retry — retry connection */
  router.post("/:id/retry", requireAdmin, asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    await connectorManager.retry(id);
    res.json({ success: true });
  }));

  /** POST /api/connectors/:id/search-lights — start Zigbee light search (admin-only, like connector setup/management) */
  router.post("/:id/search-lights", requireAdmin, asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const status = connectorManager.getStatus(id);
    if (!status) {
      throw new NotFoundError(`Connector instance '${id}' not found`);
    }

    const connector = connectorManager.getConnectorInstance(id);
    if (!connector || !("searchForNewLights" in connector)) {
      throw new BadRequestError(
        `Connector '${id}' does not support light search`,
      );
    }

    const result = await (connector as { searchForNewLights: () => Promise<unknown> }).searchForNewLights();
    res.json(result);
  }));

  /** GET /api/connectors/:id/search-lights/status — get search progress (admin-only, like connector setup/management) */
  router.get("/:id/search-lights/status", requireAdmin, asyncHandler((req, res) => {
    const id = req.params.id as string;
    const status = connectorManager.getStatus(id);
    if (!status) {
      throw new NotFoundError(`Connector instance '${id}' not found`);
    }

    const connector = connectorManager.getConnectorInstance(id);
    if (!connector || !("getSearchStatus" in connector)) {
      throw new BadRequestError(
        `Connector '${id}' does not support light search`,
      );
    }

    const result = (connector as { getSearchStatus: () => unknown }).getSearchStatus();
    res.json(result);
  }));

  return router;
}

/** Password fields replaced with the mask, as every response must show them. */
function redactPasswords(
  config: Record<string, unknown>,
  mod: ReturnType<ConnectorRegistry["getModule"]>,
): Record<string, unknown> {
  return redactConfig(config, mod);
}

/** Required fields from the configSchema that are missing in the provided config. */
function getMissingRequiredFields(
  config: Record<string, unknown>,
  configSchema: import("../../connectors/connector.interface.js").ConnectorConfigSchema,
): string[] {
  return missingRequiredFields(config, configSchema);
}
