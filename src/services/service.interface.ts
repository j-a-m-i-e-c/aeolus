// src/services/service.interface.ts — Core TypeScript interfaces for the Services Framework

import type { ConfigFieldDescriptor } from "../connectors/connector.interface.js";
import type { EventEmitter } from "node:events";

/**
 * Static metadata descriptor for a Service module.
 *
 * Every service exports this as `metadata` from its `index.ts`.
 * The registry uses it to identify, categorise, and display services
 * in the dashboard without instantiating them.
 */
export interface ServiceMetadata {
  /**
   * Unique identifier for this service type.
   * Used as the `service_type` column in the SQLite `services` table
   * and as part of the synthetic topic prefix `service/{id}/{name}`.
   * @example "cron", "trigger", "system"
   */
  id: string;

  /**
   * Human-readable name shown in the dashboard service cards.
   * @example "Cron Scheduler", "API Trigger", "System Events"
   */
  displayName: string;

  /**
   * Lucide icon name rendered on the dashboard card.
   * Must correspond to a valid icon in the lucide-react package.
   * @example "clock", "webhook", "server"
   */
  icon: string;

  /**
   * Short description of what this service does.
   * Displayed beneath the display name on the service card.
   * @example "Time-based event scheduling with cron expressions"
   */
  description: string;

  /**
   * Grouping category for organising services in the dashboard.
   * @example "scheduling", "integration", "system"
   */
  category: string;
}

/**
 * The configuration schema for a service module.
 *
 * An ordered array of {@link ConfigFieldDescriptor} entries that describes
 * every configuration field the service accepts. Exported as `configSchema`
 * from each service's `index.ts`. The REST API uses this schema to validate
 * incoming config objects, and the dashboard uses it to render dynamic forms.
 *
 * Reuses the existing ConfigFieldDescriptor type from the Connector framework
 * to maintain consistency across both frameworks.
 */
export type ServiceConfigSchema = ConfigFieldDescriptor[];

/**
 * Health status reported by a running service instance.
 *
 * Every enabled service exposes its health through `getHealthStatus()`.
 * The ServiceManager surfaces this via the REST API and dashboard health
 * indicators (green for running, amber for degraded, red for stopped).
 */
export interface ServiceHealthStatus {
  /**
   * Current operational state of the service.
   * - `"running"` — the service is operating normally
   * - `"degraded"` — the service is partially functional (e.g. some schedules failed)
   * - `"stopped"` — the service has stopped due to an error or explicit stop
   */
  status: "running" | "degraded" | "stopped";

  /**
   * Unix timestamp in milliseconds of the last event emission or
   * meaningful activity performed by this service.
   */
  lastActivity: number;

  /**
   * Human-readable error message explaining why the service is not
   * fully running. Present when `status` is `"degraded"` or `"stopped"`.
   * @example "Invalid cron expression in schedule 'backup'"
   */
  errorMessage?: string;
}

/**
 * Dependencies injected into the service factory function.
 *
 * Passed as the second argument to `createService(config, deps)`.
 * Contains shared infrastructure references that services need to
 * emit events and interact with the Aeolus platform.
 */
export interface ServiceDependencies {
  /**
   * The application-wide event bus used to emit `DEVICE_STATE_CHANGE`
   * events with synthetic `service/{type}/{name}` topics.
   */
  eventBus: EventEmitter;
}

/**
 * A running service instance with lifecycle methods.
 *
 * Instances are created by the module's `createService(config, deps)` factory
 * function and managed by the ServiceManager. The manager calls lifecycle
 * methods in this order:
 *
 * 1. `start()` — initialise and begin producing events
 * 2. `onConfigUpdate(config)` — apply runtime config changes
 * 3. `stop()` — cease event production
 * 4. `dispose()` — release all resources
 */
export interface ServiceInstance {
  /**
   * Initialise the service and begin producing events.
   *
   * Called once when the service is enabled or restored from the store.
   * Should set up any timers, listeners, or connections needed to
   * produce events. Throws on failure — the ServiceManager catches
   * the error and sets health to "stopped".
   */
  start(): Promise<void>;

  /**
   * Stop event production gracefully.
   *
   * Called when the service is disabled or the system is shutting down.
   * Should cancel timers and stop producing events, but does not need
   * to release all resources — that is handled by `dispose()`.
   */
  stop(): Promise<void>;

  /**
   * Release all resources held by this service.
   *
   * Called after `stop()` when the service is being permanently disabled
   * or the system is shutting down. Should clean up any remaining timers,
   * event listeners, or allocated memory.
   */
  dispose(): Promise<void>;

  /**
   * Return the current health status of this service.
   *
   * Called by the ServiceManager when the REST API requests status
   * information. Should reflect the real-time operational state.
   *
   * @returns A {@link ServiceHealthStatus} object with the current state.
   */
  getHealthStatus(): ServiceHealthStatus;

