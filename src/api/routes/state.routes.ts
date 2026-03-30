// src/api/routes/state.routes.ts — Aggregated state endpoint

import { Router } from "express";
import type { DeviceRegistry } from "../../core/device-registry.js";

export function createStateRoutes(registry: DeviceRegistry): Router {
  const router = Router();

  /** GET /api/state — all devices keyed by ID */
  router.get("/", (_req, res) => {
    const devices = registry.getAll();
    const state: Record<string, unknown> = {};
    for (const device of devices) {
      state[device.id] = device;
    }
    res.json(state);
  });

  return router;
}