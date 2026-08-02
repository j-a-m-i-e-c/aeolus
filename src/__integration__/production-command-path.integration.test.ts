// src/__integration__/production-command-path.integration.test.ts
//
// Feature: connector-correctness-release-gates, Requirement 7.
//
// Wires the command path the same way src/index.ts does — a real
// ConnectorManager (owning devices by connector type), the real ActionRouter it
// creates, the real CommandService (with its registered handlers), the real
// AutomationScopeResolver, the real resource-authorization PermissionResolver,
// and the real device routes — with `connectorManager.setMqttService()` wired at
// composition. Only the leaf I/O is stubbed: connector `execute()` records
// calls instead of talking to a bridge, and the MqttService records publishes.
//
// This is the test blind spot the 2 Aug 2026 review identified: individual units
// were well covered, but nothing exercised the production dependency graph, so a
// mis-wired command path (source tags read as automation ids, native actions
// with no handler, MQTT never wired, a divergent brightness contract) could
// reach CI green. The connector catalog/brightness fixes in this spec are the
// concrete example of why this suite exists.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { EventEmitter } from "node:events";
import type { Database as DatabaseType } from "better-sqlite3";

import { createTestDatabase, createAuthToken, cleanup } from "../__test-helpers__/index.js";
import { TEST_JWT_SECRET } from "../__test-helpers__/app-factory.js";
import { _resetSecretCache } from "../auth/token-service.js";
import { DeviceRegistry } from "../core/device-registry.js";
import { DEVICE_STATE_CHANGE } from "../core/event-bus.js";
import { ConnectorManager } from "../connectors/connector-manager.js";
import {
  CommandService,
  handlePublish,
  handleToggle,
  handleDeviceAction,
  handleLog,
  handleDelay,
  handleWebhook,
  automationSource,
  type CommandServiceDeps,
} from "../automations/command-service.js";
import { ConditionRegistry } from "../automations/condition-registry.js";
import { createCollectionOwnershipStore } from "../auth/collection-ownership-store.js";
import { createDeviceExposureResolver } from "../auth/device-exposure-resolver.js";
import { createAutomationScopeResolver } from "../automations/automation-scope-resolver.js";
import { createResourceOwnershipStore } from "../auth/resource-ownership-store.js";
import { createPermissionResolver } from "../auth/permission-resolver.js";
import { authenticate, requireDevicePermission } from "../auth/auth-middleware.js";
import type { PermissionLevel } from "../auth/permission-service.js";
import { createDeviceRoutes } from "../api/routes/device.routes.js";
import { errorHandler } from "../api/middleware/error-handler.js";
import type { Connector, ConnectorModule, CapabilityDescriptor } from "../connectors/connector.interface.js";
import type { Action } from "../core/types.js";

vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }),
  },
}));

const NOW = Date.now();

// ── Recorded connector execute() calls, per integration type ─────────────────
const executeCalls: Record<string, Action[]> = { hue: [], kasa: [] };

/** A connector that owns nothing new (devices are seeded in the DB) but records
 * every execute() call and serves a realistic action catalog. */
function makeStubConnector(kind: "hue" | "kasa"): Connector {
  const hueCatalog = (): CapabilityDescriptor[] => [
    { type: "toggle", label: "Toggle", description: "", params: {} },
    { type: "on", label: "On", description: "", params: {} },
    { type: "off", label: "Off", description: "", params: {} },
    {
      type: "brightness", label: "Brightness", description: "",
      params: { type: "object", required: ["brightness"], properties: { brightness: { type: "number", minimum: 0, maximum: 100 } } },
    },
    {
      type: "color", label: "Color", description: "",
      params: { type: "object", required: ["hue", "saturation"], properties: { hue: { type: "number", minimum: 0, maximum: 65535 }, saturation: { type: "number", minimum: 0, maximum: 254 } } },
    },
    {
      type: "color-temp", label: "Color Temp", description: "",
      params: { type: "object", required: ["ct"], properties: { ct: { type: "number" } } },
    },
    { type: "rename", label: "Rename", description: "", params: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
    { type: "delete", label: "Delete", description: "", params: {} },
  ];
  const kasaCatalog = (): CapabilityDescriptor[] => [
    { type: "toggle", label: "Toggle", description: "", params: {} },
    { type: "on", label: "On", description: "", params: {} },
    { type: "off", label: "Off", description: "", params: {} },
  ];
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    discoverDevices: vi.fn().mockResolvedValue([]), // devices are seeded in the DB
    execute: vi.fn(async (action: Action) => {
      executeCalls[kind].push(action);
    }),
    getHealthStatus: vi.fn().mockReturnValue({ status: "connected", lastSeen: NOW }),
    onConfigUpdate: vi.fn(),
    getActionCatalog: (_id: string) => (kind === "hue" ? hueCatalog() : kasaCatalog()),
  } as unknown as Connector;
}

