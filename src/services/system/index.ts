// src/services/system/index.ts — System Events service module

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

/** Static metadata for the System Events service. */
export const metadata: ServiceMetadata = {
  id: "system",
  displayName: "System Events",
  icon: "server",
  description: "Emits events on system startup and shutdown",
  category: "system",
};

/** No configuration needed for the system events service. */
export const configSchema: ServiceConfigSchema = [];

/**
 * Running instance of the System Events service.
 *
 * Emits `service/system/startup` on start and `service/system/shutdown`
 * on stop. Tracks startup timestamp and reports uptime.
 */
export class SystemEventsServiceInstance implements ServiceInstance {
  private startupTimestamp = 0;
  private running = false;
  private readonly eventBus: ServiceDependencies["eventBus"];

  constructor(_config: Record<string, unknown>, deps: ServiceDependencies) {
    this.eventBus = deps.eventBus;
  }

  async start(): Promise<void> {
    this.startupTimestamp = Date.now();
    this.running = true;

    const event: NormalizedEvent = {
      deviceId: "service-system",
      deviceType: "sensor",
      state: { bootTimestamp: this.startupTimestamp },
      topic: "service/system/startup",
      timestamp: this.startupTimestamp,
      integration: "service",
    };

    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }

  async stop(): Promise<void> {
    const shutdownTimestamp = Date.now();

    const event: NormalizedEvent = {
      deviceId: "service-system",
      deviceType: "sensor",
      state: { shutdownTimestamp },
      topic: "service/system/shutdown",
      timestamp: shutdownTimestamp,
      integration: "service",
    };

    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
    this.running = false;
  }

  async dispose(): Promise<void> {
    this.running = false;
  }

  getHealthStatus(): ServiceHealthStatus {
    return {
      status: this.running ? "running" : "stopped",
      lastActivity: this.startupTimestamp,
    };
  }

  onConfigUpdate(_config: Record<string, unknown>): void {
    // No config to update
  }

  getState(): Record<string, unknown> {
    return {
      startupTimestamp: this.startupTimestamp,
      uptimeSeconds: this.running
        ? Math.floor((Date.now() - this.startupTimestamp) / 1000)
        : 0,
    };
  }
}

/**
 * Factory function that creates a new SystemEventsServiceInstance.
 */
export function createService(
  config: Record<string, unknown>,
  deps: ServiceDependencies,
): ServiceInstance {
  return new SystemEventsServiceInstance(config, deps);
}

/** Assembled service module for registry registration. */
const systemModule: ServiceModule = { metadata, configSchema, createService };
export default systemModule;
