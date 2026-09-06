// src/index.ts — Aeolus backend entry point

import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "./config.js";
import logger from "./logger.js";
import { getDatabase, closeDatabase } from "./db/database.js";
import { eventBus, DEVICE_STATE_CHANGE, AUTOMATION_STATE_CHANGE, WS_STATE_CHANGE, MQTT_RAW_MESSAGE, AUTOMATION_FIRED, AUTOMATION_COMPLETED, DATA_STORE_WRITE, DATA_STORE_COLLECTION_DELETED, COMMAND_LIFECYCLE_TRANSITION, AUTOMATION_EVENT } from "./core/event-bus.js";
import { DeviceRegistry } from "./core/device-registry.js";
import { MqttService } from "./mqtt/mqtt-service.js";
import { createPrivateTopicStore } from "./mqtt/private-topic-store.js";
import { AutomationEngine } from "./automations/automation-engine.js";
import { ConnectorRegistry } from "./connectors/connector-registry.js";
import { ConnectorManager } from "./connectors/connector-manager.js";
import { ConnectorStore } from "./connectors/connector-store.js";
import * as hueModule from "./connectors/hue/index.js";
import * as kasaModule from "./connectors/kasa/index.js";
import { migrateLegacyHueCredentials } from "./connectors/migrate-legacy-hue.js";
import { CommandService, handlePublish, handleToggle, handleDeviceAction, handleLog, handleDelay, handleWebhook } from "./automations/command-service.js";
import { ConditionRegistry } from "./automations/condition-registry.js";
import { ExecutionLog } from "./automations/execution-log.js";
import { ExecutionRecorder } from "./automations/execution-recorder.js";
import { CommandResultCollector } from "./automations/command-result-collector.js";
import { PendingCommandTracker } from "./automations/pending-command-tracker.js";
import { CommandHistoryStore } from "./automations/command-history-store.js";
import { buildCommandEvidence, describeRung } from "./automations/command-lifecycle.js";
import { currentExecutionContext } from "./automations/execution-context.js";
import { AutomationEventService } from "./automations/automation-event-service.js";
import { Sandbox } from "./automations/sandbox.js";
import { AutomationStateStore } from "./automations/automation-state-store.js";
import { WsServer } from "./websocket/ws-server.js";
import type { WsEventMapping, BroadcastEnvelope } from "./websocket/ws-server.js";
import { createDeviceRoutes } from "./api/routes/device.routes.js";
import { createCommandRoutes } from "./api/routes/command.routes.js";
import { createStateRoutes } from "./api/routes/state.routes.js";
import { createHealthRoutes } from "./api/routes/health.routes.js";
import { createMqttRoutes } from "./api/routes/mqtt.routes.js";
import { createAutomationRoutes, loadUiRules, automationExists } from "./api/routes/automation.routes.js";
import { createConnectorRoutes } from "./api/routes/connector.routes.js";
import { createResourceOwnershipStore } from "./auth/resource-ownership-store.js";
import { createCollectionOwnershipStore } from "./auth/collection-ownership-store.js";
import { createDataStoreVisibility } from "./websocket/data-store-visibility.js";
import { createDeviceExposureResolver } from "./auth/device-exposure-resolver.js";
import { createAutomationScopeResolver } from "./automations/automation-scope-resolver.js";
import { createPermissionResolver } from "./auth/permission-resolver.js";
import { requireDevicePermission, requireAutomationPermission } from "./auth/auth-middleware.js";
import type { PermissionLevel } from "./auth/permission-service.js";

