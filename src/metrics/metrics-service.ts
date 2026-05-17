// src/metrics/metrics-service.ts — Prometheus metrics collection singleton

import { EventEmitter } from "node:events";
import client, { type Registry, Counter, Gauge, Histogram } from "prom-client";
import logger from "../logger.js";
import {
  DEVICE_STATE_CHANGE,
  MQTT_CONNECTION_STATE,
  MQTT_MESSAGE_PROCESSED,
  MQTT_MESSAGE_PUBLISHED,
  AUTOMATION_EXECUTION_COMPLETE,
  AUTOMATION_RULE_REGISTERED,
  AUTOMATION_RULE_UNREGISTERED,
  CONNECTOR_POLL,
  CONNECTOR_ERROR,
  WS_CLIENT_CONNECT,
  WS_CLIENT_DISCONNECT,
  WS_BROADCAST,
  DATA_STORE_WRITE,
  DATA_STORE_QUERY,
} from "../core/event-bus.js";

/** Configuration for the MetricsService */
export interface MetricsServiceConfig {
  /** Whether to collect default Node.js metrics (memory, GC, event loop) */
  collectDefaults: boolean;
  /** Custom histogram buckets (optional overrides) */
  httpDurationBuckets?: number[];
  mqttDurationBuckets?: number[];
  automationDurationBuckets?: number[];
  datastoreDurationBuckets?: number[];
}

/** Dependencies injected into the MetricsService */
export interface MetricsServiceDeps {
  /** Event bus for subscribing to system events */
  eventBus: EventEmitter;
  /** Returns current registered device count (from DeviceRegistry) */
  getDeviceCount: () => number;
  /** Returns current active automation rule count (from AutomationEngine) */
  getRuleCount: () => number;
}

/** Default histogram bucket configurations */
const DEFAULT_BUCKETS = {
  mqtt: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  automation: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5],
  http: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  datastore: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
};

/** Event payload interfaces */
interface DeviceStateChangePayload {
  deviceId: string;
  deviceType: string;
  state: Record<string, unknown>;
  topic: string;
}

interface MqttConnectionStatePayload {
  previous: string;
  current: string;
}

interface MqttMessageProcessedPayload {
  topic: string;
  durationMs: number;
}

interface AutomationExecutionCompletePayload {
  ruleId: string;
  ruleName: string;
  status: "success" | "error";
  durationMs: number;
}

interface ConnectorPollPayload {
  connectorType: string;
  instanceId: string;
  devicesDiscovered: number;
}

interface ConnectorErrorPayload {
  connectorType: string;
  instanceId: string;
  error: string;
}

interface WsBroadcastPayload {
  messageType: string;
  clientCount: number;
}

interface DataStoreWritePayload {
  collection: string;
  record: unknown;
}

interface DataStoreQueryPayload {
  collection: string;
  durationMs: number;
}

/**
 * MetricsService — Singleton that registers all custom Prometheus metrics
 * and subscribes to Event Bus events for telemetry collection.
 *
 * All metrics use the `aeolus_` prefix. Device IDs are never used as labels.
 * Event Bus listener errors are caught and logged — metric recording failures are non-fatal.
 */
class MetricsService {
  private initialized = false;
  private deps: MetricsServiceDeps | null = null;
  private config: MetricsServiceConfig;
  private listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
  private processStartTime: number = Date.now();

  // --- Counters ---
  private mqttMessagesReceived!: Counter;
  private mqttMessagesPublished!: Counter;
  private deviceMessages!: Counter;
  private automationExecutions!: Counter;
  private connectorPolls!: Counter;
  private connectorErrors!: Counter;
  private httpRequests!: Counter;
  private websocketMessagesSent!: Counter;
  private datastoreRecordsWritten!: Counter;

  // --- Gauges ---
  private mqttConnectionState!: Gauge;
  private devicesRegistered!: Gauge;
  private automationsActiveRules!: Gauge;
  private connectorDevicesDiscovered!: Gauge;
  private processUptime!: Gauge;
  private websocketConnectionsActive!: Gauge;

  // --- Histograms ---
  private mqttMessageProcessingDuration!: Histogram;
  private automationExecutionDuration!: Histogram;
  private httpRequestDuration!: Histogram;
  private datastoreQueryDuration!: Histogram;

  constructor(config?: Partial<MetricsServiceConfig>) {
    this.config = {
      collectDefaults: config?.collectDefaults ?? true,
      httpDurationBuckets: config?.httpDurationBuckets,
      mqttDurationBuckets: config?.mqttDurationBuckets,
      automationDurationBuckets: config?.automationDurationBuckets,
      datastoreDurationBuckets: config?.datastoreDurationBuckets,
    };

    this.registerMetrics();
  }

