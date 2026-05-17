// src/index.ts — Aeolus backend entry point

import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "./config.js";
import logger from "./logger.js";
import { getDatabase, closeDatabase } from "./db/database.js";
import { eventBus, DEVICE_STATE_CHANGE, AUTOMATION_STATE_CHANGE, WS_STATE_CHANGE, MQTT_RAW_MESSAGE, AUTOMATION_FIRED, DATA_STORE_WRITE, DATA_STORE_COLLECTION_DELETED } from "./core/event-bus.js";
import { DeviceRegistry } from "./core/device-registry.js";
import { MqttService } from "./mqtt/mqtt-service.js";
import { AutomationEngine } from "./automations/automation-engine.js";
import { ConnectorRegistry } from "./connectors/connector-registry.js";
import { ConnectorManager } from "./connectors/connector-manager.js";
import { ConnectorStore } from "./connectors/connector-store.js";
import * as hueModule from "./connectors/hue/index.js";
import * as kasaModule from "./connectors/kasa/index.js";
import { migrateLegacyHueCredentials } from "./connectors/migrate-legacy-hue.js";
import { ActionExecutor, handlePublish, handleToggle, handleDeviceAction, handleLog, handleDelay, handleWebhook } from "./automations/action-executor.js";
import { ConditionRegistry } from "./automations/condition-registry.js";
import { ExecutionLog } from "./automations/execution-log.js";
import { Sandbox } from "./automations/sandbox.js";
import { AutomationStateStore } from "./automations/automation-state-store.js";
import { WsServer } from "./websocket/ws-server.js";
import type { WsEventMapping } from "./websocket/ws-server.js";
import { createDeviceRoutes } from "./api/routes/device.routes.js";
import { createStateRoutes } from "./api/routes/state.routes.js";
import { createHealthRoutes } from "./api/routes/health.routes.js";
import { createMqttRoutes } from "./api/routes/mqtt.routes.js";
import { createAutomationRoutes, loadUiRules } from "./api/routes/automation.routes.js";
import { createConnectorRoutes } from "./api/routes/connector.routes.js";
import { createServiceRoutes } from "./api/routes/service.routes.js";
import { ServiceRegistry } from "./services/service-registry.js";
import { ServiceStore } from "./services/service-store.js";
import { ServiceManager } from "./services/service-manager.js";
import cronModule from "./services/cron/index.js";
import triggerModule from "./services/trigger/index.js";
import systemModule from "./services/system/index.js";
import { requestLogger } from "./api/middleware/request-logger.js";
import { errorHandler } from "./api/middleware/error-handler.js";
import { corsMiddleware } from "./api/middleware/cors-config.js";
import { apiRateLimiter } from "./api/middleware/rate-limiter.js";
import { authenticate } from "./auth/auth-middleware.js";
import { createAuthRoutes } from "./api/routes/auth.routes.js";
import { ensureBackendCredential } from "./auth/mqtt-credential-service.js";

import { createSystemRoutes } from "./api/routes/system.routes.js";
import { createLayoutRoutes } from "./api/routes/layout.routes.js";
import { createDataStoreRoutes } from "./api/routes/data-store.routes.js";
import { createProvisioningRoutes } from "./api/routes/provisioning.routes.js";
import { StateHistory } from "./core/state-history.js";
import { DataStore } from "./data-store/data-store.js";
import { MosquittoConfigWriter } from "./mqtt/mosquitto-config-writer.js";
import { MosquittoReloader } from "./mqtt/mosquitto-reloader.js";
import { MqttProvisioningService } from "./mqtt/mqtt-provisioning-service.js";
import { metricsService } from "./metrics/metrics-service.js";
import { metricsMiddleware } from "./metrics/metrics-middleware.js";
import { createPrometheusMetricsRoute, createMetricsSummaryRoute } from "./api/routes/metrics.routes.js";


const startTime = Date.now();

