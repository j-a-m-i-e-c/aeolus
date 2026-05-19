// src/services/service-manager.test.ts — Unit tests for ServiceManager lifecycle
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { ServiceManager } from "./service-manager.js";
import { ServiceRegistry } from "./service-registry.js";
import { ServiceStore } from "./service-store.js";
import type {
  ServiceInstance,
  ServiceModule,
  ServiceRecord,
} from "./service.interface.js";

// Mock the logger to avoid pino initialization and capture log calls
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/** Create a mock ServiceInstance with all lifecycle methods as vi.fn() */
function createMockServiceInstance(
  overrides?: Partial<ServiceInstance>,
): ServiceInstance {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    getHealthStatus: vi.fn().mockReturnValue({
      status: "running",
      lastActivity: Date.now(),
    }),
    onConfigUpdate: vi.fn(),
    ...overrides,
  };
}

/** Create a mock ServiceModule that produces mock instances */
function createMockServiceModule(
  id: string,
  instanceOverrides?: Partial<ServiceInstance>,
): ServiceModule {
  const instance = createMockServiceInstance(instanceOverrides);
  return {
    metadata: {
      id,
      displayName: `${id} Service`,
      icon: "zap",
      description: `Mock ${id} service`,
      category: "test",
    },
    configSchema: [],
    createService: vi.fn().mockReturnValue(instance),
  };
}

