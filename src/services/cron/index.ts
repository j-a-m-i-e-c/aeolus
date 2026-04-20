// src/services/cron/index.ts — Cron Scheduler service module

import cron from "node-cron";
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
import logger from "../../logger.js";

/** Static metadata for the Cron Scheduler service. */
export const metadata: ServiceMetadata = {
  id: "cron",
  displayName: "Cron Scheduler",
  icon: "clock",
  description: "Time-based event scheduling with cron expressions",
  category: "scheduling",
};

/** Configuration schema — schedules field accepts a JSON array. */
export const configSchema: ServiceConfigSchema = [
  {
    id: "schedules",
    label: "Schedules",
    type: "text",
    required: false,
    default: "[]",
    helpText: "JSON array of { name, cron } schedule objects",
  },
];

/** Shape of a single schedule entry in the config. */
interface ScheduleEntry {
  name: string;
  cron: string;
}

/**
 * Running instance of the Cron Scheduler service.
 *
 * Manages named cron schedules and emits `service/cron/{scheduleName}`
 * events on the event bus when each schedule fires.
 */
export class CronServiceInstance implements ServiceInstance {
  private tasks = new Map<string, cron.ScheduledTask>();
  private schedules: ScheduleEntry[] = [];
  private lastActivity = 0;
  private running = false;
  private readonly eventBus: ServiceDependencies["eventBus"];
  private config: Record<string, unknown>;

  constructor(config: Record<string, unknown>, deps: ServiceDependencies) {
    this.config = config;
    this.eventBus = deps.eventBus;
  }

  async start(): Promise<void> {
    this.schedules = this.parseSchedules(this.config);
    this.registerSchedules();
    this.running = true;
  }

  async stop(): Promise<void> {
    this.stopAllTasks();
    this.running = false;
  }

  async dispose(): Promise<void> {
    this.stopAllTasks();
    this.running = false;
  }

  getHealthStatus(): ServiceHealthStatus {
    return {
      status: this.running ? "running" : "stopped",
      lastActivity: this.lastActivity,
    };
  }

  onConfigUpdate(config: Record<string, unknown>): void {
    this.config = { ...this.config, ...config };
    this.stopAllTasks();
    this.schedules = this.parseSchedules(this.config);
    this.registerSchedules();
  }

  getState(): Record<string, unknown> {
    return {
      schedules: this.schedules.map((s) => ({
        name: s.name,
        cron: s.cron,
        active: this.tasks.has(s.name),
      })),
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private parseSchedules(config: Record<string, unknown>): ScheduleEntry[] {
    let raw = config.schedules;

    // If schedules is a string, try to parse it as JSON
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        logger.warn("Cron service: failed to parse schedules JSON string");
        return [];
      }
    }

    if (!Array.isArray(raw)) return [];

    return raw.filter(
      (entry: unknown): entry is ScheduleEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ScheduleEntry).name === "string" &&
        typeof (entry as ScheduleEntry).cron === "string",
    );
  }

  private registerSchedules(): void {
    for (const schedule of this.schedules) {
      if (!cron.validate(schedule.cron)) {
        logger.warn(
          { scheduleName: schedule.name, cronExpression: schedule.cron },
          "Cron service: invalid cron expression — skipping schedule",
        );
        continue;
      }

      const task = cron.schedule(schedule.cron, () => {
        const firedAt = Date.now();
        this.lastActivity = firedAt;

        const event: NormalizedEvent = {
          deviceId: "service-cron",
          deviceType: "sensor",
          state: {
            scheduleName: schedule.name,
            cronExpression: schedule.cron,
            firedAt,
          },
          topic: `service/cron/${schedule.name}`,
          timestamp: firedAt,
          integration: "service",
        };

        this.eventBus.emit(DEVICE_STATE_CHANGE, event);
      });

      this.tasks.set(schedule.name, task);
    }
  }

  private stopAllTasks(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }
}

/**
 * Factory function that creates a new CronServiceInstance.
 */
export function createService(
  config: Record<string, unknown>,
  deps: ServiceDependencies,
): ServiceInstance {
  return new CronServiceInstance(config, deps);
}

/** Assembled service module for registry registration. */
const cronModule: ServiceModule = { metadata, configSchema, createService };
export default cronModule;
