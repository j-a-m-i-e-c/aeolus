// src/services/system/system-service.test.ts — Unit tests for System Events service

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { SystemEventsServiceInstance, metadata, configSchema, createService } from "./index.js";
import { DEVICE_STATE_CHANGE } from "../../core/event-bus.js";

describe("SystemEventsServiceInstance", () => {
  let eventBus: EventEmitter;
  let instance: SystemEventsServiceInstance;

  beforeEach(() => {
    eventBus = new EventEmitter();
  });

  afterEach(async () => {
    if (instance) await instance.dispose();
  });

  describe("metadata", () => {
    it("has correct id and displayName", () => {
      expect(metadata.id).toBe("system");
      expect(metadata.displayName).toBe("System Events");
      expect(metadata.icon).toBe("server");
      expect(metadata.category).toBe("system");
    });
  });

  describe("configSchema", () => {
    it("is empty (no config needed)", () => {
      expect(configSchema).toHaveLength(0);
    });
  });

  describe("createService factory", () => {
    it("returns a ServiceInstance", () => {
      const svc = createService({}, { eventBus });
      expect(svc).toBeDefined();
      expect(svc.start).toBeDefined();
      expect(svc.stop).toBeDefined();
    });
  });

  describe("start", () => {
    it("emits startup event on event bus", async () => {
      const events: any[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (e) => events.push(e));

      instance = new SystemEventsServiceInstance({}, { eventBus });
      await instance.start();

      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe("service/system/startup");
      expect(events[0].deviceId).toBe("service-system");
      expect(events[0].state.bootTimestamp).toBeGreaterThan(0);
      expect(events[0].integration).toBe("service");
    });

    it("reports running health after start", async () => {
      instance = new SystemEventsServiceInstance({}, { eventBus });
      await instance.start();

      const health = instance.getHealthStatus();
      expect(health.status).toBe("running");
      expect(health.lastActivity).toBeGreaterThan(0);
    });
  });

  describe("stop", () => {
    it("emits shutdown event on event bus", async () => {
      const events: any[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (e) => events.push(e));

      instance = new SystemEventsServiceInstance({}, { eventBus });
      await instance.start();
      events.length = 0; // Clear startup event

      await instance.stop();

      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe("service/system/shutdown");
      expect(events[0].state.shutdownTimestamp).toBeGreaterThan(0);
    });

    it("reports stopped health after stop", async () => {
      instance = new SystemEventsServiceInstance({}, { eventBus });
      await instance.start();
      await instance.stop();

      const health = instance.getHealthStatus();
      expect(health.status).toBe("stopped");
    });
  });

  describe("dispose", () => {
    it("sets running to false", async () => {
      instance = new SystemEventsServiceInstance({}, { eventBus });
      await instance.start();
      await instance.dispose();

      const health = instance.getHealthStatus();
      expect(health.status).toBe("stopped");
    });
  });

  describe("getState", () => {
    it("returns startup timestamp and uptime", async () => {
      instance = new SystemEventsServiceInstance({}, { eventBus });
      await instance.start();

      const state = instance.getState!();
      expect(state.startupTimestamp).toBeGreaterThan(0);
      expect(state.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it("returns 0 uptime when not running", async () => {
      instance = new SystemEventsServiceInstance({}, { eventBus });
      const state = instance.getState!();
      expect(state.uptimeSeconds).toBe(0);
    });
  });

  describe("onConfigUpdate", () => {
    it("does nothing (no config to update)", async () => {
      instance = new SystemEventsServiceInstance({}, { eventBus });
      await instance.start();
      // Should not throw
      instance.onConfigUpdate({ anything: "value" });
      expect(instance.getHealthStatus().status).toBe("running");
    });
  });
});
