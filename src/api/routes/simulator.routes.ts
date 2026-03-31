// src/api/routes/simulator.routes.ts — Simulator control endpoints

import { Router } from "express";
import type { DeviceSimulator } from "../../simulator/device-simulator.js";
import logger from "../../logger.js";

export function createSimulatorRoutes(simulator: DeviceSimulator): Router {
  const router = Router();

  /** GET /api/simulator — get simulator status */
  router.get("/", (_req, res) => {
    res.json({ running: simulator.isRunning() });
  });

  /** POST /api/simulator/start — start the simulator */
  router.post("/start", (_req, res) => {
    simulator.start();
    logger.info("Simulator started via API");
    res.json({ running: true });
  });

  /** POST /api/simulator/stop — stop the simulator */
  router.post("/stop", (_req, res) => {
    simulator.stop();
    logger.info("Simulator stopped via API");
    res.json({ running: false });
  });

  return router;
}
