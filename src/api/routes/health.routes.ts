// src/api/routes/health.routes.ts — System health endpoint

import { Router } from "express";
import type { MqttService } from "../../mqtt/mqtt-service.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { AutomationEngine } from "../../automations/automation-engine.js";
import type { HealthStatus } from "../../core/types.js";

export function createHealthRoutes(
  mqttService: MqttService,
  registry: DeviceRegistry,
  engine: AutomationEngine,
  startTime: number
): Router {
  const router = Router();

  /** GET /api/health — system health status */
  router.get("/", (_req, res) => {
    const status: HealthStatus = {
      mqtt: mqttService.isConnected() ? "connected" : "disconnected",
      deviceCount: registry.size,
      ruleCount: engine.ruleCount,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
    res.json(status);
  });

  return router;
}