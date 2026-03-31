// Feature: mvp-core-platform, Property 5: DSL Rule Registration
// Feature: mvp-core-platform, Property 6: Rule Registry CRUD Consistency
import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { when } from "./dsl.js";
import { RuleRegistry } from "./rule-registry.js";

const topicArb = fc.stringMatching(/^[a-z]+\/[a-z]+$/);

describe("Property: DSL Rule Registration", () => {
  test.prop([topicArb])(
    "when(topic).then(action) produces a rule with unique ID and correct topic",
    (topic) => {
      const action = () => {};
      const rule = when(topic).then(action);
      expect(rule.id).toBeDefined();
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.topic).toBe(topic);
      expect(rule.action).toBe(action);
      expect(rule.condition).toBeUndefined();
    }
  );

  test.prop([topicArb])(
    "when(topic).if(cond).then(action) includes the condition",
    (topic) => {
      const cond = () => true;
      const action = () => {};
      const rule = when(topic).if(cond).then(action);
      expect(rule.condition).toBe(cond);
      expect(rule.topic).toBe(topic);
    }
  );

  test.prop([fc.array(topicArb, { minLength: 1, maxLength: 10 })])(
    "each when() call produces a unique rule ID",
    (topics) => {
      const ids = topics.map((t) => when(t).then(() => {}).id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  );
});

describe("Property: Rule Registry CRUD Consistency", () => {
  test.prop([fc.array(topicArb, { minLength: 0, maxLength: 10 })])(
    "registered rules appear in list, removed rules do not",
    (topics) => {
      const registry = new RuleRegistry();
      const rules = topics.map((t) => when(t).then(() => {}));

      // Register all
      for (const rule of rules) {
        registry.register(rule);
      }
      expect(registry.listRules().length).toBe(rules.length);

      // Each is retrievable
      for (const rule of rules) {
        expect(registry.getRule(rule.id)).toBeDefined();
      }

      // Remove first half
      const toRemove = rules.slice(0, Math.floor(rules.length / 2));
      for (const rule of toRemove) {
        registry.unregister(rule.id);
      }

      expect(registry.listRules().length).toBe(rules.length - toRemove.length);
      for (const rule of toRemove) {
        expect(registry.getRule(rule.id)).toBeUndefined();
      }
    }
  );
});
