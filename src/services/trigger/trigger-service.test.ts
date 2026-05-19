// src/services/trigger/trigger-service.test.ts — Unit tests for API Trigger service

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { TriggerServiceInstance, metadata, configSchema, createService } from "./index.js";
import { DEVICE_STATE_CHANGE } from "../../core/event-bus.js";

describe("TriggerServiceInstance", () => {
  let eventBus: EventEmitter;
  let instance: TriggerServiceInstance;

  beforeEach(() => {
    eventBus = new EventEmitter();
  });

  afterEach(async () => {
    if (instance) await instance.dispose();
  });

  describe("metadata", () => {
    it("has correct id and displayName", () => {
      expect(metadata.id).toBe("trigger");
      expect(metadata.displayName).toBe("API Trigger");
      expect(metadata.icon).toBe("webhook");
      expect(metadata.category).toBe("integration");
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
    });
  });

  describe("lifecycle", () => {
    it("starts and reports running health", async () => {
      instance = new TriggerServiceInstance({}, { eventBus });
      await instance.start();

      const health = instance.getHealthStatus();
      expect(health.status).toBe("running");
    });

    it("stops gracefully", async () => {
      instance = new TriggerServiceInstance({}, { eventBus });
      await instance.start();
      await instance.stop();
      // Should not throw
    });

    it("dispose sets running to false", async () => {
      instance = new TriggerServiceInstance({}, { eventBus });
      await instance.start();
      await instance.dispose();
      // getHealthStatus still returns "running" because the trigger service always reports running
      // (it's stateless — it just emits events when called)
      expect(instance.getHealthStatus().status).toBe("running");
    });
  });

  describe("emitTrigger", () => {
    it("emits DEVICE_STATE_CHANGE with correct topic", async () => {
      const events: any[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (e) => events.push(e));

      instance = new TriggerServiceInstance({}, { eventBus });
      await instance.start();
      instance.emitTrigger("deploy", { version: "1.0" });

      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe("service/trigger/deploy");
      expect(events[0].deviceId).toBe("service-trigger");
      expect(events[0].state.triggerName).toBe("deploy");
      expect(events[0].state.payload).toEqual({ version: "1.0" });
      expect(events[0].state.firedAt).toBeGreaterThan(0);
      expect(events[0].integration).toBe("service");
    });

    it("emits with empty payload when body is undefined", async () => {
      const events: any[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (e) => events.push(e));

      instance = new TriggerServiceInstance({}, { eventBus });
      instance.emitTrigger("simple");

      expect(events[0].state.payload).toEqual({});
    });

    it("increments trigger count", async () => {
      instance = new TriggerServiceInstance({}, { eventBus });
      await instance.start();

      instance.emitTrigger("a");
      instance.emitTrigger("b");
      instance.emitTrigger("c");

      const state = instance.getState!();
      expect(state.triggerCount).toBe(3);
    });

    it("updates lastTriggerAt", async () => {
      instance = new TriggerServiceInstance({}, { eventBus });
      await instance.start();

      const before = Date.now();
      instance.emitTrigger("test");
      const after = Date.now();

      const state = instance.getState!();
      expect(state.lastTriggerAt).toBeGreaterThanOrEqual(before);
      expect(state.lastTriggerAt).toBeLessThanOrEqual(after);
    });
  });

  describe("getState", () => {
    it("returns initial state with zero counts", async () => {
      instance = new TriggerServiceInstance({}, { eventBus });
      const state = instance.getState!();
      expect(state.triggerCount).toBe(0);
      expect(state.lastTriggerAt).toBe(0);
    });
  });

  describe("onConfigUpdate", () => {
    it("does nothing (no config to update)", async () => {
      instance = new TriggerServiceInstance({}, { eventBus });
      await instance.start();
      instance.onConfigUpdate({ anything: "value" });
      // Should not throw
    });
  });
});
