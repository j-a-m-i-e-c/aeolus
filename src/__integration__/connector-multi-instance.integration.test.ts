// src/__integration__/connector-multi-instance.integration.test.ts
//
// Proves two instances of the same connector type coexist correctly: each owns
// its own devices, actions dispatch to the owning instance, disabling one keeps
// the other fully functional (devices + shared contributions), and the disabled
// instance's devices are removed while the sibling's survive.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { ConnectorManager } from "../connectors/connector-manager.js";
import { DeviceRegistry } from "../core/device-registry.js";
import { initSchema } from "../db/database.js";
import { DEVICE_STATE_CHANGE } from "../core/event-bus.js";
import type { Connector, ConnectorModule } from "../connectors/connector.interface.js";
import type { Device } from "../core/types.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** A connector that discovers a single device whose id encodes the bridge config. */
function createBridgeConnector(bridge: string): Connector {
  const device: Device = {
    id: `hue-${bridge}-light`,
    name: `Light ${bridge}`,
    type: "light",
    capabilities: ["on/off"],
    state: { on: false },
    integration: "hue",
    lastSeen: Date.now(),
  };
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    discoverDevices: vi.fn().mockResolvedValue([device]),
    execute: vi.fn().mockResolvedValue({ success: true }),
    getHealthStatus: vi.fn().mockReturnValue({ status: "connected", lastActivity: Date.now() }),
    onConfigUpdate: vi.fn(),
  } as unknown as Connector;
}

/** Minimal CommandService double tracking which action handler types are registered. */
function createCommandServiceDouble() {
  const handlers = new Set<string>();
  return {
    handlers,
    registerHandler: vi.fn((type: string) => handlers.add(type)),
    unregisterHandler: vi.fn((type: string) => handlers.delete(type)),
  };
}

/** Minimal ConditionRegistry double tracking registered condition types. */
function createConditionRegistryDouble() {
  const conditions = new Set<string>();
  return {
    conditions,
    registerCondition: vi.fn((type: string) => conditions.add(type)),
    unregisterCondition: vi.fn((type: string) => conditions.delete(type)),
  };
}

describe("connector multi-instance ownership (integration)", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let registry: DeviceRegistry;
  let manager: ConnectorManager;
  let commandService: ReturnType<typeof createCommandServiceDouble>;
  let conditionRegistry: ReturnType<typeof createConditionRegistryDouble>;
  let connectorsByInstanceConfig: Map<string, Connector>;
  let store: { save: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn>; loadEnabled: ReturnType<typeof vi.fn> };

  const hueModule: ConnectorModule = {
    metadata: { id: "hue", displayName: "Hue", icon: "bulb" } as ConnectorModule["metadata"],
    configSchema: [],
    createConnector: (config: Record<string, unknown>) => {
      const bridge = String(config.bridge);
      const connector = createBridgeConnector(bridge);
      connectorsByInstanceConfig.set(bridge, connector);
      return connector;
    },
    actionHandlers: { "hue.scene": { handler: vi.fn() as never, physical: true } },
    conditions: { "hue.reachable": vi.fn() as never },
  };

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    eventBus = new EventEmitter();
    registry = new DeviceRegistry(db, eventBus);
    registry.loadFromDb();
    // Mirror index.ts wiring: connector discovery events flow into the registry.
    eventBus.on(DEVICE_STATE_CHANGE, (event) => registry.upsert(event));

    connectorsByInstanceConfig = new Map();
    commandService = createCommandServiceDouble();
    conditionRegistry = createConditionRegistryDouble();
    store = { save: vi.fn(), disable: vi.fn(), loadEnabled: vi.fn().mockReturnValue([]) };

    const connectorRegistry = {
      getModule: vi.fn().mockReturnValue(hueModule),
      listAvailable: vi.fn().mockReturnValue([]),
    };

    manager = new ConnectorManager(
      connectorRegistry as never,
      store as never,
      registry as never,
      eventBus,
    );
    manager.setRegistries(commandService as never, conditionRegistry as never);
  });

  afterEach(async () => {
    await manager.disposeAll();
    db.close();
  });

  it("keeps two instances of one type independent through a disable", async () => {
    // Enable two Hue bridges.
    const idA = await manager.enable("hue", { bridge: "a" });
    const idB = await manager.enable("hue", { bridge: "b" });

    // Each device is owned by the instance that discovered it.
    expect(registry.getById("hue-a-light")?.connectorInstanceId).toBe(idA);
    expect(registry.getById("hue-b-light")?.connectorInstanceId).toBe(idB);

    // Shared, type-generic contributions are registered exactly once.
    expect(commandService.registerHandler).toHaveBeenCalledTimes(1);
    expect(commandService.handlers.has("hue.scene")).toBe(true);
    expect(conditionRegistry.conditions.has("hue.reachable")).toBe(true);

    // Actions dispatch to the owning instance.
    const resB = await manager.executeAction("hue-b-light", { type: "on", deviceId: "hue-b-light", params: {} });
    expect(resB.success).toBe(true);
    expect(connectorsByInstanceConfig.get("b")!.execute).toHaveBeenCalledTimes(1);
    expect(connectorsByInstanceConfig.get("a")!.execute).not.toHaveBeenCalled();

    // Disable bridge A.
    await manager.disable(idA);

    // A's device is gone; B's device survives.
    expect(registry.getById("hue-a-light")).toBeUndefined();
    expect(registry.getById("hue-b-light")).toBeDefined();

    // Shared contributions remain because B still needs them.
    expect(commandService.unregisterHandler).not.toHaveBeenCalled();
    expect(commandService.handlers.has("hue.scene")).toBe(true);

    // B still executes actions.
    const resB2 = await manager.executeAction("hue-b-light", { type: "on", deviceId: "hue-b-light", params: {} });
    expect(resB2.success).toBe(true);

    // Disabling the last instance finally tears the contributions down.
    await manager.disable(idB);
    expect(commandService.unregisterHandler).toHaveBeenCalledWith("hue.scene");
    expect(commandService.handlers.has("hue.scene")).toBe(false);
    expect(conditionRegistry.conditions.has("hue.reachable")).toBe(false);
  });
});
