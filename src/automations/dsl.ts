// src/automations/dsl.ts — when/if/then automation DSL

import { randomUUID } from "node:crypto";
import type { Rule, EventContext } from "../core/types.js";

/** Builder for constructing automation rules */
class RuleBuilder {
  private topic: string;
  private conditionFn?: (context: EventContext) => boolean;

  constructor(topic: string) {
    this.topic = topic;
  }

  /** Add a condition that must be true for the action to execute */
  if(condition: (context: EventContext) => boolean): RuleBuilder {
    this.conditionFn = condition;
    return this;
  }

  /** Define the action to execute when the rule triggers */
  then(action: (context: EventContext) => void | Promise<void>, name?: string): Rule {
    return {
      id: randomUUID(),
      topic: this.topic,
      condition: this.conditionFn,
      action,
      name,
    };
  }
}

/** Entry point for the automation DSL */
export function when(topic: string): RuleBuilder {
  return new RuleBuilder(topic);
}