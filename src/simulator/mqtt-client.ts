// src/simulator/mqtt-client.ts
// phase-2-mqtt-simulator Task 1 — the simulator's MQTT client wrapper.
//
// A self-contained MQTT 5 client that mirrors the backend MqttService
// conventions (protocol version 5, self-managed exponential-backoff
// reconnection, subscription restoration) WITHOUT importing any backend module.
// It exposes only the surface the simulator runtime needs: connect, subscribe,
// publish, a single message handler, and a clean shutdown that clears timers.

import mqtt, { type IClientOptions, type IClientPublishOptions, type IPublishPacket, type MqttClient } from "mqtt";
import type { Logger } from "pino";
import { redactBrokerUrl } from "./config.js";

/** Connection lifecycle state, exposed for observability and tests. */
export type SimulatorConnectionState = "disconnected" | "connecting" | "connected" | "waiting_retry";

/** Options for a single publish; mirrors the backend generic-MQTT publish surface. */
export interface SimulatorPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
  /** MQTT 5 Correlation Data property (used on ACK publishes). */
  correlationData?: Buffer;
  /** MQTT 5 Response Topic property. */
  responseTopic?: string;
  /** MQTT 5 message expiry (seconds). */
  messageExpiryInterval?: number;
}

/** Handler invoked for every inbound message on a subscribed topic. */
export type SimulatorMessageHandler = (topic: string, payload: Buffer, packet: IPublishPacket) => void;

/** Factory that opens a broker connection; injectable so tests avoid a real broker. */
export type MqttConnectFn = (brokerUrl: string, options: IClientOptions) => MqttClient;

/** Construction options for {@link SimulatorMqttClient}. */
export interface SimulatorMqttClientOptions {
  brokerUrl: string;
  clientId: string;
  username?: string;
  password?: string;
  baseRetryDelayMs: number;
  maxBackoffMs: number;
  logger: Logger;
  /** Overrides `mqtt.connect` in tests. */
  connectFn?: MqttConnectFn;
}

/**
 * Exponential backoff: `min(base * 2^(attempt-1), max)`. Identical to the
 * backend MqttService so reconnection behaviour is consistent. Exported for
 * unit testing.
 */
export function computeRetryDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
}

export class SimulatorMqttClient {
  private client: MqttClient | null = null;
  private state: SimulatorConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private readonly subscriptions = new Set<string>();
  private messageHandler: SimulatorMessageHandler | null = null;
  private connectListener: (() => void) | null = null;
  private readonly opts: SimulatorMqttClientOptions;
  private readonly connectFn: MqttConnectFn;
  private readonly logger: Logger;

  constructor(opts: SimulatorMqttClientOptions) {
    this.opts = opts;
    this.connectFn = opts.connectFn ?? mqtt.connect;
    this.logger = opts.logger;
  }

  /** Current connection state. */
  getState(): SimulatorConnectionState {
    return this.state;
  }

  /** True when the client currently holds a live broker connection. */
  isConnected(): boolean {
    return this.state === "connected";
  }

  /** Register the single inbound-message handler. */
  setMessageHandler(handler: SimulatorMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Register a callback invoked after every successful (re)connect, once tracked
   * subscriptions have been restored. Used to republish coherent device state
   * on reconnect (Req 6.3).
   */
  setConnectListener(listener: () => void): void {
    this.connectListener = listener;
  }

  /**
   * Connect to the broker. An initial failure does not reject: it enters the
   * background reconnection loop so the process is resilient to a boot race
   * where the broker is not yet ready.
   */
  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    this.reconnectAttempt = 0;
    try {
      await this.attemptConnection();
    } catch (err) {
      this.logger.warn(
        { error: (err as Error).message, broker: redactBrokerUrl(this.opts.brokerUrl) },
        "Initial simulator MQTT connection failed — scheduling reconnection",
      );
      this.scheduleReconnect();
    }
  }

  private attemptConnection(): Promise<void> {
    this.setState("connecting");

    return new Promise<void>((resolve, reject) => {
      const options: IClientOptions = {
        reconnectPeriod: 0, // self-managed reconnection
        protocolVersion: 5,
        clientId: this.opts.clientId,
        ...(this.opts.username !== undefined ? { username: this.opts.username } : {}),
        ...(this.opts.password !== undefined ? { password: this.opts.password } : {}),
      };

      const client = this.connectFn(this.opts.brokerUrl, options);
      this.client = client;

      const onConnect = (): void => {
        cleanup();
        this.reconnectAttempt = 0;
        this.setState("connected");
        this.attachRuntimeHandlers(client);
        this.resubscribeAll();
        this.logger.info(
          { broker: redactBrokerUrl(this.opts.brokerUrl), subscriptions: this.subscriptions.size },
          "Simulator connected to MQTT broker",
        );
        try {
          this.connectListener?.();
        } catch (err) {
          this.logger.error({ error: (err as Error).message }, "Simulator connect listener threw");
        }
        resolve();
      };

      const onError = (err: Error): void => {
        cleanup();
        client.end(true);
        if (this.client === client) this.client = null;
        this.setState("disconnected");
        reject(err);
      };

      const cleanup = (): void => {
        client.removeListener("connect", onConnect);
        client.removeListener("error", onError);
      };

      client.on("connect", onConnect);
      client.on("error", onError);
    });
  }

