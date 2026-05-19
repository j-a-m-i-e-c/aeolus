// src/automations/rule-registry.test.ts — Unit tests for RuleRegistry add, remove, retrieve

import { describe, it, expect, beforeEach } from "vitest";
import { RuleRegistry } from "./rule-registry.js";
import type { Rule } from "../core/types.js";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    topic: "home/sensor/temperature",
    action: () => {},
    ...overrides,
  };
}

describe("RuleRegistry", () => {
  let registry: RuleRegistry;

  beforeEach(() => {
    registry = new RuleRegistry();
  });

  describe("register", () => {
    it("adds a rule that can be retrieved by ID", () => {
      const rule = makeRule({ id: "test-rule" });
      registry.register(rule);

      expect(registry.getRule("test-rule")).toBe(rule);
    });

    it("increments the size when a new rule is added", () => {
      expect(registry.size).toBe(0);

      registry.register(makeRule({ id: "r1" }));
      expect(registry.size).toBe(1);

      registry.register(makeRule({ id: "r2" }));
      expect(registry.size).toBe(2);
    });

    it("overwrites an existing rule with the same ID", () => {
      const original = makeRule({ id: "dup", name: "Original" });
      const replacement = makeRule({ id: "dup", name: "Replacement" });

      registry.register(original);
      registry.register(replacement);

      expect(registry.size).toBe(1);
      expect(registry.getRule("dup")).toBe(replacement);
    });
  });

  describe("unregister", () => {
    it("removes a registered rule and returns true", () => {
      const rule = makeRule({ id: "to-remove" });
      registry.register(rule);

      const result = registry.unregister("to-remove");

      expect(result).toBe(true);
      expect(registry.getRule("to-remove")).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it("returns false when removing a non-existent rule", () => {
      const result = registry.unregister("does-not-exist");
      expect(result).toBe(false);
    });
  });

  describe("getRule", () => {
    it("returns the rule when it exists", () => {
      const rule = makeRule({ id: "existing" });
      registry.register(rule);

      expect(registry.getRule("existing")).toBe(rule);
    });

    it("returns undefined for a non-existent rule ID", () => {
      expect(registry.getRule("non-existent")).toBeUndefined();
    });
  });

  describe("listRules", () => {
    it("returns an empty array when no rules are registered", () => {
      expect(registry.listRules()).toEqual([]);
    });

    it("returns all registered rules", () => {
      const r1 = makeRule({ id: "r1" });
      const r2 = makeRule({ id: "r2" });
      const r3 = makeRule({ id: "r3" });

      registry.register(r1);
      registry.register(r2);
      registry.register(r3);

      const rules = registry.listRules();
      expect(rules).toHaveLength(3);
      expect(rules).toContain(r1);
      expect(rules).toContain(r2);
      expect(rules).toContain(r3);
    });
  });
});