// ── MqttService stub that records publishes (connected) ──────────────────────
function makeRecordingMqtt() {
  const published: Array<{ topic: string; payload: string }> = [];
  return {
    published,
    service: {
      isConnected: () => true,
      publish: (topic: string, payload: string) => { published.push({ topic, payload }); },
      subscribe: () => {},
      unsubscribe: () => {},
      connect: async () => {},
      disconnect: async () => {},
    },
  };
}

function seed(db: DatabaseType): void {
  db.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("g-a", "Group A", NOW);
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("u-user", "normaluser", "x", "user", "g-a", NOW);

  const insertTab = db.prepare(
    'INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertTab.run("tab-a", "Tab A", "layout", 0, 0, NOW);

  // Group A can WRITE tab-a (write >= interact).
  db.prepare(
    "INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)",
  ).run("g-a", "tab-a", "write");

  // A scoped automation owned by tab-a. tab-a exposes dev-hue (hue-control pane)
  // but not dev-kasa, so the scoped rule's device set is {dev-hue}.
  db.prepare(
    "INSERT INTO automation_rules (id, name, trigger_topic, authored_unrestricted, owner_tab_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("auto-scoped", "Scoped rule", "topic/s", 0, "tab-a", NOW);

  const insertDevice = db.prepare(
    "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertDevice.run("dev-hue", "Hue Light", "light", JSON.stringify(["on/off", "brightness", "color", "color-temperature"]), "{}", "hue", NOW);
  insertDevice.run("dev-kasa", "Kasa Plug", "plug", JSON.stringify(["on/off"]), "{}", "kasa", NOW);
  insertDevice.run("dev-mqtt", "Sensor Relay", "sensor", "[]", "{}", "mqtt", NOW);

  // tab-a exposes hue devices via a hue-control pane; dev-kasa and dev-mqtt are
  // exposed by no purposeful pane.
  db.prepare(
    "INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("pane-a-hue", "tab-a", "hue-control", "{}", 0, 0, 6, 4, NOW);
}

const userToken = () => createAuthToken({ userId: "u-user", username: "normaluser", role: "user", groupId: "g-a" });
const adminToken = () => createAuthToken({ userId: "u-admin", role: "admin" });

describe("Production command-path composition (integration)", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let registry: DeviceRegistry;
  let manager: ConnectorManager;
  let commandService: CommandService;
  let scopeResolver: ReturnType<typeof createAutomationScopeResolver>;
  let mqtt: ReturnType<typeof makeRecordingMqtt>;
  let app: Express;

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    _resetSecretCache();

    executeCalls.hue = [];
    executeCalls.kasa = [];

    db = createTestDatabase();
    seed(db);
    eventBus = new EventEmitter();
    registry = new DeviceRegistry(db, eventBus);
    registry.loadFromDb();
    eventBus.on(DEVICE_STATE_CHANGE, (event) => registry.upsert(event));

    // Connector framework — real ConnectorManager + a fake registry serving
    // stub modules for the hue/kasa types. Devices are seeded in the DB; the
    // stub connectors own actions for their integration type via the manager's
    // by-type owner fallback.
    const modules: Record<string, ConnectorModule> = {
      hue: {
        metadata: { id: "hue", displayName: "Hue", icon: "bulb" } as ConnectorModule["metadata"],
        configSchema: [],
        createConnector: () => makeStubConnector("hue"),
      },
      kasa: {
        metadata: { id: "kasa", displayName: "Kasa", icon: "plug" } as ConnectorModule["metadata"],
        configSchema: [],
        createConnector: () => makeStubConnector("kasa"),
      },
    };
    const connectorRegistry = {
      getModule: (type: string) => modules[type],
      listAvailable: () => [],
      register: () => {},
    };
    const store = { save: vi.fn(), disable: vi.fn(), loadEnabled: vi.fn().mockReturnValue([]) };

    manager = new ConnectorManager(connectorRegistry as never, store as never, registry as never, eventBus);
    manager.setRegistries({ registerHandler: vi.fn(), unregisterHandler: vi.fn() } as never, new ConditionRegistry() as never);

    mqtt = makeRecordingMqtt();
    // Gate 3 (pre-promotion-release-gates): wire the live MqttService so MQTT
    // device dispatch can publish. Omitting this is exactly the bug the suite guards.
    manager.setMqttService(mqtt.service as never);

    await manager.enable("hue", {});
    await manager.enable("kasa", {});

    // Authorization scope + resource-authorization, built against the test db.
    const collectionOwnershipStore = createCollectionOwnershipStore(db);
    const deviceExposureResolver = createDeviceExposureResolver(registry, db);
    scopeResolver = createAutomationScopeResolver(deviceExposureResolver, collectionOwnershipStore, db);

    commandService = new CommandService({
      mqttService: mqtt.service,
      connectorManager: manager,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      deviceRegistry: registry,
      scopeResolver,
    } as unknown as CommandServiceDeps);
    commandService.registerHandler("publish", handlePublish);
    commandService.registerHandler("toggle", handleToggle);
    commandService.registerHandler("device_action", handleDeviceAction);
    commandService.registerHandler("log", handleLog);
    commandService.registerHandler("delay", handleDelay);
    commandService.registerHandler("webhook", handleWebhook);

    const ownershipStore = createResourceOwnershipStore(db);
    const permissionResolver = createPermissionResolver(ownershipStore, deviceExposureResolver, db);
    const requireDevice = (level: PermissionLevel) =>
      requireDevicePermission(level, {
        resolver: permissionResolver,
        exists: (id) => registry.getById(id) !== undefined,
      });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(authenticate);
    app.use(
      "/api/devices",
      createDeviceRoutes(
        registry,
        commandService,
        (id) => manager.getActionCatalog(id),
        requireDevice,
        permissionResolver,
      ),
    );
    app.use(errorHandler);
  });

  afterEach(async () => {
    await manager.disposeAll();
    cleanup({ databases: [db] });
  });

  // Req 7.2 — authorized REST toggle reaches the connector for admin and a permitted user.
  it("routes an admin REST toggle through to the connector", async () => {
    const res = await request(app)
      .post("/api/devices/dev-hue/action")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ type: "toggle" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(executeCalls.hue.map((a) => a.type)).toContain("toggle");
  });

  it("routes a permitted non-admin REST toggle through to the connector", async () => {
    const res = await request(app)
      .post("/api/devices/dev-hue/action")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ type: "toggle" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(executeCalls.hue.map((a) => a.type)).toContain("toggle");
  });

  // Req 7.3 — a Hue brightness action (canonical 0–100) passes catalog validation and reaches the connector.
  it("passes a canonical 0–100 brightness action through validation to the connector", async () => {
    const res = await request(app)
      .post("/api/devices/dev-hue/action")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ type: "brightness", params: { brightness: 50 } });
    expect(res.status).toBe(200);
    const call = executeCalls.hue.find((a) => a.type === "brightness");
    expect(call).toBeDefined();
    expect(call!.params.brightness).toBe(50);
  });

  // Req 7.4 — an explicit Kasa off reaches the connector.
  it("routes a Kasa off through to the connector", async () => {
    const res = await request(app)
      .post("/api/devices/dev-kasa/action")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ type: "off" });
    expect(res.status).toBe(200);
    expect(executeCalls.kasa.map((a) => a.type)).toContain("off");
  });

  // Req 7.5 — an MQTT device action publishes through the injected MqttService.
  it("publishes an MQTT device command through the composition-injected MqttService", async () => {
    const res = await request(app)
      .post("/api/devices/dev-mqtt/action")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ type: "command", params: { payload: { relay: "on" } } });
    expect(res.status).toBe(200);
    expect(mqtt.published.length).toBeGreaterThan(0);
    expect(mqtt.published[0].topic).toBe("dev-mqtt/set");
  });

  // Req 7.6 — an out-of-scope REST action is rejected before dispatch.
  it("rejects a non-admin REST action on an unexposed device with 403 and never dispatches", async () => {
    const res = await request(app)
      .post("/api/devices/dev-kasa/action")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ type: "off" });
    expect(res.status).toBe(403);
    expect(executeCalls.kasa.length).toBe(0);
  });

  // Req 7.8 — Hue color-temp and rename pass catalog validation and reach the connector.
  it("passes Hue color-temp and rename through catalog validation to the connector", async () => {
    const ct = await request(app)
      .post("/api/devices/dev-hue/action")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ type: "color-temp", params: { ct: 300 } });
    expect(ct.status).toBe(200);

    const rn = await request(app)
      .post("/api/devices/dev-hue/action")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ type: "rename", params: { name: "New Name" } });
    expect(rn.status).toBe(200);

    const types = executeCalls.hue.map((a) => a.type);
    expect(types).toContain("color-temp");
    expect(types).toContain("rename");
  });

  // rename/delete manage the device on the bridge and are admin-only, even for a
  // non-admin who can otherwise operate (interact) the light.
  it("rejects a non-admin rename with 403 and never reaches the connector", async () => {
    const res = await request(app)
      .post("/api/devices/dev-hue/action")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ type: "rename", params: { name: "Hijacked" } });
    expect(res.status).toBe(403);
    expect(executeCalls.hue.some((a) => a.type === "rename")).toBe(false);
  });

  // Req 7.7 — a scoped automation cannot act outside its device set (fabricated / out-of-scope id).
  describe("scoped automation cannot escape its device set", () => {
    it("dispatches an in-scope device action", async () => {
      const result = await commandService.execute(
        { type: "device_action", target: "dev-hue", params: { actionType: "toggle" } },
        automationSource("auto-scoped"),
      );
      expect(result.success).toBe(true);
      expect(executeCalls.hue.map((a) => a.type)).toContain("toggle");
    });

    it("refuses an out-of-scope device action before dispatch", async () => {
      const result = await commandService.execute(
        { type: "device_action", target: "dev-kasa", params: { actionType: "off" } },
        automationSource("auto-scoped"),
      );
      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("unauthorized");
      expect(executeCalls.kasa.length).toBe(0);
    });
  });
});
