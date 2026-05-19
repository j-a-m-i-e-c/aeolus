import { describe, it, expect, beforeEach } from "vitest";
import { ConditionRegistry, type ConditionFactory } from "./condition-registry.js";
import type { EventContext } from "../core/types.js";

describe("ConditionRegistry", () => {
  let registry: ConditionRegistry;

  beforeEach(() => {
    registry = new ConditionRegistry();
  });

  describe("registerCondition / buildCondition", () => {
    it("registers a condition factory and builds a predicate from it", () => {
      const factory: ConditionFactory = (value) => (context) =>
        Number(context.state.value) > Number(value);

      registry.registerCondition("value_above", factory);

      const predicate = registry.buildCondition("value_above", "25");
      expect(predicate).toBeDefined();
    });

    it("overwrites an existing factory when re-registering the same type", () => {
      const factoryA: ConditionFactory = () => () => true;
      const factoryB: ConditionFactory = () => () => false;

      registry.registerCondition("custom", factoryA);
      registry.registerCondition("custom", factoryB);

      const predicate = registry.buildCondition("custom", "anything");
      const context: EventContext = {
        topic: "sensors/temp1",
        deviceId: "temp1",
        state: { value: 10 },
        timestamp: Date.now(),
      };

      expect(predicate!(context)).toBe(false);
    });
  });

  describe("evaluating conditions against device state", () => {
    beforeEach(() => {
      // Register built-in condition types matching production setup
      registry.registerCondition(
        "value_above",
        (v) => (context) => Number((context.state as Record<string, unknown>).value) > Number(v),
      );
      registry.registerCondition(
        "value_below",
        (v) => (context) => Number((context.state as Record<string, unknown>).value) < Number(v),
      );
      registry.registerCondition(
        "equals",
        (v) => (context) => String((context.state as Record<string, unknown>).value) === v,
      );
    });

    it("value_above returns true when state value exceeds threshold", () => {
      const predicate = registry.buildCondition("value_above", "20");
      const context: EventContext = {
        topic: "sensors/temp1",
        deviceId: "temp1",
        state: { value: 25 },
        timestamp: Date.now(),
      };

      expect(predicate!(context)).toBe(true);
    });

    it("value_above returns false when state value is below threshold", () => {
      const predicate = registry.buildCondition("value_above", "30");
      const context: EventContext = {
        topic: "sensors/temp1",
        deviceId: "temp1",
        state: { value: 25 },
        timestamp: Date.now(),
      };

      expect(predicate!(context)).toBe(false);
    });

    it("value_below returns true when state value is under threshold", () => {
      const predicate = registry.buildCondition("value_below", "30");
      const context: EventContext = {
        topic: "sensors/humidity1",
        deviceId: "humidity1",
        state: { value: 22 },
        timestamp: Date.now(),
      };

      expect(predicate!(context)).toBe(true);
    });

    it("value_below returns false when state value exceeds threshold", () => {
      const predicate = registry.buildCondition("value_below", "10");
      const context: EventContext = {
        topic: "sensors/humidity1",
        deviceId: "humidity1",
        state: { value: 22 },
        timestamp: Date.now(),
      };

      expect(predicate!(context)).toBe(false);
    });

    it("equals returns true when state value matches string comparison", () => {
      const predicate = registry.buildCondition("equals", "on");
      const context: EventContext = {
        topic: "lights/lamp1",
        deviceId: "lamp1",
        state: { value: "on" },
        timestamp: Date.now(),
      };

      expect(predicate!(context)).toBe(true);
    });

    it("equals returns false when state value does not match", () => {
      const predicate = registry.buildCondition("equals", "on");
      const context: EventContext = {
        topic: "lights/lamp1",
        deviceId: "lamp1",
        state: { value: "off" },
        timestamp: Date.now(),
      };

      expect(predicate!(context)).toBe(false);
    });
  });

  describe("buildCondition edge cases", () => {
    it("returns undefined when type is null", () => {
      const predicate = registry.buildCondition(null, "10");
      expect(predicate).toBeUndefined();
    });

    it("returns undefined when value is null", () => {
      registry.registerCondition("value_above", (v) => (ctx) => Number(ctx.state.value) > Number(v));
      const predicate = registry.buildCondition("value_above", null);
      expect(predicate).toBeUndefined();
    });

    it("returns undefined for an unregistered condition type", () => {
      const predicate = registry.buildCondition("unknown_type", "10");
      expect(predicate).toBeUndefined();
    });
  });

  describe("unregisterCondition", () => {
    it("removes a registered condition so buildCondition returns undefined", () => {
      registry.registerCondition("custom", () => () => true);
      registry.unregisterCondition("custom");

      const predicate = registry.buildCondition("custom", "val");
      expect(predicate).toBeUndefined();
    });

    it("is a no-op when unregistering a non-existent type", () => {
      // Should not throw
      expect(() => registry.unregisterCondition("nonexistent")).not.toThrow();
    });
  });
});
