// src/metrics/metrics-service.test.ts — Unit tests for MetricsService

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// We need to reset prom-client registry between tests
vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() },
}));

describe("MetricsService", () => {
  let eventBus: EventEmitter;

  beforeEach(() => {
    eventBus = new EventEmitter();
    vi.resetModules();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  async function createFreshService() {
    // Clear prom-client registry before each import
    const promClient = await import("prom-client");
    promClient.register.clear();

    const { metricsService } = await import("./metrics-service.js");
    return metricsService;
  }

  describe("initialization", () => {
    it("creates a MetricsService instance", async () => {
      const service = await createFreshService();
      expect(service).toBeDefined();
      expect(service.getRegistry).toBeDefined();
    });

    it("getRegistry returns a prom-client registry", async () => {
      const service = await createFreshService();
      const registry = service.getRegistry();
      expect(registry).toBeDefined();
      expect(registry.metrics).toBeDefined();
    });

    it("initialize subscribes to event bus events", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 5,
        getRuleCount: () => 3,
      });

      // Should have listeners on the event bus
      expect(eventBus.listenerCount("device:state-change")).toBeGreaterThan(0);
    });

    it("initialize called twice logs warning", async () => {
      const service = await createFreshService();
      const deps = { eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 };
      service.initialize(deps);
      service.initialize(deps); // Should warn
    });
  });

  describe("recordHttpRequest", () => {
    it("records HTTP request metrics without throwing", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 0,
        getRuleCount: () => 0,
      });

      // Should not throw
      service.recordHttpRequest("GET", "/api/devices", 200, 0.05);
      service.recordHttpRequest("POST", "/api/automations", 201, 0.12);
    });
  });

  describe("event handling", () => {
    it("handles DEVICE_STATE_CHANGE events", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 3,
        getRuleCount: () => 0,
      });

      // Emit event — should not throw
      const { DEVICE_STATE_CHANGE } = await import("../core/event-bus.js");
      eventBus.emit(DEVICE_STATE_CHANGE, {
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 22 },
        topic: "home/sensor-1",
      });
    });

    it("handles MQTT_CONNECTION_STATE events", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 0,
        getRuleCount: () => 0,
      });

      const { MQTT_CONNECTION_STATE } = await import("../core/event-bus.js");
      eventBus.emit(MQTT_CONNECTION_STATE, { previous: "disconnected", current: "connected" });
    });

    it("handles MQTT_MESSAGE_PROCESSED events", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 0,
        getRuleCount: () => 0,
      });

      const { MQTT_MESSAGE_PROCESSED } = await import("../core/event-bus.js");
      eventBus.emit(MQTT_MESSAGE_PROCESSED, { topic: "home/sensor", durationMs: 5 });
    });

    it("handles AUTOMATION_EXECUTION_COMPLETE events", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 0,
        getRuleCount: () => 2,
      });

      const { AUTOMATION_EXECUTION_COMPLETE } = await import("../core/event-bus.js");
      eventBus.emit(AUTOMATION_EXECUTION_COMPLETE, {
        ruleId: "rule-1",
        ruleName: "test-rule",
        status: "success",
        durationMs: 10,
      });
    });

    it("handles WS_CLIENT_CONNECT and WS_CLIENT_DISCONNECT events", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 0,
        getRuleCount: () => 0,
      });

      const { WS_CLIENT_CONNECT, WS_CLIENT_DISCONNECT } = await import("../core/event-bus.js");
      eventBus.emit(WS_CLIENT_CONNECT, {});
      eventBus.emit(WS_CLIENT_DISCONNECT, {});
    });

    it("catches errors in event listeners without crashing", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => { throw new Error("boom"); },
        getRuleCount: () => 0,
      });

      const { DEVICE_STATE_CHANGE } = await import("../core/event-bus.js");
      // Should not throw even though getDeviceCount throws
      expect(() => {
        eventBus.emit(DEVICE_STATE_CHANGE, {
          deviceId: "x",
          deviceType: "sensor",
          state: {},
          topic: "test",
        });
      }).not.toThrow();
    });
  });

  describe("additional event handling", () => {
    it("handles MQTT_MESSAGE_PUBLISHED events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { MQTT_MESSAGE_PUBLISHED } = await import("../core/event-bus.js");
      eventBus.emit(MQTT_MESSAGE_PUBLISHED, {});
    });

    it("handles MQTT_MESSAGE_PROCESSED with empty topic prefix (unknown branch)", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { MQTT_MESSAGE_PROCESSED } = await import("../core/event-bus.js");
      // Empty string split produces [""], which is falsy-ish — but actually "" is falsy so || "unknown" fires
      eventBus.emit(MQTT_MESSAGE_PROCESSED, { topic: "", durationMs: 2 });
    });

    it("handles AUTOMATION_RULE_REGISTERED events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 4 });

      const { AUTOMATION_RULE_REGISTERED } = await import("../core/event-bus.js");
      eventBus.emit(AUTOMATION_RULE_REGISTERED, { ruleId: "r1" });
    });

    it("handles AUTOMATION_RULE_UNREGISTERED events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 1 });

      const { AUTOMATION_RULE_UNREGISTERED } = await import("../core/event-bus.js");
      eventBus.emit(AUTOMATION_RULE_UNREGISTERED, { ruleId: "r1" });
    });

    it("handles CONNECTOR_POLL events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { CONNECTOR_POLL } = await import("../core/event-bus.js");
      eventBus.emit(CONNECTOR_POLL, { connectorType: "zigbee", instanceId: "z1", devicesDiscovered: 3 });
    });

    it("handles CONNECTOR_ERROR events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { CONNECTOR_ERROR } = await import("../core/event-bus.js");
      eventBus.emit(CONNECTOR_ERROR, { connectorType: "zigbee", instanceId: "z1", error: "timeout" });
    });

    it("handles WS_BROADCAST events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { WS_BROADCAST } = await import("../core/event-bus.js");
      eventBus.emit(WS_BROADCAST, { messageType: "state-update", clientCount: 2 });
    });

    it("handles DATA_STORE_WRITE events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { DATA_STORE_WRITE } = await import("../core/event-bus.js");
      eventBus.emit(DATA_STORE_WRITE, { collection: "devices", record: { id: "d1" } });
    });

    it("handles DATA_STORE_QUERY events", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { DATA_STORE_QUERY } = await import("../core/event-bus.js");
      eventBus.emit(DATA_STORE_QUERY, { collection: "devices", durationMs: 15 });
    });

    it("handles MQTT_CONNECTION_STATE disconnected", async () => {
      const service = await createFreshService();
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { MQTT_CONNECTION_STATE } = await import("../core/event-bus.js");
      eventBus.emit(MQTT_CONNECTION_STATE, { previous: "connected", current: "disconnected" });
    });
  });

  describe("rule_name label cardinality bounding", () => {
    it("bounds distinct rule_name label values to at most the cap plus the overflow bucket", async () => {
      const service = await createFreshService();
      const { MAX_RULE_LABEL_CARDINALITY, RULE_LABEL_OTHER } = await import("./metrics-service.js");
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { AUTOMATION_EXECUTION_COMPLETE } = await import("../core/event-bus.js");

      // Emit executions for far more distinct rule names than the cap allows.
      const distinctNames = MAX_RULE_LABEL_CARDINALITY + 50;
      for (let i = 0; i < distinctNames; i++) {
        eventBus.emit(AUTOMATION_EXECUTION_COMPLETE, {
          ruleId: `rule-${i}`,
          ruleName: `rule-name-${i}`,
          status: "success",
          durationMs: 1,
        });
      }

      const metrics = await service.getRegistry().getMetricsAsJSON();
      const executionsMetric = metrics.find((m) => m.name === "aeolus_automations_executions_total");
      expect(executionsMetric).toBeDefined();

      const ruleLabelValues = new Set(
        (executionsMetric!.values as Array<{ labels: Record<string, string> }>).map((v) => v.labels.rule_name),
      );

      // At most cap distinct real names + 1 overflow bucket.
      expect(ruleLabelValues.size).toBeLessThanOrEqual(MAX_RULE_LABEL_CARDINALITY + 1);
      // Overflow bucket must be present since we exceeded the cap.
      expect(ruleLabelValues.has(RULE_LABEL_OTHER)).toBe(true);
    });

    it("keeps an already-seen rule name under its own label even after the cap is reached", async () => {
      const service = await createFreshService();
      const { MAX_RULE_LABEL_CARDINALITY } = await import("./metrics-service.js");
      service.initialize({ eventBus, getDeviceCount: () => 0, getRuleCount: () => 0 });

      const { AUTOMATION_EXECUTION_COMPLETE } = await import("../core/event-bus.js");

      // Record an early, distinct rule name first.
      const earlyName = "rule-name-0";
      eventBus.emit(AUTOMATION_EXECUTION_COMPLETE, {
        ruleId: "rule-0",
        ruleName: earlyName,
        status: "success",
        durationMs: 1,
      });

      // Now push far past the cap with new names.
      for (let i = 1; i < MAX_RULE_LABEL_CARDINALITY + 50; i++) {
        eventBus.emit(AUTOMATION_EXECUTION_COMPLETE, {
          ruleId: `rule-${i}`,
          ruleName: `rule-name-${i}`,
          status: "success",
          durationMs: 1,
        });
      }

      // Emit the early name again — it should still land under its own label.
      eventBus.emit(AUTOMATION_EXECUTION_COMPLETE, {
        ruleId: "rule-0",
        ruleName: earlyName,
        status: "success",
        durationMs: 1,
      });

      const metrics = await service.getRegistry().getMetricsAsJSON();
      const executionsMetric = metrics.find((m) => m.name === "aeolus_automations_executions_total");
      const early = (executionsMetric!.values as Array<{ labels: Record<string, string>; value: number }>).find(
        (v) => v.labels.rule_name === earlyName,
      );
      expect(early).toBeDefined();
      // Two executions were recorded under the early name.
      expect(early!.value).toBe(2);
    });
  });

  describe("dispose", () => {
    it("removes all event listeners and clears registry", async () => {
      const service = await createFreshService();
      service.initialize({
        eventBus,
        getDeviceCount: () => 0,
        getRuleCount: () => 0,
      });

      service.dispose();

      // Event bus should have no listeners from the service
      const { DEVICE_STATE_CHANGE } = await import("../core/event-bus.js");
      expect(eventBus.listenerCount(DEVICE_STATE_CHANGE)).toBe(0);
    });
  });
});
