// src/mqtt/mqtt-service.ts — MQTT broker connection and message ingestion

import mqtt, { type MqttClient, type IPublishPacket } from "mqtt";
import type { EventEmitter } from "node:events";
import { parseTopic } from "./topic-parser.js";
import { DEVICE_STATE_CHANGE, MQTT_RAW_MESSAGE, MQTT_CONNECTION_STATE, MQTT_MESSAGE_PROCESSED, MQTT_MESSAGE_PUBLISHED } from "../core/event-bus.js";
import type { NormalizedEvent } from "../core/types.js";
import type { AckMessage } from "../automations/pending-command-tracker.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import logger from "../logger.js";

export type MqttConnectionState = "disconnected" | "connecting" | "connected" | "waiting_retry";

/**
 * Sink for correlated command replies and observation state.
 *
 * Implemented by {@link PendingCommandTracker}; injected at composition so
 * MqttService has no hard dependency on the ActionExecutor (mirrors
 * ActionRouter.setMqttService()).
 */
export interface AckRouter {
  route(message: AckMessage): void;
  observeState(deviceId: string, state: Record<string, unknown>): void;
}

export interface MqttServiceConfig {
  brokerUrl: string;
  topics: string[];
  baseRetryDelayMs: number;
  maxBackoffMs: number;
  /**
   * Response-topic space Aeolus subscribes to for device acknowledgements
   * (e.g. "aeolus/acks/#"). Messages on this space are routed to the
   * PendingCommandTracker rather than emitted as ordinary device state.
   */
  ackTopicFilter?: string;
}

/**
 * Resolve the correlation id for an incoming response-topic message.
 *
 * Precedence (Req 10.5–10.8): the MQTT 5 Correlation Data property wins when
 * present; otherwise the payload `correlationId` field is used; when neither is
 * present, returns `undefined` and the message matches no pending command.
 * Exported as a pure helper for property testing.
 */
