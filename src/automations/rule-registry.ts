// src/automations/rule-registry.ts — In-memory store for automation rules

import type { Rule } from "../core/types.js";

export class RuleRegistry {
  private rules = new Map<string, Rule>();

  /** Register a rule */
  register(rule: Rule): void {
    this.rules.set(rule.id, rule);
  }

  /** Remove a rule by ID */
  unregister(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /** Get all registered rules */
  listRules(): Rule[] {
    return Array.from(this.rules.values());
  }

  /** Get a rule by ID */
  getRule(id: string): Rule | undefined {
    return this.rules.get(id);
  }

  /** Get rule count */
  get size(): number {
    return this.rules.size;
  }
}