  /**
   * Apply updated configuration at runtime.
   *
   * Called when configuration is updated via `PATCH /api/services/:id`.
   * The service should apply the new configuration without requiring
   * a full stop/start cycle where possible.
   *
   * @param config - The updated configuration object.
   */
  onConfigUpdate(config: Record<string, unknown>): void;

  /**
   * Return a read-only snapshot of the service's current state.
   *
   * Exposed through the Sandbox Services API via `services.get(type)`.
   * Returns service-specific data (e.g. cron schedules with next fire
   * times, trigger counts, uptime information).
   *
   * @returns A plain object containing the service's queryable state,
   *   or `undefined` if the service has no queryable state.
   */
  getState?(): Record<string, unknown>;
}

/**
 * The standard export shape for a service module.
 *
 * Every `src/services/{name}/index.ts` must export these three members.
 * The {@link ServiceRegistry} validates this shape at registration time —
 * modules missing any of the three exports are skipped with a warning.
 *
 * @example
 * ```typescript
 * // src/services/my-service/index.ts
 * export const metadata: ServiceMetadata = { ... };
 * export const configSchema: ServiceConfigSchema = [ ... ];
 * export function createService(
 *   config: Record<string, unknown>,
 *   deps: ServiceDependencies,
 * ): ServiceInstance {
 *   return new MyServiceInstance(config, deps);
 * }
 * ```
 */
export interface ServiceModule {
  /** Static metadata describing this service type. */
  metadata: ServiceMetadata;

  /** Configuration schema used for form rendering and validation. */
  configSchema: ServiceConfigSchema;

  /**
   * Factory function that creates a new service instance.
   *
   * Called by the ServiceManager when a service is enabled.
   * The config object contains values matching the `configSchema` fields,
   * with defaults applied for optional fields the user did not provide.
   *
   * @param config - Configuration object with keys matching `configSchema` field ids.
   * @param deps - Shared dependencies including the event bus.
   * @returns A new {@link ServiceInstance} ready to be started.
   */
  createService(
    config: Record<string, unknown>,
    deps: ServiceDependencies,
  ): ServiceInstance;
}

/**
 * Persisted record for a service instance in the SQLite `services` table.
 *
 * Used by the ServiceStore to save and restore service state across restarts.
 * The `config` field is stored as a JSON string in the database and
 * deserialised on load.
 */
export interface ServiceRecord {
  /**
   * Unique instance identifier (UUID).
   * Serves as the PRIMARY KEY in the `services` table.
   */
  id: string;

  /**
   * The service type identifier, matching {@link ServiceMetadata.id}.
   * Used to look up the correct {@link ServiceModule} in the registry
   * when restoring from the store.
   * @example "cron", "trigger", "system"
   */
  serviceType: string;

  /**
   * Whether this service instance is enabled.
   * `true` means the ServiceManager should instantiate and start it
   * on startup. `false` means the config is preserved but the service
   * is not active.
   */
  enabled: boolean;

  /**
   * Configuration object with keys matching the service's
   * {@link ServiceConfigSchema} field ids.
   * Stored as a JSON string in the database.
   */
  config: Record<string, unknown>;

  /**
   * Unix timestamp in milliseconds when this record was first created.
   */
  createdAt: number;

  /**
   * Unix timestamp in milliseconds when this record was last updated.
   * Updated on config changes and enable/disable transitions.
   */
  updatedAt: number;
}

/**
 * Runtime information about an enabled service instance.
 *
 * Returned by `ServiceManager.listEnabled()` and surfaced through
 * `GET /api/services`. Combines metadata, live health data, and
 * configuration into a single API-friendly shape.
 */
export interface ServiceInstanceInfo {
  /**
   * Unique instance identifier (UUID).
   * Generated when the service is first enabled and used as the
   * primary key in the `services` SQLite table.
   */
  id: string;

  /**
   * The service type identifier, matching {@link ServiceMetadata.id}.
   * @example "cron", "trigger", "system"
   */
  serviceType: string;

  /**
   * Human-readable display name from the service's metadata.
   * @example "Cron Scheduler", "API Trigger"
   */
  displayName: string;

  /**
   * Lucide icon name from the service's metadata.
   * @example "clock", "webhook", "server"
   */
  icon: string;

  /**
   * Current configuration for this instance.
   */
  config: Record<string, unknown>;

  /**
   * Current health status of this service instance.
   * Updated after start/stop events and on health queries.
   */
  health: ServiceHealthStatus;

  /**
   * Whether this service instance is currently enabled.
   * Disabled services retain their config in the store but are not
   * running or producing events.
   */
  enabled: boolean;
}