async function main(): Promise<void> {
  logger.info("Starting Aeolus...");

  // 1. Database
  const db = getDatabase();

  // 2. Device Registry
  const registry = new DeviceRegistry(db, eventBus);
  registry.loadFromDb();

  // 2b. State History
  const stateHistory = new StateHistory(db, config.stateHistoryMax, config.historyRecordInterval);

  // 2c. Ensure backend MQTT credential exists (for future use when anonymous is disabled)
  await ensureBackendCredential();

  // 3. MQTT Service
  const mqttService = new MqttService(
    { brokerUrl: config.mqttBrokerUrl, topics: config.mqttTopics },
    eventBus
  );

  // 3b. MQTT Provisioning Service
  const projectDir = process.env.AEOLUS_PROJECT_DIR || process.cwd();
  const configWriter = new MosquittoConfigWriter({
    configPath: path.resolve(projectDir, "mosquitto", "mosquitto.conf"),
  });
  const reloader = new MosquittoReloader();
  const provisioningService = new MqttProvisioningService(mqttService, configWriter, reloader);
  await provisioningService.initialize();

  // 4. Connector Framework (needed before ActionExecutor)
  const connectorStore = new ConnectorStore(db);
  const connectorRegistry = new ConnectorRegistry();
  const connectorManager = new ConnectorManager(connectorRegistry, connectorStore, registry, eventBus);

  connectorRegistry.register(hueModule);
  connectorRegistry.register(kasaModule);

  migrateLegacyHueCredentials(connectorStore);

  // 5. Services Framework
  const serviceStore = new ServiceStore(db);
  const serviceRegistry = new ServiceRegistry();
  const serviceManager = new ServiceManager(serviceRegistry, serviceStore, eventBus);

  serviceRegistry.register(cronModule);
  serviceRegistry.register(triggerModule);
  serviceRegistry.register(systemModule);

  await serviceManager.restoreFromStore();

  // Auto-enable built-in services if not already enabled
  const enabledServices = serviceManager.listEnabled();
  const enabledTypes = new Set(enabledServices.map(s => s.serviceType));
  if (!enabledTypes.has("system")) await serviceManager.enable("system", {});
  if (!enabledTypes.has("trigger")) await serviceManager.enable("trigger", {});
  if (!enabledTypes.has("cron")) await serviceManager.enable("cron", { schedules: [] });

  // 6. Action Executor, Execution Log, and Sandbox
  const actionExecutor = new ActionExecutor({
    mqttService,
    connectorManager,
    logger,
  });

  // Register built-in action handlers
  actionExecutor.registerHandler("publish", handlePublish);
  actionExecutor.registerHandler("toggle", handleToggle);
  actionExecutor.registerHandler("device_action", handleDeviceAction);
  actionExecutor.registerHandler("log", handleLog);
  actionExecutor.registerHandler("delay", handleDelay);
  actionExecutor.registerHandler("webhook", handleWebhook);

  // Condition Registry — register built-in condition factories
  const conditionRegistry = new ConditionRegistry();
  conditionRegistry.registerCondition("value_above", (v) => (context) => Number((context.state as Record<string, unknown>).value) > Number(v));
  conditionRegistry.registerCondition("value_below", (v) => (context) => Number((context.state as Record<string, unknown>).value) < Number(v));
  conditionRegistry.registerCondition("equals", (v) => (context) => String((context.state as Record<string, unknown>).value) === v);

  // Wire registries into ConnectorManager so contributed handlers are registered on restore
  connectorManager.setRegistries(actionExecutor, conditionRegistry);
  await connectorManager.restoreFromStore();

  const executionLog = new ExecutionLog();
  const stateStore = new AutomationStateStore(db);
  stateStore.loadFromDb();

  // 6b. Data Store
  const dataStore = new DataStore(db, eventBus);
  if (dataStore.isEnabled()) {
    dataStore.startRetentionTimer();
  }

  const sandbox = new Sandbox({ actionExecutor, deviceRegistry: registry, serviceManager, stateStore, dataStore, onStateChange: (ruleId, key, value) => {
    eventBus.emit(AUTOMATION_STATE_CHANGE, { ruleId, key, value });
  } });

  // 7. Automation Engine (with sandbox, action executor, and execution log)
  const engine = new AutomationEngine(eventBus, { sandbox, actionExecutor, executionLog });
  const automationsDir = path.resolve(process.cwd(), "automations");
  await engine.loadRulesFromDirectory(automationsDir);
  loadUiRules(engine, db, registry, actionExecutor, conditionRegistry);


  // 7b. Initialize MetricsService
  metricsService.initialize({
    eventBus,
    getDeviceCount: () => registry.getAll().length,
    getRuleCount: () => engine.ruleCount,
  });

  // 7c. Wire MQTT events to device registry
  eventBus.on(DEVICE_STATE_CHANGE, (event) => {
    registry.upsert(event);
    stateHistory.record(event.deviceId, event.state, event.timestamp);
  });

  // 8. Connect MQTT
  try {
    await mqttService.connect();
  } catch (err) {
    logger.error({ error: (err as Error).message }, "MQTT connection failed — running without MQTT");
  }

  // 9. Express app
  const app = express();

  // Prometheus metrics endpoint — BEFORE authenticate (uses its own bearer token auth)
  app.use(createPrometheusMetricsRoute(metricsService));

  app.use(corsMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestLogger);

  // HTTP metrics middleware — records request duration for all subsequent routes
  app.use(metricsMiddleware());

  app.use(authenticate);

  app.use("/api/auth", createAuthRoutes());
  app.use("/api/devices", createDeviceRoutes(registry, connectorManager, stateHistory));
  app.use("/api/state", createStateRoutes(registry));
  app.use("/api/health", createHealthRoutes(mqttService, registry, engine, startTime));
  app.use("/api/mqtt", createMqttRoutes(mqttService));
  app.use("/api/mqtt/provisioning", createProvisioningRoutes(provisioningService));
  const sandboxTypesPath = path.resolve(import.meta.dirname, "automations/sandbox-types.d.ts");
  app.use("/api/automations", createAutomationRoutes(engine, db, registry, actionExecutor, executionLog, sandboxTypesPath, connectorRegistry, stateStore, conditionRegistry));
  app.use("/api/connectors", createConnectorRoutes(connectorManager, connectorRegistry));
  app.use("/api/services", createServiceRoutes(serviceManager, serviceRegistry));
  app.use("/api/metrics", createMetricsSummaryRoute(metricsService));
  app.use("/api/system", createSystemRoutes());
  app.use("/api/layout", createLayoutRoutes(db));
  app.use("/api/data-store", createDataStoreRoutes(dataStore));

  app.use(errorHandler);


  // 10. HTTP + WebSocket server
  const server = createServer(app);

  const WS_MAPPINGS: WsEventMapping[] = [
    { eventName: WS_STATE_CHANGE, messageType: "state-change" },
    { eventName: MQTT_RAW_MESSAGE, messageType: "mqtt-message" },
    { eventName: AUTOMATION_FIRED, messageType: "automation-fired" },
    { eventName: AUTOMATION_STATE_CHANGE, messageType: "automation-state" },
    { eventName: DATA_STORE_WRITE, messageType: "data-store-write" },
    { eventName: DATA_STORE_COLLECTION_DELETED, messageType: "data-store-collection-deleted" },
  ];

  const wsServer = new WsServer(server, registry, eventBus, WS_MAPPINGS);

  server.listen(config.port, () => {
    logger.info(
      { port: config.port, mqtt: mqttService.isConnected() ? "connected" : "disconnected" },
      `Aeolus running on port ${config.port}`
    );
  });

  // 11. Graceful shutdown
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Shutting down Aeolus...");

    // Force exit after 5 seconds if cleanup hangs
    const forceExitTimeout = setTimeout(() => {
      logger.warn("Shutdown timeout reached (5s), forcing exit");
      process.exit(0);
    }, 5000);
    forceExitTimeout.unref();

    try {
      // 1. Stop accepting new HTTP connections
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      // 2. Close WebSocket connections (send close frames)
      wsServer.closeAll();

      // 3. Stop all active timers (retention timers, polling intervals, cron schedules)
      dataStore.dispose();
      await serviceManager.disposeAll();
      await connectorManager.disposeAll();

      // 4. Stop automation engine (cron timers)
      engine.dispose();

      // 4b. Dispose MetricsService
      metricsService.dispose();

      // 5. Disconnect MQTT cleanly
      await mqttService.disconnect();

      // 6. Close database connection
      closeDatabase();
    } catch (err) {
      logger.error({ error: (err as Error).message }, "Error during shutdown cleanup");
    } finally {
      clearTimeout(forceExitTimeout);
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error(err, "Fatal error during startup");
  process.exit(1);
});
