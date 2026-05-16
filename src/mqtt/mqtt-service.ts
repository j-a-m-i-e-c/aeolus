// src/mqtt/mqtt-service.ts — MQTT broker connection and message ingestion

import mqtt, { type MqttClient } from "mqtt";
import type { EventEmitter } from "node:events";
import { parseTopic } from "./topic-parser.js";
import { DEVICE_STATE_CHANGE, MQTT_RAW_MESSAGE, MQTT_CONNECTION_STATE } from "../core/event-bus.js";
import type { NormalizedEvent } from "../core/types.js";
import logger from "../logger.js";

export type MqttConnectionState = "disconnected" | "connecting" | "connected" | "waiting_retry";

export interface MqttServiceConfig {
  brokerUrl: string;
  topics: string[];
  baseRetryDelayMs: number;
  maxBackoffMs: number;
}

const DEFAULT_CONFIG: Partial<MqttServiceConfig> = {
  baseRetryDelayMs: 1000,
  maxBackoffMs: 30000,
};

/**
 * Compute exponential backoff delay for a given attempt.
 * Returns min(baseDelayMs × 2^(attempt-1), maxDelayMs).
 * Exported for testing.
 */
export function computeRetryDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
}

export class MqttService {
  private client: MqttClient | null = null;
  private config: MqttServiceConfig;
  private eventBus: EventEmitter;
  private connectionState: MqttConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private credentials: { username?: string; password?: string } | null = null;

  constructor(config: Partial<MqttServiceConfig> & Pick<MqttServiceConfig, "brokerUrl" | "topics">, eventBus: EventEmitter) {
    this.config = { ...DEFAULT_CONFIG, ...config } as MqttServiceConfig;
    this.eventBus = eventBus;
  }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    this.reconnectAttempt = 0;
    await this.attemptConnection();
  }

  private attemptConnection(): Promise<void> {
    this.setConnectionState("connecting");

    return new Promise<void>((resolve, reject) => {
      const connectOptions: mqtt.IClientOptions = {
        reconnectPeriod: 0, // We handle reconnection ourselves
        protocolVersion: 5, // MQTT 5.0 — enables message expiry, user properties, etc.
      };

      if (this.credentials) {
        connectOptions.username = this.credentials.username;
        connectOptions.password = this.credentials.password;
      }

      this.client = mqtt.connect(this.config.brokerUrl, connectOptions);

      const onConnect = () => {
        cleanup();
        this.reconnectAttempt = 0;
        this.setConnectionState("connected");
        this.subscribeToTopics();
        this.setupMessageHandler();
        this.setupDisconnectHandler();
        logger.info(
          { broker: this.config.brokerUrl, topics: this.config.topics },
          "Connected to MQTT broker"
        );
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        this.client?.end(true);
        this.client = null;
        this.setConnectionState("disconnected");
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

  private startReconnectionLoop(): void {
    if (this.intentionalDisconnect) return;

    this.reconnectAttempt++;
    const delay = computeRetryDelay(
      this.reconnectAttempt,
      this.config.baseRetryDelayMs,
      this.config.maxBackoffMs
    );

    this.setConnectionState("waiting_retry");
    logger.warn(
      { attempt: this.reconnectAttempt, delayMs: delay },
      `MQTT reconnection attempt ${this.reconnectAttempt} scheduled in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.intentionalDisconnect) return;

      try {
        await this.attemptConnection();
        logger.info(
          { attempt: this.reconnectAttempt, broker: this.config.brokerUrl },
          "MQTT reconnection successful"
        );
      } catch (err) {
        logger.error(
          { attempt: this.reconnectAttempt, error: (err as Error).message },
          `MQTT reconnection attempt ${this.reconnectAttempt} failed`
        );
        // Schedule next attempt (indefinite retries)
        this.startReconnectionLoop();
      }
    }, delay);
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
      logger.debug({ topic, payloadLength: payload.length }, "MQTT message received");
      this.handleMessage(topic, payload);
    });
  }

  private setupDisconnectHandler(): void {
    if (!this.client) return;
    this.client.on("close", () => {
      if (this.connectionState === "connected" && !this.intentionalDisconnect) {
        logger.warn("MQTT connection lost, entering reconnection loop");
        this.setConnectionState("disconnected");
        this.startReconnectionLoop();
      }
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const raw = payload.toString();

    // Emit raw message for MQTT inspector
    this.eventBus.emit(MQTT_RAW_MESSAGE, { topic, payload: raw, timestamp: Date.now() });

    const parsed = parseTopic(topic);
    if (!parsed) {
      logger.warn({ topic }, "Received message on unparseable topic");
      return;
    }

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
      name: parsed.name,
    };

    this.eventBus.emit(DEVICE_STATE_CHANGE, event);
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;

    // Cancel any pending reconnection timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    return new Promise<void>((resolve) => {
      if (!this.client) {
        this.setConnectionState("disconnected");
        resolve();
        return;
      }
      this.client.end(false, () => {
        this.client = null;
        this.setConnectionState("disconnected");
        logger.info("Disconnected from MQTT broker");
        resolve();
      });
    });
  }

  /** Update connection credentials and reconnect to the broker. Pass null to connect without auth (open mode). */
  async reconnectWithCredentials(credentials: { username?: string; password?: string } | null): Promise<void> {
    await this.disconnect();
    this.credentials = credentials;
    await this.connect();
  }

  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  getConnectionState(): MqttConnectionState {
    return this.connectionState;
  }

  /** Publish a message to the MQTT broker. Commands expire after 30 seconds by default. */
  publish(topic: string, payload: string, options?: { messageExpiryInterval?: number }): void {
    if (!this.client || this.connectionState !== "connected") {
      throw new Error("MQTT client not connected");
    }
    this.client.publish(topic, payload, {
      properties: {
        messageExpiryInterval: options?.messageExpiryInterval ?? 30,
      },
    }, (err) => {
      if (err) {
        logger.error({ topic, error: err.message }, "Failed to publish MQTT message");
      } else {
        logger.debug({ topic, payloadLength: payload.length }, "MQTT message published");
      }
    });
  }

  private setConnectionState(state: MqttConnectionState): void {
    const previous = this.connectionState;
    this.connectionState = state;
    if (previous !== state) {
      this.eventBus.emit(MQTT_CONNECTION_STATE, { previous, current: state });
      logger.debug({ previous, current: state }, "MQTT connection state changed");
    }
  }
}
