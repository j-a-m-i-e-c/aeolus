// src/simulator/device-simulator.ts — Generates fake device data for demos

import { readFileSync } from "node:fs";
import type { EventEmitter } from "node:events";
import { DEVICE_STATE_CHANGE, MQTT_RAW_MESSAGE } from "../core/event-bus.js";
import type { NormalizedEvent } from "../core/types.js";
import logger from "../logger.js";

/** JSON config schema for a simulated device */
export interface SimDeviceConfig {
  topic: string;
  deviceId: string;
  deviceType: string;
  intervalMs: number;
  generator: GeneratorConfig;
}

export type GeneratorConfig =
  | { type: "drift"; min: number; max: number; step: number; initial: number; key?: string }
  | { type: "toggle"; key?: string }
  | { type: "random_boolean"; probability?: number; key?: string };

interface SimulatedDevice {
  topic: string;
  deviceId: string;
  deviceType: string;
  generate: () => Record<string, unknown>;
  intervalMs: number;
}

// Realistic value drift for sensors
function drift(current: number, min: number, max: number, step: number): number {
  const delta = (Math.random() - 0.5) * 2 * step;
  return Math.round(Math.max(min, Math.min(max, current + delta)) * 10) / 10;
}

/** Build a generate function from a GeneratorConfig */
function buildGenerator(config: GeneratorConfig): (() => Record<string, unknown>) | undefined {
  const key = config.key ?? "value";

  switch (config.type) {
    case "drift": {
      let current = config.initial;
      return () => {
        current = drift(current, config.min, config.max, config.step);
        return { [key]: current };
      };
    }
    case "toggle": {
      let on = false;
      return () => {
        on = !on;
        return { [key]: on };
      };
    }
    case "random_boolean": {
      const probability = config.probability ?? 0.5;
      return () => ({ [key]: Math.random() < probability });
    }
    default:
      return undefined;
  }
}

export class DeviceSimulator {
  private eventBus: EventEmitter;
  private configPath: string;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(eventBus: EventEmitter, configPath: string) {
    this.eventBus = eventBus;
    this.configPath = configPath;
  }

  /** Read and parse the JSON config file. Returns [] if missing or invalid. */
  loadConfig(): SimDeviceConfig[] {
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.devices)) {
        logger.warn({ configPath: this.configPath }, "Simulator config missing 'devices' array — starting with zero devices");
        return [];
      }
      return parsed.devices as SimDeviceConfig[];
    } catch (err) {
      logger.warn({ configPath: this.configPath, error: (err as Error).message }, "Failed to load simulator config — starting with zero devices");
      return [];
    }
  }

  start(): void {
    logger.info("Device simulator started — generating fake device data");

    const configs = this.loadConfig();
    const devices: SimulatedDevice[] = [];

    for (const config of configs) {
      const generate = buildGenerator(config.generator);
      if (!generate) {
        logger.warn({ topic: config.topic, generatorType: (config.generator as any).type }, "Unknown generator type — skipping device");
        continue;
      }
      devices.push({
        topic: config.topic,
        deviceId: config.deviceId,
        deviceType: config.deviceType,
        intervalMs: config.intervalMs,
        generate,
      });
    }

    for (const device of devices) {
      // Emit initial state immediately
      this.emit(device);

      // Then on interval
      const timer = setInterval(() => this.emit(device), device.intervalMs);
      this.timers.push(timer);
    }
  }

  private emit(device: SimulatedDevice): void {
    const state = device.generate();
    const payload = JSON.stringify(state);

    // Emit raw MQTT message for inspector
    this.eventBus.emit(MQTT_RAW_MESSAGE, {
      topic: device.topic,
      payload,
      timestamp: Date.now(),
    });

    // Emit normalized event for device registry + automations
    const event: NormalizedEvent = {
      deviceId: device.deviceId,
      deviceType: device.deviceType,
      state,
      topic: device.topic,
      timestamp: Date.now(),
    };
    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    logger.info("Device simulator stopped");
  }

  isRunning(): boolean {
    return this.timers.length > 0;
  }
}