export function resolveCorrelationId(
  correlationData?: Buffer | Uint8Array,
  payloadCorrelationId?: string,
): string | undefined {
  if (correlationData !== undefined && correlationData.length > 0) {
    return Buffer.from(correlationData).toString("utf8");
  }
  if (payloadCorrelationId !== undefined && payloadCorrelationId !== "") {
    return payloadCorrelationId;
  }
  return undefined;
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
  private ackRouter?: AckRouter;
  private deviceRegistry?: DeviceRegistry;

  /**
   * Inject the sink for correlated command replies / observation state.
   * Set once at composition, mirroring ActionRouter.setMqttService().
   */
  setAckRouter(ackRouter: AckRouter): void {
    this.ackRouter = ackRouter;
  }

  /**
   * Inject the device registry for best-effort command-topic observability.
   * When set, publish() emits a debug signal when the target topic corresponds
   * to a known device — indicating an unverified device command was published
   * outside the CommandService boundary (Req 2.13).
   */
  setDeviceRegistry(registry: DeviceRegistry): void {
    this.deviceRegistry = registry;
  }

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
    const topics = [...this.config.topics];
    // Also subscribe to the acknowledgement response-topic space when configured.
    if (this.config.ackTopicFilter && !topics.includes(this.config.ackTopicFilter)) {
      topics.push(this.config.ackTopicFilter);
    }
    for (const topic of topics) {
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
    this.client.on("message", (topic: string, payload: Buffer, packet: IPublishPacket) => {
      logger.debug({ topic, payloadLength: payload.length }, "MQTT message received");
      this.handleMessage(topic, payload, packet);
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

  private handleMessage(topic: string, payload: Buffer, packet?: IPublishPacket): void {
    const start = Date.now();
    const raw = payload.toString();

    // Emit raw message for MQTT inspector
    this.eventBus.emit(MQTT_RAW_MESSAGE, { topic, payload: raw, timestamp: Date.now() });

    // Acknowledgement response-topic messages are routed to the tracker rather
    // than treated as ordinary device state (Req 10.5–10.8).
    if (this.isAckTopic(topic)) {
      this.handleAckMessage(topic, raw, packet);
      const ackDurationMs = Date.now() - start;
      this.eventBus.emit(MQTT_MESSAGE_PROCESSED, { topic, durationMs: ackDurationMs });
      return;
    }

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

    // Feed observation-only confirmation off ambient device state (Req 5.8).
    this.ackRouter?.observeState(parsed.deviceId, state);

    // Emit processing complete event for MetricsService histogram
    const durationMs = Date.now() - start;
    this.eventBus.emit(MQTT_MESSAGE_PROCESSED, { topic, durationMs });
  }

  /** True when `topic` falls within the configured ack response-topic space. */
  private isAckTopic(topic: string): boolean {
    const filter = this.config.ackTopicFilter;
    if (!filter) return false;
    // Strip an MQTT multi-level wildcard suffix ("aeolus/acks/#" → "aeolus/acks/").
    const prefix = filter.endsWith("/#") ? filter.slice(0, -1) : filter;
    return topic === prefix || topic.startsWith(prefix);
  }

  /**
   * Parse a response-topic message into an {@link AckMessage} and route it to
   * the tracker. Resolves the correlation id from the MQTT 5 Correlation Data
   * property when present, else the payload `correlationId`. Messages with no
   * resolvable correlation id are dropped for correlation (Req 10.8).
   */
  private handleAckMessage(topic: string, raw: string, packet?: IPublishPacket): void {
    if (!this.ackRouter) return;

    let payloadObject: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        payloadObject = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON ack payload — no payload correlation id available.
    }

    const correlationData = packet?.properties?.correlationData as Buffer | undefined;
    const payloadCorrelationId =
      typeof payloadObject.correlationId === "string" ? payloadObject.correlationId : undefined;
    const correlationId = resolveCorrelationId(correlationData, payloadCorrelationId);

    if (!correlationId) {
      logger.debug({ topic }, "Ack message carried no resolvable correlation id — ignored");
      return;
    }

    const message: AckMessage = {
      correlationId,
      ...(typeof payloadObject.status === "string" ? { status: payloadObject.status } : {}),
      state: payloadObject,
    };
    this.ackRouter.route(message);
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

  /**
   * Publish a message to the MQTT broker. Commands expire after 30 seconds by default.
   *
   * The optional MQTT 5 Correlation Data and Response Topic properties are set
   * only when provided, so existing callers (and callers passing only
   * `messageExpiryInterval`) are unaffected.
   */
  publish(
    topic: string,
    payload: string,
    options?: {
      messageExpiryInterval?: number;
      correlationData?: Buffer;
      responseTopic?: string;
      retain?: boolean;
    },
  ): void {
    if (!this.client || this.connectionState !== "connected") {
      throw new Error("MQTT client not connected");
    }
    const properties: mqtt.IClientPublishOptions["properties"] = {
      messageExpiryInterval: options?.messageExpiryInterval ?? 30,
    };
    if (options?.correlationData !== undefined) {
      properties.correlationData = options.correlationData;
    }
    if (options?.responseTopic !== undefined) {
      properties.responseTopic = options.responseTopic;
    }
    this.client.publish(topic, payload, { retain: options?.retain ?? false, properties }, (err) => {
      if (err) {
        logger.error({ topic, error: err.message }, "Failed to publish MQTT message");
      } else {
        logger.debug({ topic, payloadLength: payload.length }, "MQTT message published");
        this.eventBus.emit(MQTT_MESSAGE_PUBLISHED, { topic });
      }
    });

    // Best-effort observability signal for raw publishes targeting a device
    // command topic (Req 2.13). Never blocks or rejects the publish above.
    this.emitCommandTopicSignal(topic);
  }

  /**
   * Best-effort, non-blocking observability signal (Req 2.13).
   * When a device registry is available and the publish topic parses to a device
   * ID that exists in the registry, emit a debug log indicating an unverified
   * device command was published outside the CommandService boundary.
   *
   * This produces NO Command_Result and NO lifecycleState (Req 2.12).
   * A signal failure never affects the publish — the entire check is swallowed.
   */
  private emitCommandTopicSignal(topic: string): void {
    try {
      if (!this.deviceRegistry) return;
      const parsed = parseTopic(topic);
      if (!parsed) return;
      if (this.deviceRegistry.getById(parsed.deviceId)) {
        logger.debug(
          { topic },
          `Unverified device command published to ${topic}`,
        );
      }
    } catch {
      // Intentionally swallowed — signal failures must never affect the publish.
    }
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
