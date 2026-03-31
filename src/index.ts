// src/index.ts — Aeolus backend entry point

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "./config.js";
import logger from "./logger.js";
import { getDatabase, persistDatabase } from "./db/database.js";
import { eventBus, DEVICE_STATE_CHANGE } from "./core/event-bus.js";
import { DeviceRegistry } from "./core/device-registry.js";
import { MqttService } from "./mqtt/mqtt-service.js";
import { AutomationEngine } from "./automations/automation-engine.js";
import { IntegrationManager } from "./integrations/integration-manager.js";
import { HueIntegration } from "./integrations/hue/hue-integration.js";
import { WsServer } from "./websocket/ws-server.js";
import { createDeviceRoutes } from "./api/routes/device.routes.js";
import { createStateRoutes } from "./api/routes/state.routes.js";
import { createHealthRoutes } from "./api/routes/health.routes.js";
import { createMqttRoutes } from "./api/routes/mqtt.routes.js";
import { createAutomationRoutes } from "./api/routes/automation.routes.js";
import { requestLogger } from "./api/middleware/request-logger.js";
import { errorHandler } from "./api/middleware/error-handler.js";
import { DeviceSimulator } from "./simulator/device-simulator.js";
import { createSimulatorRoutes } from "./api/routes/simulator.routes.js";

const startTime = Date.now();

async function main(): Promise<void> {
  logger.info("Starting Aeolus...");

  // 1. Database
  const db = await getDatabase();

  // 2. Device Registry
  const registry = new DeviceRegistry(db, eventBus);
  registry.loadFromDb();

  // 3. MQTT Service
  const mqttService = new MqttService(
    { brokerUrl: config.mqttBrokerUrl, topics: config.mqttTopics },
    eventBus
  );

  // 4. Automation Engine
  const engine = new AutomationEngine(eventBus);
  const automationsDir = path.resolve(process.cwd(), "automations");
  await engine.loadRulesFromDirectory(automationsDir);

  // 5. Integration Manager
  const integrationManager = new IntegrationManager(registry);

  if (config.hueBridgeIp && config.hueApiKey) {
    const hue = new HueIntegration({
      bridgeIp: config.hueBridgeIp,
      apiKey: config.hueApiKey,
    });
    integrationManager.register(hue);
  }

  await integrationManager.connectAll();
  await integrationManager.discoverAll();

  // 6. Wire MQTT events to device registry
  eventBus.on(DEVICE_STATE_CHANGE, (event) => {
    registry.upsert(event);
  });

  // 7. Simulator (always available, auto-starts if SIMULATOR=true)
  const simulator = new DeviceSimulator(eventBus);

  if (config.simulator) {
    simulator.start();
  }

  // 8. Connect MQTT (skip if simulator is running)
  if (!config.simulator) {
    try {
      await mqttService.connect();
    } catch (err) {
      logger.error({ error: (err as Error).message }, "MQTT connection failed — running without MQTT");
    }
  }

  // 8. Express app
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  // Routes
  app.use("/api/devices", createDeviceRoutes(registry, integrationManager));
  app.use("/api/state", createStateRoutes(registry));
  app.use("/api/health", createHealthRoutes(mqttService, registry, engine, startTime));
  app.use("/api/mqtt", createMqttRoutes(mqttService));
  app.use("/api/automations", createAutomationRoutes(engine));
  app.use("/api/simulator", createSimulatorRoutes(simulator));

  // Error handler (must be last)
  app.use(errorHandler);

  // 9. HTTP + WebSocket server
  const server = createServer(app);
  const wsServer = new WsServer(server, registry, eventBus);

  server.listen(config.port, () => {
    logger.info(
      { port: config.port, mqtt: mqttService.isConnected() ? "connected" : "disconnected" },
      `Aeolus running on port ${config.port}`
    );
  });

  // 10. Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down Aeolus...");
    simulator.stop();
    await integrationManager.disposeAll();
    await mqttService.disconnect();
    persistDatabase();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error(err, "Fatal error during startup");
  process.exit(1);
});