import { requestLogger } from "./api/middleware/request-logger.js";
import { errorHandler } from "./api/middleware/error-handler.js";
import { corsMiddleware } from "./api/middleware/cors-config.js";
import { apiRateLimiter } from "./api/middleware/rate-limiter.js";
import { authenticate } from "./auth/auth-middleware.js";
import { createPublicDemoGuard } from "./demo/public-demo-guard.js";
import { createDemoScrubMiddleware } from "./demo/demo-scrub.js";
import { createDemoRuleAccessReader } from "./demo/demo-rule-access.js";
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
import { BrokerVerifier } from "./mqtt/broker-verifier.js";
import { MqttProvisioningService } from "./mqtt/mqtt-provisioning-service.js";
import { metricsService } from "./metrics/metrics-service.js";
import { metricsMiddleware } from "./metrics/metrics-middleware.js";
import { createPrometheusMetricsRoute, createMetricsSummaryRoute } from "./api/routes/metrics.routes.js";
import { MetricsHistoryService } from "./metrics/metrics-history-service.js";


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
  // Single source for the acknowledgement response-topic space. The raw-publish
  // policy derives its reserved system prefix from this same value so the denied
  // namespace cannot drift from the forged-ack surface the ingestion path trusts.
  const ackTopicFilter = "aeolus/acks/#";

  // Durable command history (phase-1). Sole owner of command_records /
  // command_transitions. The tracker below stays DB-free and reports transitions
  // through the composition adapter, which owns the store write.
  const commandHistoryStore = new CommandHistoryStore(db, (event) => {
    // Forwarded only after the durable write commits (Req 7.5); the WS server
    // maps it to the "command-lifecycle" client message.
    eventBus.emit(COMMAND_LIFECYCLE_TRANSITION, event);
  });

  // Restart reconciliation: a command still non-terminal in durable history
  // cannot have a live in-memory tracker entry after a restart. Mark such
  // records terminally FAILED/interrupted — never replay a physical command.
  // Runs after migrations (already applied by getDatabase) and before serving.
  // Idempotent across repeated startups.
  const reconciledInterrupted = commandHistoryStore.reconcileInterrupted(Date.now());
  if (reconciledInterrupted > 0) {
    logger.warn(
      { reconciledInterrupted },
      "Reconciled interrupted commands from a prior run (no physical replay)",
    );
  }

  // Per-execution Command_Result sink; also the source of the active execution
  // context that stamps command provenance. Created early so CommandService can
  // read it through the narrow ExecutionContextProvider boundary (design §2.3).
  const collector = new CommandResultCollector();

  // Tracker correlates MQTT acknowledgements/observations back to dispatched
  // commands; injected into both the CommandService (register) and the MQTT
  // ingestion path (route/observeState). Its intermediate ACKNOWLEDGED milestone
  // is persisted via this composition adapter (the tracker never touches SQLite).
  const pendingCommandTracker = new PendingCommandTracker({
    onTransition: (ev) => {
      if (!ev.commandId) return;
      try {
        // An ack proves the device received the command, so if the durable
        // record is still at REQUESTED (the ack raced ahead of the CommandService
        // DISPATCHED write), record the implied DISPATCHED first so ACKNOWLEDGED
        // is a valid transition regardless of ordering (Req 3.5). The store's
        // idempotency guard drops any duplicate DISPATCHED written later.
        if (commandHistoryStore.currentState(ev.commandId) === "REQUESTED") {
          commandHistoryStore.transition({
            commandId: ev.commandId,
            toState: "DISPATCHED",
            timestamp: ev.timestamp,
            terminal: false,
            details: buildCommandEvidence({
              reason: "Inferred from the device's reply, which arrived before the dispatch was recorded",
            }),
          });
        }
        commandHistoryStore.transition({
          commandId: ev.commandId,
          toState: ev.toState,
          timestamp: ev.timestamp,
          terminal: false,
          details: buildCommandEvidence({ reason: describeRung(ev.toState) }),
        });
      } catch (err) {
        logger.error(
          { commandId: ev.commandId, error: (err as Error).message },
          "Failed to persist intermediate command transition",
        );
      }
    },
  });

  const mqttService = new MqttService(
    {
      brokerUrl: config.mqttBrokerUrl,
      topics: config.mqttTopics,
      ackTopicFilter,
      discoveryIgnoredTopicSuffixes: config.mqttDiscoveryIgnoredTopicSuffixes,
      // Reserved Automation Event namespace (phase-1 Req 6.1, 6.7). Ingested as
      // versioned envelopes, never device discovery.
      automationEventTopicFilter: "aeolus/events/#",
    },
    eventBus,
    { deviceRegistry: registry, ackRouter: pendingCommandTracker },
  );

  // 3b. MQTT Provisioning Service
  // In a shared-volume deployment the broker config lives on a volume mounted
  // into both the backend and the broker at the same path; MQTT_CONFIG_FILE
  // points the writer at it (and MQTT_PASSWORD_FILE at the shared password file).
  const projectDir = process.env.AEOLUS_PROJECT_DIR || process.cwd();
  const configWriter = new MosquittoConfigWriter({
    configPath:
      process.env.MQTT_CONFIG_FILE || path.resolve(projectDir, "mosquitto", "mosquitto.conf"),
  });
  const reloader = new MosquittoReloader();
  const brokerVerifier = new BrokerVerifier({
    brokerUrl: config.mqttBrokerUrl,
    budgetMs: config.mqttProvisioningVerify.budgetMs,
    pollIntervalMs: config.mqttProvisioningVerify.pollIntervalMs,
    connectTimeoutMs: config.mqttProvisioningVerify.connectTimeoutMs,
  });
  const provisioningService = new MqttProvisioningService(mqttService, configWriter, reloader, {
    verifier: brokerVerifier,
    enabled: config.managedMqttProvisioningEnabled,
  });
  if (config.managedMqttProvisioningEnabled) {
    await provisioningService.initialize();
  } else {
    logger.info("Dashboard-managed MQTT security is disabled while under development");
  }

  // 4. Connector Framework (needed before CommandService)
  const connectorStore = new ConnectorStore(db);
  const connectorRegistry = new ConnectorRegistry();
  const connectorManager = new ConnectorManager(connectorRegistry, connectorStore, registry, eventBus);

  connectorRegistry.register(hueModule);
  connectorRegistry.register(kasaModule);

  migrateLegacyHueCredentials(connectorStore);

  // Automation authorization scope. Resolves each automation's runtime authority
  // (unrestricted for admin-authored rules; scoped to the owning tab's devices
  // and collections for non-admin-authored rules). Shared by the CommandService
  // (dispatch enforcement) and the Sandbox (device/Data Store injection). The
  // device-exposure resolver and collection-ownership store are also reused by
  // the resource-level authorization wiring below.
  const collectionOwnershipStore = createCollectionOwnershipStore();
  const deviceExposureResolver = createDeviceExposureResolver(registry);
  const automationScopeResolver = createAutomationScopeResolver(
    deviceExposureResolver,
    collectionOwnershipStore,
  );

  // 5. Command Service, Execution Log, and Sandbox
  const commandService = new CommandService({
    mqttService,
    connectorManager,
    logger,
    deviceRegistry: registry,
    pendingCommandTracker,
    scopeResolver: automationScopeResolver,
    commandHistoryStore,
    // Narrow, read-only view of the active automation execution (design §2.3).
    // Reads the execution-context ALS set by the AutomationEngine; commands
    // outside an automation see undefined. CommandService never couples to the
    // automation runtime.
    executionContext: { current: () => currentExecutionContext() },
  });

  // Register built-in action handlers
  commandService.registerHandler("publish", handlePublish);
  commandService.registerHandler("toggle", handleToggle);
  commandService.registerHandler("device_action", handleDeviceAction);
  commandService.registerHandler("log", handleLog);
  commandService.registerHandler("delay", handleDelay);
  commandService.registerHandler("webhook", handleWebhook);

  // Condition Registry — register built-in condition factories
  const conditionRegistry = new ConditionRegistry();
  conditionRegistry.registerCondition("value_above", (v) => (context) => Number((context.state as Record<string, unknown>).value) > Number(v));
  conditionRegistry.registerCondition("value_below", (v) => (context) => Number((context.state as Record<string, unknown>).value) < Number(v));
  conditionRegistry.registerCondition("equals", (v) => (context) => String((context.state as Record<string, unknown>).value) === v);

  // Wire registries into ConnectorManager so contributed handlers are registered on restore
  connectorManager.setRegistries(commandService, conditionRegistry);
  // Wire the live MqttService into ConnectorManager so ActionRouter can publish MQTT
  // device commands. Without this, generic MQTT device dispatch reports "broker not
  // connected" even while mqttService is connected (pre-promotion-release-gates gate 3).
  connectorManager.setMqttService(mqttService);
  await connectorManager.restoreFromStore();

  const executionLog = new ExecutionLog(200, db);

  // Retention timer: prune execution history entries older than 7 days, once daily
  const executionRetentionTimer = setInterval(() => {
    try {
      executionLog.enforceRetention(7);
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "Execution history retention enforcement failed",
      );
    }
  }, 24 * 60 * 60 * 1000);
  executionRetentionTimer.unref();

  const stateStore = new AutomationStateStore(db);
  stateStore.loadFromDb();

  // 6b. Data Store
  const dataStore = new DataStore(db, eventBus);
  if (dataStore.isEnabled()) {
    dataStore.startRetentionTimer();
  }

  // 7. Automation Engine (with sandbox, command service, collector, and the
  // single Execution_Owner that records history/metrics/completion/audit).
  // `collector` is created earlier (it also backs the execution-context provider).

  // Safe automation-to-automation event emitter over the reserved MQTT namespace
  // (phase-1 Req 6). Publishes only inside aeolus/events/<ruleId>/...; never a
  // Verified Command.
  const automationEventService = new AutomationEventService({ mqttService, logger });

  const sandbox = new Sandbox({ commandService, deviceRegistry: registry, stateStore, dataStore, collector, scopeResolver: automationScopeResolver, automationEventService, commandHistoryStore, onStateChange: (ruleId, key, value) => {
    eventBus.emit(AUTOMATION_STATE_CHANGE, { ruleId, key, value });
  } });

  const executionRecorder = new ExecutionRecorder({ eventBus, executionLog, logger });
  const engine = new AutomationEngine(eventBus, {
    sandbox,
    commandService: commandService,
    scopeResolver: automationScopeResolver,
    executionRecorder,
    collector,
  });
  loadUiRules(engine, db, registry, commandService, conditionRegistry);


  // 7b. Initialize MetricsService
  metricsService.initialize({
    eventBus,
    getDeviceCount: () => registry.getAll().length,
    getRuleCount: () => engine.ruleCount,
  });

  // 7c. Initialize MetricsHistoryService (after DataStore and MetricsService)
  const metricsHistoryService = new MetricsHistoryService({
    dataStore,
    registry: metricsService.getRegistry(),
    logger,
  });
  metricsHistoryService.start();

  // 7d. Wire MQTT events to device registry
  eventBus.on(DEVICE_STATE_CHANGE, (event) => {
    const device = registry.upsert(event);
    stateHistory.record(device.id, event.state, event.timestamp);
  });

  // 8. Connect MQTT — never blocks startup. If the broker is unavailable at boot
  // (a common Compose/boot race), the service enters a background reconnection
  // loop and recovers automatically once the broker is reachable, rather than
  // leaving a healthy-looking backend permanently MQTT-disconnected.
  await mqttService.connectWithRetry();

  // 9. Express app
  const app = express();
  app.disable("x-powered-by"); // Don't advertise the framework

  // The hosted public demo is reachable only through the adjacent Cloudflare
  // Tunnel container. Trust exactly that single proxy hop so Express rate
  // limiters key public-demo visitors by their forwarded client IP instead of
  // collapsing every visitor onto the cloudflared container address. Normal
  // Aeolus installs keep Express' default (trust proxy disabled).
  if (config.publicDemo.enabled) {
    app.set("trust proxy", 1);
  }

  // Prometheus metrics endpoint — BEFORE authenticate (uses its own bearer token auth)
  app.use(createPrometheusMetricsRoute(metricsService));

  app.use(corsMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestLogger);

  // Global API rate limiter (per-IP). The login route adds its own stricter limiter.
  app.use(apiRateLimiter);

  // HTTP metrics middleware — records request duration for all subsequent routes
  app.use(metricsMiddleware());

  app.use(authenticate);

  // Public demo capability envelope (public-demo-mode spec). Inert unless
  // AEOLUS_PUBLIC_DEMO is on AND the session is a public-demo token. Placed after
  // `authenticate` and before all route mounts so an allowlisted demo request
  // still passes through its route's normal resource authorization — the guard
  // is strictly additive and can only further restrict.
  app.use(
    createPublicDemoGuard({
      getDemoRuleAccess: createDemoRuleAccessReader(db),
      stateStore,
    }),
  );

  // Response-masking for public-demo sessions. Demo sessions are granted
  // read-only visibility into admin surfaces (guard allowlist +
  // requireAdmin relaxation); this masks sensitive fields (host/network
  // identifiers, credentials, usernames, log contents) before the response is
  // serialised. Inert for every non-demo session. Mounted directly after the
  // guard so it wraps `res.json` before any route handler runs.
  app.use(createDemoScrubMiddleware());

  // Resource-level authorization wiring. A single ownership store (automations),
  // a live device-exposure resolver, and a permission resolver that routes
  // exposing-tab resolution by resource kind. The middleware factories are built
  // once with the shared resolver and the appropriate server-side existence
  // predicate so route files stay declarative.
  const ownershipStore = createResourceOwnershipStore();
  // `collectionOwnershipStore` and `deviceExposureResolver` are created earlier
  // (they also back the automation scope resolver) and reused here.
  const permissionResolver = createPermissionResolver(ownershipStore, deviceExposureResolver);
  // Admin-managed private MQTT topic filters — gate the public raw-MQTT feed.
  const privateTopicStore = createPrivateTopicStore();
  const requireDevice = (level: PermissionLevel) =>
    requireDevicePermission(level, {
      resolver: permissionResolver,
      exists: (id) => registry.getById(id) !== undefined,
    });
  const requireAutomation = (level: PermissionLevel) =>
    requireAutomationPermission(level, {
      resolver: permissionResolver,
      exists: (id) => automationExists(db, id),
    });

  app.use("/api/auth", createAuthRoutes());
  // The device-action route is a Command_Source: it routes commands through the
  // CommandService (the single physical-command boundary) and is NOT handed a
  // ConnectorManager reference. The action catalog is served through a bound,
  // read-only getActionCatalog accessor only (unified-command-boundary, Req
  // 1.1, 2.2, 2.6, 2.7, 2.8). The ConnectorManager.executeAction() reference is
  // granted to exactly one collaborator — the CommandService deps object above.
  app.use(
    "/api/devices",
    createDeviceRoutes(
      registry,
      commandService,
      (id) => connectorManager.getActionCatalog(id),
      requireDevice,
      permissionResolver,
      stateHistory,
      (id, observationAvailable) => connectorManager.getCompletionTierCapability(id, observationAvailable),
    ),
  );
  app.use("/api/state", createStateRoutes(registry, permissionResolver));
  app.use("/api/health", createHealthRoutes(mqttService, registry, engine, startTime));
  const mqttPublishPolicy = {
    userNamespacePrefix: config.mqttPublish.userNamespacePrefix,
    // Derive the reserved prefix from the ack filter (strip the trailing "/#").
    reservedSystemPrefixes: [ackTopicFilter.replace(/\/#$/, "/")],
    maxPayloadBytes: config.mqttPublish.maxPayloadBytes,
  };
  app.use("/api/mqtt", createMqttRoutes(mqttService, mqttPublishPolicy, privateTopicStore));
  app.use(
    "/api/mqtt/provisioning",
    createProvisioningRoutes(provisioningService, {
      managedProvisioningEnabled: config.managedMqttProvisioningEnabled,
    }),
  );
  const sandboxTypesPath = path.resolve(import.meta.dirname, "automations/sandbox-types.d.ts");
  app.use("/api/automations", createAutomationRoutes(engine, db, registry, commandService, executionLog, sandboxTypesPath, requireAutomation, permissionResolver, connectorRegistry, stateStore, conditionRegistry));
  app.use("/api/connectors", createConnectorRoutes(connectorManager, connectorRegistry));
  app.use("/api/metrics", createMetricsSummaryRoute(metricsService));
  app.use("/api/commands", createCommandRoutes(commandHistoryStore));
  app.use("/api/system", createSystemRoutes());
  app.use("/api/layout", createLayoutRoutes(db, permissionResolver));
  app.use("/api/data-store", createDataStoreRoutes(dataStore, permissionResolver, collectionOwnershipStore));

  app.use(errorHandler);


  // 10. HTTP + WebSocket server
  const server = createServer(app);

  // Server-derived broadcast visibility. Producers never decorate events with a
  // visibility field; these resolvers compute authorization scope from resource
  // identity using the same authoritative resolvers as the REST layer. Anything
  // without a resource→tab mapping is admin-only (fail-closed).
  const stringField = (data: unknown, field: string): string | null => {
    if (data && typeof data === "object" && field in data) {
      const value = (data as Record<string, unknown>)[field];
      return typeof value === "string" ? value : null;
    }
    return null;
  };
  // A device event is visible on exactly the tabs whose panes expose the device.
  // No exposing tabs (unknown/unplaced device) ⇒ empty scope ⇒ admin-only.
  const deviceVisibility = (data: unknown): BroadcastEnvelope => {
    const deviceId = stringField(data, "deviceId");
    if (!deviceId) return { visibility: "admin" };
    return { visibility: "tabs", tabIds: deviceExposureResolver.getExposingTabs(deviceId) };
  };
  // An automation event is visible on the tabs that own/expose the automation.
  const automationVisibility = (data: unknown): BroadcastEnvelope => {
    const ruleId = stringField(data, "ruleId");
    if (!ruleId) return { visibility: "admin" };
    return { visibility: "tabs", tabIds: ownershipStore.getExposingTabs(ruleId) };
  };
  // The raw MQTT feed is a discovery/debugging firehose: its value is showing
  // topics BEFORE anything consumes them (building an automation, onboarding a
  // device), so it is public by default rather than tab-scoped. Admins can carve
  // out sensitive topics via the private-topic filters; a message matching one
  // is withheld from non-admins (admin-only) while everything else stays public.
  const mqttVisibility = (data: unknown): BroadcastEnvelope => {
    const topic = stringField(data, "topic");
    if (topic && privateTopicStore.isPrivate(topic)) {
      return { visibility: "admin" };
    }
    return { visibility: "public" };
  };
  // A Data Store event is visible on the tabs whose data-collection panes surface
  // the collection. No surfacing pane ⇒ empty scope ⇒ admin-only (fail-closed).
  const dataStoreVisibility = createDataStoreVisibility(collectionOwnershipStore);

  const WS_MAPPINGS: WsEventMapping[] = [
    { eventName: WS_STATE_CHANGE, messageType: "state-change", visibility: deviceVisibility },
    // The raw MQTT feed is a discovery firehose — visible to all authenticated
    // clients so it stays useful for building automations and onboarding.
    { eventName: MQTT_RAW_MESSAGE, messageType: "mqtt-message", visibility: mqttVisibility },
    { eventName: AUTOMATION_FIRED, messageType: "automation-fired", visibility: automationVisibility },
    { eventName: AUTOMATION_COMPLETED, messageType: "automation-completed", visibility: automationVisibility },
    { eventName: AUTOMATION_STATE_CHANGE, messageType: "automation-state", visibility: automationVisibility },
    // Data Store events are scoped to the tabs whose data-collection panes
    // surface the collection; a collection no pane surfaces stays admin-only.
    { eventName: DATA_STORE_WRITE, messageType: "data-store-write", visibility: dataStoreVisibility },
    { eventName: DATA_STORE_COLLECTION_DELETED, messageType: "data-store-collection-deleted", visibility: dataStoreVisibility },
    // Phase-1 backend observability for later UI. Command history can disclose
    // device names/behaviour, so both stay admin-only (no visibility resolver ⇒
    // fail-closed admin-only). No frontend rendering belongs in Phase 1.
    { eventName: COMMAND_LIFECYCLE_TRANSITION, messageType: "command-lifecycle" },
    { eventName: AUTOMATION_EVENT, messageType: "automation-event" },
  ];

  const wsServer = new WsServer(server, registry, eventBus, WS_MAPPINGS, deviceExposureResolver);

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
      await metricsHistoryService.dispose();
      dataStore.dispose();
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