describe("ServiceManager", () => {
  let registry: ServiceRegistry;
  let store: ServiceStore;
  let eventBus: EventEmitter;
  let manager: ServiceManager;

  beforeEach(() => {
    registry = new ServiceRegistry();
    // Mock the store methods directly since we don't want a real DB
    store = {
      save: vi.fn(),
      disable: vi.fn(),
      loadEnabled: vi.fn().mockReturnValue([]),
      loadAll: vi.fn().mockReturnValue([]),
    } as unknown as ServiceStore;
    eventBus = new EventEmitter();
    manager = new ServiceManager(registry, store, eventBus);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("service registration appears in registry", () => {
    it("should enable a service and track it in the manager", async () => {
      const mod = createMockServiceModule("test-svc");
      registry.register(mod);

      const instanceId = await manager.enable("test-svc", { key: "value" });

      expect(instanceId).toBeDefined();
      expect(typeof instanceId).toBe("string");

      // The service should appear in listEnabled
      const enabled = manager.listEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].serviceType).toBe("test-svc");
      expect(enabled[0].id).toBe(instanceId);
      expect(enabled[0].enabled).toBe(true);
    });

    it("should throw when enabling an unregistered service type", async () => {
      await expect(
        manager.enable("nonexistent", {}),
      ).rejects.toThrow("Service type 'nonexistent' not found in registry");
    });

    it("should persist the service record to the store on enable", async () => {
      const mod = createMockServiceModule("persist-svc");
      registry.register(mod);

      await manager.enable("persist-svc", { port: 8080 });

      expect(store.save).toHaveBeenCalledTimes(1);
      const savedRecord = (store.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as ServiceRecord;
      expect(savedRecord.serviceType).toBe("persist-svc");
      expect(savedRecord.enabled).toBe(true);
      expect(savedRecord.config).toEqual({ port: 8080 });
    });
  });

  describe("restoreFromStore() calls start() on each registered service", () => {
    it("should call start() on each service restored from the store", async () => {
      const instance1 = createMockServiceInstance();
      const instance2 = createMockServiceInstance();

      const mod: ServiceModule = {
        metadata: {
          id: "restore-svc",
          displayName: "Restore Svc",
          icon: "zap",
          description: "test",
          category: "test",
        },
        configSchema: [],
        createService: vi
          .fn()
          .mockReturnValueOnce(instance1)
          .mockReturnValueOnce(instance2),
      };
      registry.register(mod);

      const records: ServiceRecord[] = [
        {
          id: "instance-1",
          serviceType: "restore-svc",
          enabled: true,
          config: { name: "first" },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "instance-2",
          serviceType: "restore-svc",
          enabled: true,
          config: { name: "second" },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      (store.loadEnabled as ReturnType<typeof vi.fn>).mockReturnValue(records);

      await manager.restoreFromStore();

      // createService should have been called twice
      expect(mod.createService).toHaveBeenCalledTimes(2);

      // start() should have been called on each created instance
      expect(instance1.start).toHaveBeenCalledTimes(1);
      expect(instance2.start).toHaveBeenCalledTimes(1);

      // Both should appear in listEnabled
      const enabled = manager.listEnabled();
      expect(enabled).toHaveLength(2);
    });

    it("should skip services whose module is not in the registry", async () => {
      const records: ServiceRecord[] = [
        {
          id: "orphan-1",
          serviceType: "missing-module",
          enabled: true,
          config: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      (store.loadEnabled as ReturnType<typeof vi.fn>).mockReturnValue(records);

      await manager.restoreFromStore();

      // No instances should be tracked
      const enabled = manager.listEnabled();
      expect(enabled).toHaveLength(0);
    });
  });

  describe("disposeAll() calls stop() on each running service", () => {
    it("should call stop() and dispose() on all tracked instances", async () => {
      const instance1 = createMockServiceInstance();
      const instance2 = createMockServiceInstance();

      const mod: ServiceModule = {
        metadata: {
          id: "dispose-svc",
          displayName: "Dispose Svc",
          icon: "zap",
          description: "test",
          category: "test",
        },
        configSchema: [],
        createService: vi
          .fn()
          .mockReturnValueOnce(instance1)
          .mockReturnValueOnce(instance2),
      };
      registry.register(mod);

      await manager.enable("dispose-svc", { a: 1 });
      await manager.enable("dispose-svc", { b: 2 });

      const enabled = manager.listEnabled();
      expect(enabled).toHaveLength(2);

      await manager.disposeAll();

      // stop() and dispose() should have been called on each
      expect(instance1.stop).toHaveBeenCalledTimes(1);
      expect(instance1.dispose).toHaveBeenCalledTimes(1);
      expect(instance2.stop).toHaveBeenCalledTimes(1);
      expect(instance2.dispose).toHaveBeenCalledTimes(1);

      // No instances should remain
      const remaining = manager.listEnabled();
      expect(remaining).toHaveLength(0);
    });

    it("should continue disposing other services if one throws during stop", async () => {
      const failInstance = createMockServiceInstance({
        stop: vi.fn().mockRejectedValue(new Error("stop failed")),
      });
      const okInstance = createMockServiceInstance();

      const mod: ServiceModule = {
        metadata: {
          id: "mixed-svc",
          displayName: "Mixed",
          icon: "zap",
          description: "test",
          category: "test",
        },
        configSchema: [],
        createService: vi
          .fn()
          .mockReturnValueOnce(failInstance)
          .mockReturnValueOnce(okInstance),
      };
      registry.register(mod);

      await manager.enable("mixed-svc", {});
      await manager.enable("mixed-svc", {});

      await manager.disposeAll();

      // Both should have had stop() called
      expect(failInstance.stop).toHaveBeenCalledTimes(1);
      expect(okInstance.stop).toHaveBeenCalledTimes(1);
      // Both should have had dispose() called
      expect(failInstance.dispose).toHaveBeenCalledTimes(1);
      expect(okInstance.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe("service throwing during start is logged and other services still start", () => {
    it("should log error and continue when a service throws during enable start()", async () => {
      const logger = await import("../logger.js");
      const failingInstance = createMockServiceInstance({
        start: vi.fn().mockRejectedValue(new Error("start exploded")),
      });
      const mod: ServiceModule = {
        metadata: {
          id: "fail-start",
          displayName: "Fail Start",
          icon: "zap",
          description: "test",
          category: "test",
        },
        configSchema: [],
        createService: vi.fn().mockReturnValue(failingInstance),
      };
      registry.register(mod);

      // Should not throw — error is caught internally
      const instanceId = await manager.enable("fail-start", {});
      expect(instanceId).toBeDefined();

      // Error should have been logged
      expect(logger.default.error).toHaveBeenCalled();

      // Service should still be tracked (for retry)
      const enabled = manager.listEnabled();
      expect(enabled).toHaveLength(1);
    });

    it("should log error and continue starting other services during restoreFromStore", async () => {
      const logger = await import("../logger.js");

      const failInstance = createMockServiceInstance({
        start: vi.fn().mockRejectedValue(new Error("restore start failed")),
      });
      const okInstance = createMockServiceInstance();

      const mod: ServiceModule = {
        metadata: {
          id: "restore-mixed",
          displayName: "Restore Mixed",
          icon: "zap",
          description: "test",
          category: "test",
        },
        configSchema: [],
        createService: vi
          .fn()
          .mockReturnValueOnce(failInstance)
          .mockReturnValueOnce(okInstance),
      };
      registry.register(mod);

      const records: ServiceRecord[] = [
        {
          id: "fail-instance",
          serviceType: "restore-mixed",
          enabled: true,
          config: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "ok-instance",
          serviceType: "restore-mixed",
          enabled: true,
          config: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      (store.loadEnabled as ReturnType<typeof vi.fn>).mockReturnValue(records);

      await manager.restoreFromStore();

      // Both instances should have had start() called
      expect(failInstance.start).toHaveBeenCalledTimes(1);
      expect(okInstance.start).toHaveBeenCalledTimes(1);

      // Error should have been logged for the failing one
      expect(logger.default.error).toHaveBeenCalled();

      // Both should still be tracked
      const enabled = manager.listEnabled();
      expect(enabled).toHaveLength(2);
    });
  });

  describe("cron service scheduling with correct expression", () => {
    it("should pass config with cron schedules to the service factory", async () => {
      const mod = createMockServiceModule("cron");
      registry.register(mod);

      const cronConfig = {
        schedules: JSON.stringify([
          { name: "backup", cron: "0 2 * * *" },
          { name: "cleanup", cron: "*/5 * * * *" },
        ]),
      };

      await manager.enable("cron", cronConfig);

      // Verify createService was called with the cron config
      expect(mod.createService).toHaveBeenCalledWith(cronConfig, {
        eventBus,
      });

      // Verify start() was called on the instance
      const instance = (mod.createService as ReturnType<typeof vi.fn>).mock
        .results[0].value as ServiceInstance;
      expect(instance.start).toHaveBeenCalledTimes(1);
    });

    it("should restore a cron service from store with its schedule config", async () => {
      const mod = createMockServiceModule("cron");
      registry.register(mod);

      const cronConfig = {
        schedules: JSON.stringify([{ name: "hourly", cron: "0 * * * *" }]),
      };

      const records: ServiceRecord[] = [
        {
          id: "cron-instance-1",
          serviceType: "cron",
          enabled: true,
          config: cronConfig,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      (store.loadEnabled as ReturnType<typeof vi.fn>).mockReturnValue(records);

      await manager.restoreFromStore();

      // createService should have been called with the cron config
      expect(mod.createService).toHaveBeenCalledWith(cronConfig, {
        eventBus,
      });

      // start() should have been called
      const instance = (mod.createService as ReturnType<typeof vi.fn>).mock
        .results[0].value as ServiceInstance;
      expect(instance.start).toHaveBeenCalledTimes(1);
    });
  });

  describe("disable", () => {
    it("should stop, dispose, and remove a service", async () => {
      const mod = createMockServiceModule("disable-svc");
      registry.register(mod);

      const instanceId = await manager.enable("disable-svc", {});
      await manager.disable(instanceId);

      expect(manager.listEnabled()).toHaveLength(0);
      expect(store.disable).toHaveBeenCalledWith(instanceId);
    });

    it("should throw when instance not found", async () => {
      await expect(manager.disable("nonexistent")).rejects.toThrow("not found");
    });

    it("should handle stop() throwing gracefully", async () => {
      const mod = createMockServiceModule("stop-fail", {
        stop: vi.fn().mockRejectedValue(new Error("stop failed")),
      });
      registry.register(mod);

      const instanceId = await manager.enable("stop-fail", {});
      // Should not throw
      await manager.disable(instanceId);
      expect(manager.listEnabled()).toHaveLength(0);
    });
  });

  describe("updateConfig", () => {
    it("should call onConfigUpdate and persist", async () => {
      const mod = createMockServiceModule("update-svc");
      registry.register(mod);

      const instanceId = await manager.enable("update-svc", { old: "value" });
      await manager.updateConfig(instanceId, { new: "config" });

      const instance = (mod.createService as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(instance.onConfigUpdate).toHaveBeenCalledWith({ new: "config" });
      expect(store.save).toHaveBeenCalledTimes(2); // enable + update
    });

    it("should throw when instance not found", async () => {
      await expect(manager.updateConfig("nonexistent", {})).rejects.toThrow("not found");
    });
  });

  describe("retry", () => {
    it("should call start() again on the instance", async () => {
      const mod = createMockServiceModule("retry-svc");
      registry.register(mod);

      const instanceId = await manager.enable("retry-svc", {});
      const instance = (mod.createService as ReturnType<typeof vi.fn>).mock.results[0].value;
      instance.start.mockClear();

      await manager.retry(instanceId);
      expect(instance.start).toHaveBeenCalledTimes(1);
    });

    it("should throw when instance not found", async () => {
      await expect(manager.retry("nonexistent")).rejects.toThrow("not found");
    });
  });

  describe("getStatus", () => {
    it("should return status for a tracked instance", async () => {
      const mod = createMockServiceModule("status-svc");
      registry.register(mod);

      const instanceId = await manager.enable("status-svc", { key: "val" });
      const status = manager.getStatus(instanceId);

      expect(status).toBeDefined();
      expect(status!.id).toBe(instanceId);
      expect(status!.serviceType).toBe("status-svc");
      expect(status!.health.status).toBe("running");
    });

    it("should return undefined for non-existent instance", () => {
      expect(manager.getStatus("nonexistent")).toBeUndefined();
    });
  });

  describe("getServiceInstance", () => {
    it("should return the instance by service type", async () => {
      const mod = createMockServiceModule("find-svc");
      registry.register(mod);

      await manager.enable("find-svc", {});
      const instance = manager.getServiceInstance("find-svc");
      expect(instance).toBeDefined();
      expect(instance!.start).toBeDefined();
    });

    it("should return undefined for non-existent type", () => {
      expect(manager.getServiceInstance("nonexistent")).toBeUndefined();
    });
  });
});
