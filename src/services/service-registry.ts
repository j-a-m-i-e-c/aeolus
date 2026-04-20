// src/services/service-registry.ts — Registration and lookup of service modules

import logger from "../logger.js";
import type {
  ServiceModule,
  ServiceMetadata,
  ServiceConfigSchema,
} from "./service.interface.js";

/**
 * Validates that a module export has the required ServiceModule shape:
 * - `metadata` object with a string `id`
 * - `configSchema` array
 * - `createService` function
 */
function isValidServiceModule(mod: unknown): mod is ServiceModule {
  if (mod == null || typeof mod !== "object") return false;
  const m = mod as Record<string, unknown>;

  if (
    m.metadata == null ||
    typeof m.metadata !== "object" ||
    typeof (m.metadata as Record<string, unknown>).id !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(m.configSchema)) return false;

  if (typeof m.createService !== "function") return false;

  return true;
}

/**
 * Registry of available service modules.
 *
 * Supports manual registration via `register(module)`.
 * Once registered, modules are queryable via `listAvailable()` and `getModule()`.
 */
export class ServiceRegistry {
  /** Map of service type id → ServiceModule */
  private modules = new Map<string, ServiceModule>();

  /**
   * Register a service module.
   *
   * Validates the module shape before registration. Logs a warning and
   * skips invalid modules. Logs a warning and overwrites on duplicate IDs.
   *
   * @param mod - A valid ServiceModule with metadata, configSchema, and createService.
   */
  register(mod: ServiceModule): void {
    if (!isValidServiceModule(mod)) {
      logger.warn(
        { module: mod },
        "Attempted to register invalid service module — skipping",
      );
      return;
    }

    const id = mod.metadata.id;
    if (this.modules.has(id)) {
      logger.warn(
        { serviceType: id },
        "Service type already registered — overwriting",
      );
    }

    this.modules.set(id, mod);
    logger.info({ serviceType: id }, "Registered service module");
  }

  /**
   * Return all registered service types with their metadata and config schemas.
   */
  listAvailable(): Array<{
    metadata: ServiceMetadata;
    configSchema: ServiceConfigSchema;
  }> {
    return Array.from(this.modules.values()).map((mod) => ({
      metadata: mod.metadata,
      configSchema: mod.configSchema,
    }));
  }

  /**
   * Get a specific service module by its metadata id.
   *
   * @param serviceType - The unique service type identifier (e.g. "cron", "trigger").
   * @returns The ServiceModule if found, or `undefined`.
   */
  getModule(serviceType: string): ServiceModule | undefined {
    return this.modules.get(serviceType);
  }
}
