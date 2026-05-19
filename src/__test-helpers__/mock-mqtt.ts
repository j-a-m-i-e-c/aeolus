// src/__test-helpers__/mock-mqtt.ts — Mock MQTT client for integration tests

import type { EventEmitter } from "node:events";
import { MQTT_RAW_MESSAGE, DEVICE_STATE_CHANGE } from "../core/event-bus.js";
import { parseTopic } from "../mqtt/topic-parser.js";

export interface PublishedMessage {
  topic: string;
  payload: string;
  timestamp: number;
}

export interface MockMqttClient {
  /** All messages published through this mock */
  published: PublishedMessage[];

  /** Simulate an incoming MQTT message (emits on event bus) */
  simulateMessage(topic: string, payload: string): void;

  /** Publish a message (records it, does not send to broker) */
  publish(topic: string, payload: string): void;

  /** Check if connected (always true for mock) */
  isConnected(): boolean;

  /** Reset recorded messages */
  reset(): void;
}

/**
 * Create a mock MQTT client that records published messages and allows
 * simulating incoming messages via the event bus.
 *
 * The `simulateMessage` method mirrors the real MqttService.handleMessage
 * behavior: it emits MQTT_RAW_MESSAGE unconditionally, then attempts to
 * parse the topic and payload to emit DEVICE_STATE_CHANGE.
 */
export function createMockMqttClient(eventBus: EventEmitter): MockMqttClient {
  const published: PublishedMessage[] = [];

  return {
    published,

    simulateMessage(topic: string, payload: string): void {
      // Always emit raw message (mirrors real MqttService behavior)
      eventBus.emit(MQTT_RAW_MESSAGE, { topic, payload, timestamp: Date.now() });

      // Parse topic — if unparseable, stop here (mirrors real behavior)
      const parsed = parseTopic(topic);
      if (!parsed) return;

      // Parse payload using the same logic as the real MqttService
      let state: Record<string, unknown>;

      try {
        const jsonValue = JSON.parse(payload);
        if (typeof jsonValue === "object" && jsonValue !== null && !Array.isArray(jsonValue)) {
          state = jsonValue;
        } else {
          state = { value: jsonValue };
        }
      } catch {
        // Not JSON — try as number or plain string
        const num = Number(payload);
        if (!isNaN(num) && payload.trim().length > 0) {
          state = { value: num };
        } else if (payload.trim().length > 0) {
          state = { value: payload.trim() };
        } else {
          // Empty or unparseable payload — no DEVICE_STATE_CHANGE emitted
          return;
        }
      }

      eventBus.emit(DEVICE_STATE_CHANGE, {
        deviceId: parsed.deviceId,
        deviceType: parsed.deviceType,
        state,
        topic,
        timestamp: Date.now(),
        name: parsed.name,
      });
    },

    publish(topic: string, payload: string): void {
      published.push({ topic, payload, timestamp: Date.now() });
    },

    isConnected(): boolean {
      return true;
    },

    reset(): void {
      published.length = 0;
    },
  };
}
