// src/automations/condition-registry.ts — Factory registry for condition predicates

import type { EventContext } from "../core/types.js";
import logger from "../logger.js";

/** A factory that builds a condition predicate from a condition_value string. */
export type ConditionFactory = (conditionValue: string) => (ctx: EventContext) => boolean;

/**
 * Registry for condition factories, keyed by condition type string.
 *
 * At bootstrap the built-in condition types (value_above, value_below, equals)
 * are registered. Connectors can register additional factories at enable time
 * and unregister them when disabled.
 */
export class ConditionRegistry {
  private factories = new Map<string, ConditionFactory>();

  /** Register a factory for a condition type. Overwrites if already registered. */
  registerCondition(type: string, factory: ConditionFactory): void {
    this.factories.set(type, factory);
  }

  /** Unregister a condition factory. No-op if not registered. */
  unregisterCondition(type: string): void {
    this.factories.delete(type);
  }

  /** Build a condition predicate. Returns undefined if type/value are null or type is unregistered. */
  buildCondition(type: string | null, value: string | null): ((ctx: EventContext) => boolean) | undefined {
    if (!type || !value) return undefined;

    const factory = this.factories.get(type);
    if (!factory) {
      logger.warn({ conditionType: type }, `No factory for condition type: ${type}`);
      return undefined;
    }

    return factory(value);
  }
}
