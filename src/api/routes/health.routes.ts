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
  startTime: number,
  /** From AEOLUS_E2E only; adds `e2e: true` so the E2E suite can recognise a disposable install. */
  options: { e2eDisposable?: boolean } = {},
): Router {
  const router = Router();

  /** GET /api/health — system health status */
  router.get("/", (_req, res) => {
    const status: HealthStatus = {
      mqtt: mqttService.isConnected() ? "connected" : "disconnected",
      deviceCount: registry.size,
      ruleCount: engine.ruleCount,
      executionGate: engine.gateStats,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      ...(options.e2eDisposable ? { e2e: true as const } : {}),
    };
    res.json(status);
  });

  return router;
}