  /**
   * Register all 19 custom metrics with the default prom-client registry.
   * If a metric already exists (duplicate name), log a warning and skip.
   */
  private registerMetrics(): void {
    try {
      // --- Counters ---
      this.mqttMessagesReceived = new Counter({
        name: "aeolus_mqtt_messages_received_total",
        help: "Total MQTT messages received",
        labelNames: ["topic_prefix"],
      });

      this.mqttMessagesPublished = new Counter({
        name: "aeolus_mqtt_messages_published_total",
        help: "Total MQTT messages published",
      });

      this.deviceMessages = new Counter({
        name: "aeolus_device_messages_total",
        help: "Device state change messages",
        labelNames: ["device_type"],
      });

      this.automationExecutions = new Counter({
        name: "aeolus_automations_executions_total",
        help: "Automation rule executions",
        labelNames: ["rule_name", "status"],
      });

      this.connectorPolls = new Counter({
        name: "aeolus_connector_polls_total",
        help: "Connector poll cycles completed",
        labelNames: ["connector_type"],
      });

      this.connectorErrors = new Counter({
        name: "aeolus_connector_errors_total",
        help: "Connector poll errors",
        labelNames: ["connector_type"],
      });

      this.httpRequests = new Counter({
        name: "aeolus_http_requests_total",
        help: "HTTP requests served",
        labelNames: ["method", "route", "status_code"],
      });

      this.websocketMessagesSent = new Counter({
        name: "aeolus_websocket_messages_sent_total",
        help: "WebSocket messages broadcast",
        labelNames: ["message_type"],
      });

      this.datastoreRecordsWritten = new Counter({
        name: "aeolus_datastore_records_written_total",
        help: "Data store records written",
        labelNames: ["collection"],
      });

      // --- Gauges ---
      this.mqttConnectionState = new Gauge({
        name: "aeolus_mqtt_connection_state",
        help: "MQTT broker connection (1=connected, 0=disconnected)",
      });

      this.devicesRegistered = new Gauge({
        name: "aeolus_devices_registered_total",
        help: "Current registered device count",
      });

      this.automationsActiveRules = new Gauge({
        name: "aeolus_automations_active_rules",
        help: "Currently loaded automation rules",
      });

      this.connectorDevicesDiscovered = new Gauge({
        name: "aeolus_connector_devices_discovered",
        help: "Devices discovered per connector",
        labelNames: ["connector_type"],
      });

      this.processUptime = new Gauge({
        name: "aeolus_process_uptime_seconds",
        help: "Process uptime in seconds",
        collect: () => {
          this.processUptime.set((Date.now() - this.processStartTime) / 1000);
        },
      });

      this.websocketConnectionsActive = new Gauge({
        name: "aeolus_websocket_connections_active",
        help: "Active WebSocket connections",
      });

      // --- Histograms ---
      this.mqttMessageProcessingDuration = new Histogram({
        name: "aeolus_mqtt_message_processing_duration_seconds",
        help: "MQTT message processing time",
        buckets: this.config.mqttDurationBuckets ?? DEFAULT_BUCKETS.mqtt,
      });

      this.automationExecutionDuration = new Histogram({
        name: "aeolus_automations_execution_duration_seconds",
        help: "Automation execution time",
        buckets: this.config.automationDurationBuckets ?? DEFAULT_BUCKETS.automation,
      });

      this.httpRequestDuration = new Histogram({
        name: "aeolus_http_request_duration_seconds",
        help: "HTTP response time",
        labelNames: ["method", "route"],
        buckets: this.config.httpDurationBuckets ?? DEFAULT_BUCKETS.http,
      });

      this.datastoreQueryDuration = new Histogram({
        name: "aeolus_datastore_query_duration_seconds",
        help: "Data store query time",
        buckets: this.config.datastoreDurationBuckets ?? DEFAULT_BUCKETS.datastore,
      });
    } catch (error) {
      logger.warn({ error }, "Error during metric registration (possible duplicate name), skipping");
    }

    // Collect default Node.js metrics if configured
    if (this.config.collectDefaults) {
      client.collectDefaultMetrics();
    }
  }

  /**
   * Initialize the MetricsService by subscribing to all Event Bus events.
   * Must be called once with the application dependencies.
   */
  initialize(deps: MetricsServiceDeps): void {
    if (this.initialized) {
      logger.warn("MetricsService.initialize() called more than once, ignoring");
      return;
    }

    this.deps = deps;
    this.initialized = true;
    this.processStartTime = Date.now();

    this.subscribeToEvents(deps.eventBus);
  }

