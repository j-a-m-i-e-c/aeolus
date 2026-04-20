// src/services/service-manager.ts — Lifecycle management for enabled service instances

import crypto from "node:crypto";
import type { EventEmitter } from "node:events";
import type {
  ServiceInstance,
  ServiceInstanceInfo,
  ServiceRecord,
} from "./service.interface.js";
import type { ServiceRegistry } from "./service-registry.js";
import type { ServiceStore } from "./service-store.js";
import logger from "../logger.js";

/** Internal tracking state for a single enabled service instance. */
interface ManagedServiceInstance {
  instance: ServiceInstance;
  record: ServiceRecord;
}

/**
 * Manages the full lifecycle of enabled service instances.
 *
 * Responsibilities:
 * - Enable / disable services at runtime
 * - Persist state through ServiceStore
 * - Restore previously enabled services on startup
 * - Expose running instances for sandbox queries
 *
 * Mirrors ConnectorManager but simpler — no device discovery,
 * no polling, no action routing. Services are event producers only.
 */
export class ServiceManager {
  private instances = new Map<string, ManagedServiceInstance>();

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly store: ServiceStore,
    private readonly eventBus: EventEmitter,
  ) {}

  /**
   * Enable a service: look up module in registry, instantiate via factory,
   * call start(), persist to store, and track the instance.
   *
   * On start() failure: mark health as "stopped", log error, but still
   * persist the record so the user can retry later.
   *
   * @returns The generated instance UUID.
   */
  async enable(
    serviceType: string,
    config: Record<string, unknown>,
  ): Promise<string> {
    const mod = this.registry.getModule(serviceType);
    if (!mod) {
      throw new Error(`Service type '${serviceType}' not found in registry`);
    }

    const instance = mod.createService(config, { eventBus: this.eventBus });
    const instanceId = crypto.randomUUID();
    const now = Date.now();

    const record: ServiceRecord = {
      id: instanceId,
      serviceType,
      enabled: true,
      config,
      createdAt: now,
      updatedAt: now,
    };

    // Attempt start — on failure, mark stopped but keep instance for retry
    try {
      await instance.start();
    } catch (err) {
      logger.error(
        { serviceType, instanceId, error: (err as Error).message },
        "Service start() failed during enable",
      );
    }

    // Persist to store
    this.store.save(record);

    // Track instance
    this.instances.set(instanceId, { instance, record });

    logger.info({ serviceType, instanceId }, "Service enabled");

    return instanceId;
  }

  /**
   * Disable a service: stop, dispose, update store to disabled,
   * and remove from tracked instances.
   */
  async disable(instanceId: string): Promise<void> {
    const managed = this.instances.get(instanceId);
    if (!managed) {
      throw new Error(`Service instance '${instanceId}' not found`);
    }

    try {
      await managed.instance.stop();
    } catch (err) {
      logger.error(
        { instanceId, error: (err as Error).message },
        "Error during service stop",
      );
    }

    try {
      await managed.instance.dispose();
    } catch (err) {
      logger.error(
        { instanceId, error: (err as Error).message },
        "Error during service dispose",
      );
    }

    // Update store (disable, don't delete)
    this.store.disable(instanceId);

    this.instances.delete(instanceId);

    logger.info(
      { instanceId, serviceType: managed.record.serviceType },
      "Service disabled",
    );
  }

  /**
   * Update configuration on a running service instance.
   * Calls onConfigUpdate() on the instance, merges config, and persists.
   */
  async updateConfig(
    instanceId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const managed = this.instances.get(instanceId);
    if (!managed) {
      throw new Error(`Service instance '${instanceId}' not found`);
    }

    managed.instance.onConfigUpdate(config);

    // Merge and persist
    managed.record.config = { ...managed.record.config, ...config };
    managed.record.updatedAt = Date.now();
    this.store.save(managed.record);

    logger.info({ instanceId }, "Service config updated");
  }

  /**
   * Retry starting a stopped service instance.
   */
  async retry(instanceId: string): Promise<void> {
    const managed = this.instances.get(instanceId);
    if (!managed) {
      throw new Error(`Service instance '${instanceId}' not found`);
    }

    try {
      await managed.instance.start();
    } catch (err) {
      logger.error(
        { instanceId, error: (err as Error).message },
        "Service retry start() failed",
      );
    }

    logger.info({ instanceId }, "Service retry completed");
  }

  /**
   * Return ServiceInstanceInfo[] for all tracked (enabled) instances.
   */
  listEnabled(): ServiceInstanceInfo[] {
    const result: ServiceInstanceInfo[] = [];

    for (const [id, managed] of this.instances) {
      const mod = this.registry.getModule(managed.record.serviceType);
      const health = managed.instance.getHealthStatus();

      result.push({
        id,
        serviceType: managed.record.serviceType,
        displayName: mod?.metadata.displayName ?? managed.record.serviceType,
        icon: mod?.metadata.icon ?? "zap",
        config: managed.record.config,
        health,
        enabled: true,
      });
    }

    return result;
  }

  /**
   * Return ServiceInstanceInfo for a specific instance, or undefined.
   */
  getStatus(instanceId: string): ServiceInstanceInfo | undefined {
    const managed = this.instances.get(instanceId);
    if (!managed) return undefined;

    const mod = this.registry.getModule(managed.record.serviceType);
    const health = managed.instance.getHealthStatus();

    return {
      id: instanceId,
      serviceType: managed.record.serviceType,
      displayName: mod?.metadata.displayName ?? managed.record.serviceType,
      icon: mod?.metadata.icon ?? "zap",
      config: managed.record.config,
      health,
      enabled: true,
    };
  }

  /**
   * Return the running ServiceInstance for a given service type.
   *
   * Finds by service type, not by instance ID — there's typically
   * one instance per type. Used by the sandbox services API.
   */
  getServiceInstance(serviceType: string): ServiceInstance | undefined {
    for (const managed of this.instances.values()) {
      if (managed.record.serviceType === serviceType) {
        return managed.instance;
      }
    }
    return undefined;
  }

  /**
   * Restore previously enabled services from the store on startup.
   * For each enabled record: get module from registry, instantiate,
   * call start() (catch errors → log, keep for retry).
   */
  async restoreFromStore(): Promise<void> {
    const records = this.store.loadEnabled();

    for (const record of records) {
      const mod = this.registry.getModule(record.serviceType);
      if (!mod) {
        logger.warn(
          { serviceType: record.serviceType, instanceId: record.id },
          "Service module not found in registry during restore — skipping",
        );
        continue;
      }

      const instance = mod.createService(record.config, {
        eventBus: this.eventBus,
      });

      // Attempt start
      try {
        await instance.start();
      } catch (err) {
        logger.error(
          {
            serviceType: record.serviceType,
            instanceId: record.id,
            error: (err as Error).message,
          },
          "Service start() failed during restore",
        );
      }

      this.instances.set(record.id, { instance, record });

      logger.info(
        { serviceType: record.serviceType, instanceId: record.id },
        "Service restored from store",
      );
    }
  }

  /**
   * Stop and dispose all running service instances, then clear tracking.
   */
  async disposeAll(): Promise<void> {
    for (const [instanceId, managed] of this.instances) {
      try {
        await managed.instance.stop();
      } catch (err) {
        logger.error(
          { instanceId, error: (err as Error).message },
          "Error during service stop in disposeAll",
        );
      }

      try {
        await managed.instance.dispose();
      } catch (err) {
        logger.error(
          { instanceId, error: (err as Error).message },
          "Error during service dispose in disposeAll",
        );
      }
    }

    this.instances.clear();
    logger.info("All services disposed");
  }
}
