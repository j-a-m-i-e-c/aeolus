// src/services/trigger/index.ts — API Trigger service module

import { DEVICE_STATE_CHANGE } from "../../core/event-bus.js";
import type { NormalizedEvent } from "../../core/types.js";
import type {
  ServiceConfigSchema,
  ServiceDependencies,
  ServiceHealthStatus,
  ServiceInstance,
  ServiceMetadata,
  ServiceModule,
} from "../service.interface.js";

/** Static metadata for the API Trigger service. */
export const metadata: ServiceMetadata = {
  id: "trigger",
  displayName: "API Trigger",
  icon: "webhook",
  description: "Fire automation events via HTTP requests",
  category: "integration",
};

/** No configuration needed for the trigger service. */
export const configSchema: ServiceConfigSchema = [];

/**
 * Running instance of the API Trigger service.
 *
 * Exposes an `emitTrigger(name, body)` method that the route handler
 * calls to emit `service/trigger/{name}` events on the event bus.
 * Tracks trigger count and last trigger timestamp.
 */
export class TriggerServiceInstance implements ServiceInstance {
  private triggerCount = 0;
  private lastTriggerAt = 0;
  private running = false;
  private readonly eventBus: ServiceDependencies["eventBus"];

  constructor(_config: Record<string, unknown>, deps: ServiceDependencies) {
    this.eventBus = deps.eventBus;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async dispose(): Promise<void> {
    this.running = false;
  }

  getHealthStatus(): ServiceHealthStatus {
    return {
      status: "running",
      lastActivity: this.lastTriggerAt,
    };
  }

  onConfigUpdate(_config: Record<string, unknown>): void {
    // No config to update
  }

  getState(): Record<string, unknown> {
    return {
      triggerCount: this.triggerCount,
      lastTriggerAt: this.lastTriggerAt,
    };
  }

  /**
   * Emit a trigger event on the event bus.
   *
   * Called by the route handler for `POST /api/services/trigger/{name}`.
   *
   * @param name - The trigger name, used in the topic `service/trigger/{name}`.
   * @param body - Optional request body included as `payload` in the event state.
   */
  emitTrigger(name: string, body?: Record<string, unknown>): void {
    const firedAt = Date.now();
    this.triggerCount++;
    this.lastTriggerAt = firedAt;

    const event: NormalizedEvent = {
      deviceId: "service-trigger",
      deviceType: "sensor",
      state: {
        triggerName: name,
        payload: body ?? {},
        firedAt,
      },
      topic: `service/trigger/${name}`,
      timestamp: firedAt,
      integration: "service",
    };

    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }
}

/**
 * Factory function that creates a new TriggerServiceInstance.
 */
export function createService(
  config: Record<string, unknown>,
  deps: ServiceDependencies,
): ServiceInstance {
  return new TriggerServiceInstance(config, deps);
}

/** Assembled service module for registry registration. */
const triggerModule: ServiceModule = { metadata, configSchema, createService };
export default triggerModule;
