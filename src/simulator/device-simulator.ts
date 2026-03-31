// src/simulator/device-simulator.ts — Generates fake device data for demos

import type { EventEmitter } from "node:events";
import { DEVICE_STATE_CHANGE, MQTT_RAW_MESSAGE } from "../core/event-bus.js";
import type { NormalizedEvent } from "../core/types.js";
import logger from "../logger.js";

interface SimulatedDevice {
  topic: string;
  deviceId: string;
  deviceType: "light" | "sensor" | "switch" | "climate";
  generate: () => Record<string, unknown>;
  intervalMs: number;
}

// Realistic value drift for sensors
function drift(current: number, min: number, max: number, step: number): number {
  const delta = (Math.random() - 0.5) * 2 * step;
  return Math.round(Math.max(min, Math.min(max, current + delta)) * 10) / 10;
}

export class DeviceSimulator {
  private eventBus: EventEmitter;
  private timers: ReturnType<typeof setInterval>[] = [];
  private sensorState: Record<string, number> = {
    kitchenTemp: 22.0,
    bathroomHumidity: 65,
    livingTemp: 21.5,
    outdoorTemp: 15.0,
    bedroomLight: 180,
  };

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
  }

  start(): void {
    logger.info("Device simulator started — generating fake device data");

    const devices: SimulatedDevice[] = [
      {
        topic: "sensor/kitchen/temp",
        deviceId: "sensor-kitchen-temp",
        deviceType: "sensor",
        intervalMs: 5000,
        generate: () => {
          this.sensorState.kitchenTemp = drift(this.sensorState.kitchenTemp, 18, 28, 0.3);
          return { value: this.sensorState.kitchenTemp };
        },
      },
      {
        topic: "sensor/bathroom/humidity",
        deviceId: "sensor-bathroom-humidity",
        deviceType: "sensor",
        intervalMs: 7000,
        generate: () => {
          this.sensorState.bathroomHumidity = drift(this.sensorState.bathroomHumidity, 40, 90, 2);
          return { value: this.sensorState.bathroomHumidity };
        },
      },
      {
        topic: "sensor/living-room/temp",
        deviceId: "sensor-living-room-temp",
        deviceType: "sensor",
        intervalMs: 6000,
        generate: () => {
          this.sensorState.livingTemp = drift(this.sensorState.livingTemp, 19, 26, 0.2);
          return { value: this.sensorState.livingTemp };
        },
      },
      {
        topic: "sensor/outdoor/temp",
        deviceId: "sensor-outdoor-temp",
        deviceType: "sensor",
        intervalMs: 10000,
        generate: () => {
          this.sensorState.outdoorTemp = drift(this.sensorState.outdoorTemp, 5, 35, 0.5);
          return { value: this.sensorState.outdoorTemp };
        },
      },
      {
        topic: "light/bedroom",
        deviceId: "light-bedroom",
        deviceType: "light",
        intervalMs: 15000,
        generate: () => {
          this.sensorState.bedroomLight = drift(this.sensorState.bedroomLight, 0, 254, 20);
          const on = this.sensorState.bedroomLight > 50;
          return { on, brightness: Math.round(this.sensorState.bedroomLight) };
        },
      },
      {
        topic: "switch/desk",
        deviceId: "switch-desk",
        deviceType: "switch",
        intervalMs: 20000,
        generate: () => ({ on: Math.random() > 0.5 }),
      },
      {
        topic: "motion/hallway",
        deviceId: "motion-hallway",
        deviceType: "sensor",
        intervalMs: 8000,
        generate: () => ({ value: Math.random() > 0.7 }),
      },
    ];

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
}