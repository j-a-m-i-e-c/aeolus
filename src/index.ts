// src/index.ts — Aeolus backend entry point

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "./config.js";
import logger from "./logger.js";
import { getDatabase, persistDatabase } from "./db/database.js";
import { eventBus, DEVICE_STATE_CHANGE, AUTOMATION_STATE_CHANGE, WS_STATE_CHANGE, MQTT_RAW_MESSAGE, AUTOMATION_FIRED, PANEL_STATE_CHANGE } from "./core/event-bus.js";
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
import { DeviceSimulator } from "./simulator/device-simulator.js";
import { createSimulatorRoutes } from "./api/routes/simulator.routes.js";
import { createSystemRoutes } from "./api/routes/system.routes.js";
import { createLayoutRoutes } from "./api/routes/layout.routes.js";
import { createPanelRoutes } from "./api/routes/panel.routes.js";
import { PanelStateStore } from "./panels/panel-state-store.js";
import { StateHistory } from "./core/state-history.js";


const startTime = Date.now();

async function main(): Promise<void> {
  logger.info("Starting Aeolus...");

  // 1. Database
  const db = await getDatabase();

  // 2. Device Registry
  const registry = new DeviceRegistry(db, eventBus);
  registry.loadFromDb();

  // 2b. State History
  const stateHistory = new StateHistory(db, config.stateHistoryMax, config.historyRecordInterval);

  // 3. MQTT Service
  const mqttService = new MqttService(
    { brokerUrl: config.mqttBrokerUrl, topics: config.mqttTopics },
    eventBus
  );

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
  conditionRegistry.registerCondition("value_above", (v) => (ctx) => Number((ctx.state as any).value) > Number(v));
  conditionRegistry.registerCondition("value_below", (v) => (ctx) => Number((ctx.state as any).value) < Number(v));
  conditionRegistry.registerCondition("equals", (v) => (ctx) => String((ctx.state as any).value) === v);

  // Wire registries into ConnectorManager so contributed handlers are registered on restore
  connectorManager.setRegistries(actionExecutor, conditionRegistry);
  await connectorManager.restoreFromStore();

  const executionLog = new ExecutionLog();
  const stateStore = new AutomationStateStore(db);
  stateStore.loadFromDb();
  const panelStateStore = new PanelStateStore(db);
  panelStateStore.loadFromDb();
  const sandbox = new Sandbox({ actionExecutor, deviceRegistry: registry, serviceManager, stateStore, onStateChange: (ruleId, key, value) => {
    eventBus.emit(AUTOMATION_STATE_CHANGE, { ruleId, key, value });
  } });
  const panelSandbox = new Sandbox({ actionExecutor, deviceRegistry: registry, serviceManager, stateStore: panelStateStore as any, onStateChange: (panelId, key, value) => {
    eventBus.emit(PANEL_STATE_CHANGE, { panelId, key, value });
  } });

  // 7. Automation Engine (with sandbox, action executor, and execution log)
  const engine = new AutomationEngine(eventBus, { sandbox, actionExecutor, executionLog });
  const automationsDir = path.resolve(process.cwd(), "automations");
  await engine.loadRulesFromDirectory(automationsDir);
  loadUiRules(engine, db, registry, actionExecutor, conditionRegistry);


  // 7. Wire MQTT events to device registry
  eventBus.on(DEVICE_STATE_CHANGE, (event) => {
    registry.upsert(event);
    stateHistory.record(event.deviceId, event.state, event.timestamp);
  });

  // 8. Simulator (always available, auto-starts if SIMULATOR=true)
  const simulatorConfigPath = path.resolve(process.cwd(), "data/simulator-devices.json");
  const simulator = new DeviceSimulator(eventBus, simulatorConfigPath);
  if (config.simulator) {
    simulator.start();
  }

  // 9. Connect MQTT (always attempt — works alongside simulator)
  try {
    await mqttService.connect();
  } catch (err) {
    logger.error({ error: (err as Error).message }, "MQTT connection failed — running without MQTT");
  }

  // 10. Express app
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  app.use("/api/devices", createDeviceRoutes(registry, connectorManager, stateHistory));
  app.use("/api/state", createStateRoutes(registry));
  app.use("/api/health", createHealthRoutes(mqttService, registry, engine, startTime));
  app.use("/api/mqtt", createMqttRoutes(mqttService));
  const sandboxTypesPath = path.resolve(import.meta.dirname, "automations/sandbox-types.d.ts");
  app.use("/api/automations", createAutomationRoutes(engine, db, registry, actionExecutor, executionLog, sandboxTypesPath, connectorRegistry, stateStore, conditionRegistry));
  app.use("/api/simulator", createSimulatorRoutes(simulator));
  app.use("/api/connectors", createConnectorRoutes(connectorManager, connectorRegistry));
  app.use("/api/services", createServiceRoutes(serviceManager, serviceRegistry));
  app.use("/api/system", createSystemRoutes());
  app.use("/api/layout", createLayoutRoutes(db));
  app.use("/api/panels", createPanelRoutes(db, panelStateStore, eventBus, panelSandbox));

  app.use(errorHandler);


  // 11. HTTP + WebSocket server
  const server = createServer(app);

  const WS_MAPPINGS: WsEventMapping[] = [
    { eventName: WS_STATE_CHANGE, messageType: "state-change" },
    { eventName: MQTT_RAW_MESSAGE, messageType: "mqtt-message" },
    { eventName: AUTOMATION_FIRED, messageType: "automation-fired" },
    { eventName: AUTOMATION_STATE_CHANGE, messageType: "automation-state" },
    { eventName: PANEL_STATE_CHANGE, messageType: "panel-state" },
  ];

  const wsServer = new WsServer(server, registry, eventBus, WS_MAPPINGS);

  server.listen(config.port, () => {
    logger.info(
      { port: config.port, mqtt: mqttService.isConnected() ? "connected" : "disconnected" },
      `Aeolus running on port ${config.port}`
    );
  });

  // 12. Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down Aeolus...");
    simulator.stop();
    await serviceManager.disposeAll();
    await connectorManager.disposeAll();
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
