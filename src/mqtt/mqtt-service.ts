// src/mqtt/mqtt-service.ts — MQTT broker connection and message ingestion

import mqtt, { type MqttClient } from "mqtt";
import type { EventEmitter } from "node:events";
import { parseTopic } from "./topic-parser.js";
import { DEVICE_STATE_CHANGE } from "../core/event-bus.js";
import type { NormalizedEvent } from "../core/types.js";
import logger from "../logger.js";

export interface MqttServiceConfig {
  brokerUrl: string;
  topics: string[];
  maxRetries: number;
  baseRetryDelayMs: number;
}

const DEFAULT_CONFIG: Partial<MqttServiceConfig> = {
  maxRetries: 5,
  baseRetryDelayMs: 1000,
};

/**
 * Compute exponential backoff delay for a given attempt.
 * Exported for testing.
 */
export function computeRetryDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

export class MqttService {
  private client: MqttClient | null = null;
  private config: MqttServiceConfig;
  private eventBus: EventEmitter;
  private connected = false;

  constructor(config: Partial<MqttServiceConfig> & Pick<MqttServiceConfig, "brokerUrl" | "topics">, eventBus: EventEmitter) {
    this.config = { ...DEFAULT_CONFIG, ...config } as MqttServiceConfig;
    this.eventBus = eventBus;
  }

  async connect(): Promise<void> {
    let attempt = 0;

    while (attempt < this.config.maxRetries) {
      attempt++;
      try {
        await this.tryConnect();
        logger.info(
          { broker: this.config.brokerUrl, topics: this.config.topics },
          "Connected to MQTT broker"
        );
        return;
      } catch (err) {
        const delay = computeRetryDelay(attempt, this.config.baseRetryDelayMs);
        logger.warn(
          { attempt, maxRetries: this.config.maxRetries, delay, error: (err as Error).message },
          `MQTT connection attempt ${attempt} failed, retrying in ${delay}ms`
        );
        if (attempt >= this.config.maxRetries) {
          throw new Error(`Failed to connect to MQTT broker after ${this.config.maxRetries} attempts`);
        }
        await this.sleep(delay);
      }
    }
  }

  private tryConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client = mqtt.connect(this.config.brokerUrl, {
        reconnectPeriod: 0, // We handle reconnection ourselves
      });

      const onConnect = () => {
        this.connected = true;
        this.subscribeToTopics();
        this.setupMessageHandler();
        this.setupDisconnectHandler();
        cleanup();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        this.client?.end(true);
        this.client = null;
        reject(err);
      };

      const cleanup = () => {
        this.client?.removeListener("connect", onConnect);
        this.client?.removeListener("error", onError);
      };

      this.client.on("connect", onConnect);
      this.client.on("error", onError);
    });
  }

  private subscribeToTopics(): void {
    if (!this.client) return;
    for (const topic of this.config.topics) {
      this.client.subscribe(topic, (err) => {
        if (err) {
          logger.error({ topic, error: err.message }, "Failed to subscribe to topic");
        } else {
          logger.debug({ topic }, "Subscribed to MQTT topic");
        }
      });
    }
  }

  private setupMessageHandler(): void {
    if (!this.client) return;
    this.client.on("message", (topic: string, payload: Buffer) => {
      this.handleMessage(topic, payload);
    });
  }

  private setupDisconnectHandler(): void {
    if (!this.client) return;
    this.client.on("close", () => {
      if (this.connected) {
        this.connected = false;
        logger.warn("MQTT connection lost, attempting reconnection");
        this.connect().catch((err) => {
          logger.error({ error: (err as Error).message }, "MQTT reconnection failed");
        });
      }
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const parsed = parseTopic(topic);
    if (!parsed) {
      logger.warn({ topic }, "Received message on unparseable topic");
      return;
    }

    const raw = payload.toString();
    let state: Record<string, unknown>;

    try {
      const jsonValue = JSON.parse(raw);
      if (typeof jsonValue === "object" && jsonValue !== null && !Array.isArray(jsonValue)) {
        state = jsonValue;
      } else {
        state = { value: jsonValue };
      }
    } catch {
      // Not JSON — try as number or plain string
      const num = Number(raw);
      if (!isNaN(num) && raw.trim().length > 0) {
        state = { value: num };
      } else if (raw.trim().length > 0) {
        state = { value: raw.trim() };
      } else {
        logger.warn({ topic, payload: raw }, "Received empty or unparseable payload");
        return;
      }
    }

    const event: NormalizedEvent = {
      deviceId: parsed.deviceId,
      deviceType: parsed.deviceType,
      state,
      topic,
      timestamp: Date.now(),
    };

    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    return new Promise<void>((resolve) => {
      if (!this.client) {
        resolve();
        return;
      }
      this.client.end(false, () => {
        this.client = null;
        logger.info("Disconnected from MQTT broker");
        resolve();
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}