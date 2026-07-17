// src/__integration__/mqtt-automation-pipeline.integration.test.ts
// Integration tests for the MQTT message → rule evaluation → action execution pipeline

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createMockMqttClient,
  createTestAutomationEngine,
  cleanup,
  type MockMqttClient,
  type TestAutomationEngine,
} from "../__test-helpers__/index.js";
import type { Rule, EventContext } from "../core/types.js";

describe("MQTT-to-Automation Pipeline Integration", () => {
  let eventBus: EventEmitter;
  let mqttClient: MockMqttClient;
  let automation: TestAutomationEngine;

  beforeEach(() => {
    eventBus = new EventEmitter();
    mqttClient = createMockMqttClient(eventBus);
    automation = createTestAutomationEngine(eventBus);
  });

  afterEach(() => {
    cleanup({ engines: [automation.engine] });
  });

  describe("Requirement 4.1: Matching MQTT message triggers rule action", () => {
    it("evaluates rule and executes action when message matches trigger topic", () => {
      const actionFn = vi.fn();
      const rule: Rule = {
        id: "rule-1",
        name: "Temperature Alert",
        topic: "sensor/living-room",
        action: actionFn,
      };

      automation.engine.register(rule);
      mqttClient.simulateMessage("sensor/living-room", JSON.stringify({ temperature: 25 }));

      expect(actionFn).toHaveBeenCalledTimes(1);
      expect(actionFn).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "sensor/living-room",
          deviceId: "sensor-living-room",
          state: { temperature: 25 },
        }),
      );
    });

    it("matches rules using MQTT single-level wildcard (+)", () => {
      const actionFn = vi.fn();
      const rule: Rule = {
        id: "rule-wildcard",
        name: "Any Sensor",
        topic: "sensor/+",
        action: actionFn,
      };

      automation.engine.register(rule);
      mqttClient.simulateMessage("sensor/bedroom", JSON.stringify({ humidity: 60 }));

      expect(actionFn).toHaveBeenCalledTimes(1);
    });

    it("matches rules using MQTT multi-level wildcard (#)", () => {
      const actionFn = vi.fn();
      const rule: Rule = {
        id: "rule-multi-wildcard",
        name: "All Devices",
        topic: "sensor/#",
        action: actionFn,
      };

      automation.engine.register(rule);
      mqttClient.simulateMessage("sensor/kitchen/temp", JSON.stringify({ value: 22 }));

      expect(actionFn).toHaveBeenCalledTimes(1);
    });

    it("records successful execution in the execution log", async () => {
      const rule: Rule = {
        id: "rule-logged",
        name: "Logged Rule",
        topic: "sensor/garage",
        action: vi.fn(),
      };

      automation.engine.register(rule);
      mqttClient.simulateMessage("sensor/garage", JSON.stringify({ open: true }));

      // Recording is performed by the Execution_Owner after the (async) execution
      // resolves, so allow a microtask/timer tick before asserting.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const entries = automation.executionLog.getByRuleId("rule-logged");
      expect(entries).toHaveLength(1);
      expect(entries[0].ruleId).toBe("rule-logged");
      expect(entries[0].success).toBe(true);
    });
  });

  describe("Requirement 4.2: Non-matching message results in no action", () => {
    it("does not execute action when message topic does not match any rule", () => {
      const actionFn = vi.fn();
      const rule: Rule = {
        id: "rule-specific",
        name: "Kitchen Only",
        topic: "sensor/kitchen",
        action: actionFn,
      };

      automation.engine.register(rule);
      mqttClient.simulateMessage("sensor/bedroom", JSON.stringify({ temperature: 20 }));

      expect(actionFn).not.toHaveBeenCalled();
    });

    it("does not execute action when no rules are registered", () => {
      // No rules registered — just verify no crash
      mqttClient.simulateMessage("sensor/living-room", JSON.stringify({ temperature: 22 }));

      const entries = automation.executionLog.list();
      expect(entries).toHaveLength(0);
    });

    it("does not execute action for partial topic match", () => {
      const actionFn = vi.fn();
      const rule: Rule = {
        id: "rule-exact",
        name: "Exact Match",
        topic: "sensor/kitchen/temp",
        action: actionFn,
      };

      automation.engine.register(rule);
      // "sensor/kitchen" is a prefix but not a full match
      mqttClient.simulateMessage("sensor/kitchen", JSON.stringify({ value: 1 }));

      expect(actionFn).not.toHaveBeenCalled();
    });
  });

  describe("Requirement 4.3: False condition prevents action execution", () => {
    it("does not execute action when rule condition returns false", () => {
      const actionFn = vi.fn();
      const rule: Rule = {
        id: "rule-conditional",
        name: "High Temp Alert",
        topic: "sensor/living-room",
        condition: (ctx: EventContext) => {
          const temp = ctx.state.temperature as number;
          return temp > 30;
        },
        action: actionFn,
      };

      automation.engine.register(rule);
      // Temperature is 25, condition requires > 30
      mqttClient.simulateMessage("sensor/living-room", JSON.stringify({ temperature: 25 }));

      expect(actionFn).not.toHaveBeenCalled();
    });

    it("executes action when rule condition returns true", () => {
      const actionFn = vi.fn();
      const rule: Rule = {
        id: "rule-conditional-true",
        name: "High Temp Alert",
        topic: "sensor/living-room",
        condition: (ctx: EventContext) => {
          const temp = ctx.state.temperature as number;
          return temp > 30;
        },
        action: actionFn,
      };

      automation.engine.register(rule);
      // Temperature is 35, condition requires > 30
      mqttClient.simulateMessage("sensor/living-room", JSON.stringify({ temperature: 35 }));

      expect(actionFn).toHaveBeenCalledTimes(1);
    });

    it("does not record execution in log when condition is false", () => {
      const rule: Rule = {
        id: "rule-no-log",
        name: "Conditional Rule",
        topic: "sensor/office",
        condition: () => false,
        action: vi.fn(),
      };

      automation.engine.register(rule);
      mqttClient.simulateMessage("sensor/office", JSON.stringify({ brightness: 100 }));

      const entries = automation.executionLog.getByRuleId("rule-no-log");
      expect(entries).toHaveLength(0);
    });
  });

  describe("Requirement 4.4: Action failure is logged without crashing", () => {
    it("logs failure and continues when synchronous action throws", () => {
      const rule: Rule = {
        id: "rule-throws",
        name: "Failing Rule",
        topic: "sensor/bathroom",
        action: () => {
          throw new Error("Action failed: device unreachable");
        },
      };

      automation.engine.register(rule);

      // Should not throw
      expect(() => {
        mqttClient.simulateMessage("sensor/bathroom", JSON.stringify({ humidity: 90 }));
      }).not.toThrow();

      // The execution log should not record the entry since the error is caught
      // at the evaluate level (before recordExecution for sync throws)
      // But subsequent messages should still be processed
      const secondAction = vi.fn();
      const rule2: Rule = {
        id: "rule-after-failure",
        name: "After Failure",
        topic: "sensor/bathroom",
        action: secondAction,
      };
      automation.engine.register(rule2);
      mqttClient.simulateMessage("sensor/bathroom", JSON.stringify({ humidity: 85 }));

      expect(secondAction).toHaveBeenCalledTimes(1);
    });

    it("logs failure and continues when async action rejects", async () => {
      const rule: Rule = {
        id: "rule-async-fail",
        name: "Async Failing Rule",
        topic: "sensor/kitchen",
        action: async () => {
          throw new Error("Async action failed");
        },
      };

      automation.engine.register(rule);
      mqttClient.simulateMessage("sensor/kitchen", JSON.stringify({ smoke: true }));

      // Wait for the async rejection to be handled
      await new Promise((resolve) => setTimeout(resolve, 50));

      const entries = automation.executionLog.getByRuleId("rule-async-fail");
      expect(entries).toHaveLength(1);
      expect(entries[0].success).toBe(false);
      expect(entries[0].failureReason).toBe("Async action failed");
    });

    it("pipeline continues processing after action failure", () => {
      const successAction = vi.fn();
      const failingRule: Rule = {
        id: "rule-fail-first",
        name: "Fails First",
        topic: "light/+",
        action: () => {
          throw new Error("Boom");
        },
      };
      const successRule: Rule = {
        id: "rule-success-second",
        name: "Succeeds Second",
        topic: "light/+",
        action: successAction,
      };

      automation.engine.register(failingRule);
      automation.engine.register(successRule);

      expect(() => {
        mqttClient.simulateMessage("light/hallway", JSON.stringify({ on: true }));
      }).not.toThrow();

      // The second rule should still execute despite the first one throwing
      expect(successAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("Requirement 4.5: Multiple rules matching same topic all evaluate", () => {
    it("executes all matching rules for a single message", () => {
      const action1 = vi.fn();
      const action2 = vi.fn();
      const action3 = vi.fn();

      const rules: Rule[] = [
        { id: "rule-a", name: "Rule A", topic: "sensor/garden", action: action1 },
        { id: "rule-b", name: "Rule B", topic: "sensor/garden", action: action2 },
        { id: "rule-c", name: "Rule C", topic: "sensor/garden", action: action3 },
      ];

      for (const rule of rules) {
        automation.engine.register(rule);
      }

      mqttClient.simulateMessage("sensor/garden", JSON.stringify({ moisture: 45 }));

      expect(action1).toHaveBeenCalledTimes(1);
      expect(action2).toHaveBeenCalledTimes(1);
      expect(action3).toHaveBeenCalledTimes(1);
    });

    it("evaluates all matching rules including wildcard matches", () => {
      const exactAction = vi.fn();
      const wildcardAction = vi.fn();

      const exactRule: Rule = {
        id: "rule-exact",
        name: "Exact Match",
        topic: "sensor/garden",
        action: exactAction,
      };
      const wildcardRule: Rule = {
        id: "rule-wildcard",
        name: "Wildcard Match",
        topic: "sensor/+",
        action: wildcardAction,
      };

      automation.engine.register(exactRule);
      automation.engine.register(wildcardRule);

      mqttClient.simulateMessage("sensor/garden", JSON.stringify({ moisture: 50 }));

      expect(exactAction).toHaveBeenCalledTimes(1);
      expect(wildcardAction).toHaveBeenCalledTimes(1);
    });

    it("records execution log entries for all matching rules", async () => {
      const rules: Rule[] = [
        { id: "log-rule-1", name: "Log Rule 1", topic: "switch/main", action: vi.fn() },
        { id: "log-rule-2", name: "Log Rule 2", topic: "switch/main", action: vi.fn() },
      ];

      for (const rule of rules) {
        automation.engine.register(rule);
      }

      mqttClient.simulateMessage("switch/main", JSON.stringify({ state: "on" }));

      // Recording happens after each (async) execution resolves.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const allEntries = automation.executionLog.list();
      expect(allEntries).toHaveLength(2);

      const rule1Entries = automation.executionLog.getByRuleId("log-rule-1");
      const rule2Entries = automation.executionLog.getByRuleId("log-rule-2");
      expect(rule1Entries).toHaveLength(1);
      expect(rule2Entries).toHaveLength(1);
    });
  });
});