  /** Attach the persistent handlers used while a connection is live. */
  private attachRuntimeHandlers(client: MqttClient): void {
    client.on("message", (topic: string, payload: Buffer, packet: IPublishPacket) => {
      this.messageHandler?.(topic, payload, packet);
    });
    client.on("error", (err: Error) => {
      this.logger.error({ error: err.message }, "Simulator MQTT client error");
    });
    client.on("close", () => {
      if (this.intentionalDisconnect) return;
      this.logger.warn("Simulator MQTT connection closed — scheduling reconnection");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectTimer) return; // a reconnection is already pending

    this.reconnectAttempt += 1;
    const delay = computeRetryDelay(this.reconnectAttempt, this.opts.baseRetryDelayMs, this.opts.maxBackoffMs);
    this.setState("waiting_retry");
    this.logger.warn(
      { attempt: this.reconnectAttempt, delayMs: delay },
      `Simulator MQTT reconnection attempt ${this.reconnectAttempt} scheduled in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect) return;
      this.attemptConnection()
        .then(() => {
          this.logger.info({ attempt: this.reconnectAttempt }, "Simulator MQTT reconnection successful");
        })
        .catch((err: Error) => {
          this.logger.error(
            { attempt: this.reconnectAttempt, error: err.message },
            "Simulator MQTT reconnection attempt failed",
          );
          this.scheduleReconnect();
        });
    }, delay);
    // Never keep the process alive solely for a reconnection timer.
    (timer as { unref?: () => void }).unref?.();
    this.reconnectTimer = timer;
  }

  /**
   * Subscribe to a topic. The topic is remembered so it is restored after any
   * reconnection. When already connected the subscription is issued immediately.
   */
  async subscribe(topic: string): Promise<void> {
    this.subscriptions.add(topic);
    if (this.client && this.state === "connected") {
      await this.doSubscribe(this.client, topic);
    }
  }

  private doSubscribe(client: MqttClient, topic: string): Promise<void> {
    return new Promise<void>((resolve) => {
      client.subscribe(topic, (err) => {
        if (err) {
          this.logger.error({ topic, error: err.message }, "Simulator failed to subscribe");
        } else {
          this.logger.debug({ topic }, "Simulator subscribed to topic");
        }
        resolve();
      });
    });
  }

  private resubscribeAll(): void {
    if (!this.client) return;
    for (const topic of this.subscriptions) {
      void this.doSubscribe(this.client, topic);
    }
  }

  /**
   * Publish a message. Throws when not connected — the caller decides whether a
   * dropped publish is tolerable. MQTT 5 properties are set only when provided.
   */
  publish(topic: string, payload: string, options?: SimulatorPublishOptions): void {
    if (!this.client || this.state !== "connected") {
      throw new Error("Simulator MQTT client not connected");
    }

    const properties: NonNullable<IClientPublishOptions["properties"]> = {};
    if (options?.messageExpiryInterval !== undefined) {
      properties.messageExpiryInterval = options.messageExpiryInterval;
    }
    if (options?.correlationData !== undefined) {
      properties.correlationData = options.correlationData;
    }
    if (options?.responseTopic !== undefined) {
      properties.responseTopic = options.responseTopic;
    }

    const publishOptions: IClientPublishOptions = {
      qos: options?.qos ?? 0,
      retain: options?.retain ?? false,
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
    };

    this.client.publish(topic, payload, publishOptions, (err?: Error) => {
      if (err) {
        this.logger.error({ topic, error: err.message }, "Simulator failed to publish");
      } else {
        this.logger.debug({ topic, payloadLength: payload.length }, "Simulator published message");
      }
    });
  }

  /** Disconnect cleanly: cancel timers, unsubscribe implicitly, and end the client. */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const client = this.client;
    if (!client) {
      this.setState("disconnected");
      return;
    }

    await new Promise<void>((resolve) => {
      client.end(false, {}, () => {
        this.client = null;
        this.setState("disconnected");
        this.logger.info("Simulator disconnected from MQTT broker");
        resolve();
      });
    });
  }

  private setState(state: SimulatorConnectionState): void {
    if (this.state === state) return;
    const previous = this.state;
    this.state = state;
    this.logger.debug({ previous, current: state }, "Simulator MQTT connection state changed");
  }
}