  /**
   * Subscribe to all relevant Event Bus events for metric collection.
   * Each listener is wrapped in try/catch — metric recording failures are non-fatal.
   */
  private subscribeToEvents(eventBus: EventEmitter): void {
    this.addListener(eventBus, DEVICE_STATE_CHANGE, (payload: unknown) => {
      const event = payload as DeviceStateChangePayload;
      this.deviceMessages.inc({ device_type: event.deviceType });
      this.devicesRegistered.set(this.deps!.getDeviceCount());
    });

    this.addListener(eventBus, MQTT_CONNECTION_STATE, (payload: unknown) => {
      const event = payload as MqttConnectionStatePayload;
      this.mqttConnectionState.set(event.current === "connected" ? 1 : 0);
    });

    this.addListener(eventBus, MQTT_MESSAGE_PROCESSED, (payload: unknown) => {
      const event = payload as MqttMessageProcessedPayload;
      const topicPrefix = event.topic.split("/")[0] || "unknown";
      this.mqttMessagesReceived.inc({ topic_prefix: topicPrefix });
      this.mqttMessageProcessingDuration.observe(event.durationMs / 1000);
    });

    this.addListener(eventBus, MQTT_MESSAGE_PUBLISHED, (_payload: unknown) => {
      this.mqttMessagesPublished.inc();
    });

    this.addListener(eventBus, AUTOMATION_EXECUTION_COMPLETE, (payload: unknown) => {
      const event = payload as AutomationExecutionCompletePayload;
      this.automationExecutions.inc({ rule_name: event.ruleName, status: event.status });
      this.automationExecutionDuration.observe(event.durationMs / 1000);
    });

    this.addListener(eventBus, AUTOMATION_RULE_REGISTERED, (_payload: unknown) => {
      this.automationsActiveRules.set(this.deps!.getRuleCount());
    });

    this.addListener(eventBus, AUTOMATION_RULE_UNREGISTERED, (_payload: unknown) => {
      this.automationsActiveRules.set(this.deps!.getRuleCount());
    });

    this.addListener(eventBus, CONNECTOR_POLL, (payload: unknown) => {
      const event = payload as ConnectorPollPayload;
      this.connectorPolls.inc({ connector_type: event.connectorType });
      this.connectorDevicesDiscovered.set({ connector_type: event.connectorType }, event.devicesDiscovered);
    });

    this.addListener(eventBus, CONNECTOR_ERROR, (payload: unknown) => {
      const event = payload as ConnectorErrorPayload;
      this.connectorErrors.inc({ connector_type: event.connectorType });
    });

    this.addListener(eventBus, WS_CLIENT_CONNECT, (_payload: unknown) => {
      this.websocketConnectionsActive.inc();
    });

    this.addListener(eventBus, WS_CLIENT_DISCONNECT, (_payload: unknown) => {
      this.websocketConnectionsActive.dec();
    });

    this.addListener(eventBus, WS_BROADCAST, (payload: unknown) => {
      const event = payload as WsBroadcastPayload;
      this.websocketMessagesSent.inc({ message_type: event.messageType });
    });

    this.addListener(eventBus, DATA_STORE_WRITE, (payload: unknown) => {
      const event = payload as DataStoreWritePayload;
      this.datastoreRecordsWritten.inc({ collection: event.collection });
    });

    this.addListener(eventBus, DATA_STORE_QUERY, (payload: unknown) => {
      const event = payload as DataStoreQueryPayload;
      this.datastoreQueryDuration.observe(event.durationMs / 1000);
    });
  }

  /**
   * Add an event listener with error wrapping. Stores reference for cleanup in dispose().
   */
  private addListener(eventBus: EventEmitter, event: string, handler: (payload: unknown) => void): void {
    const wrappedHandler = (...args: unknown[]) => {
      try {
        handler(args[0]);
      } catch (error) {
        logger.error({ error, event }, "Non-fatal error in metrics event listener");
      }
    };

    eventBus.on(event, wrappedHandler);
    this.listeners.push({ event, handler: wrappedHandler });
  }

  /**
   * Record an HTTP request metric (called by the metrics middleware).
   */
  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    this.httpRequests.inc({ method, route, status_code: String(statusCode) });
    this.httpRequestDuration.observe({ method, route }, durationSeconds);
  }

  /**
   * Get the default prom-client registry instance.
   */
  getRegistry(): Registry {
    return client.register;
  }

  /**
   * Clean up: remove all Event Bus listeners and clear the registry.
   */
  dispose(): void {
    if (this.deps) {
      for (const { event, handler } of this.listeners) {
        this.deps.eventBus.removeListener(event, handler);
      }
    }

    this.listeners = [];
    this.initialized = false;
    this.deps = null;
    client.register.clear();
  }
}

/** Singleton instance exported for use across the application */
export const metricsService = new MetricsService();

