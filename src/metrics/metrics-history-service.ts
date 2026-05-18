// src/metrics/metrics-history-service.ts — Core service for two-tier metrics history

import type { Registry } from "prom-client";
import type { DataStore } from "../data-store/data-store.js";
import type { Logger } from "pino";
import { parseMetricsHistoryConfig, type ValidatedMetricsHistoryConfig } from "./metrics-history-config.js";
import { RateComputer } from "./rate-computer.js";
import { computeAggregate, detectSpikes, alignToWindow } from "./aggregation.js";

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Configuration options for MetricsHistoryService (user-facing, all optional) */
export interface MetricsHistoryConfig {
  /** Sampling interval in milliseconds (default: 30,000, min: 5,000) */
  samplingIntervalMs: number;
  /** Aggregation interval in milliseconds (default: 300,000, min: 60,000) */
  aggregationIntervalMs: number;
  /** Retention for live collections in minutes (default: 10, min: 5) */
  liveRetentionMinutes: number;
}

/** Dependencies injected into MetricsHistoryService */
export interface MetricsHistoryDeps {
  /** DataStore instance for persistence */
  dataStore: DataStore;
  /** prom-client Registry for reading metric values */
  registry: Registry;
  /** Logger instance */
  logger: Logger;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Live (Tier 1) collection names */
const LIVE_COLLECTIONS = {
  system: "_metrics:live:system",
  mqtt: "_metrics:live:mqtt",
  automations: "_metrics:live:automations",
  http: "_metrics:live:http",
} as const;

/** History (Tier 2) collection names */
const HISTORY_COLLECTIONS = {
  system: "_metrics:history:system",
  mqtt: "_metrics:history:mqtt",
  automations: "_metrics:history:automations",
  http: "_metrics:history:http",
} as const;

/** Metric names from prom-client registry */
const METRIC_NAMES = {
  // System (gauges)
  memoryBytes: "process_resident_memory_bytes",
  uptimeSeconds: "aeolus_process_uptime_seconds",
  eventLoopLag: "nodejs_eventloop_lag_seconds",
  // MQTT
  mqttReceived: "aeolus_mqtt_messages_received_total",
  mqttPublished: "aeolus_mqtt_messages_published_total",
  mqttConnected: "aeolus_mqtt_connection_state",
  // Automations
  automationExecutions: "aeolus_automations_executions_total",
  automationActiveRules: "aeolus_automations_active_rules",
  // HTTP
  httpRequests: "aeolus_http_requests_total",
} as const;

// ─── MetricsHistoryService ───────────────────────────────────────────────────

export class MetricsHistoryService {
  private readonly dataStore: DataStore;
  private readonly registry: Registry;
  private readonly logger: Logger;
  private readonly config: ValidatedMetricsHistoryConfig;
  private readonly rateComputer: RateComputer;

  private samplingTimer: ReturnType<typeof setInterval> | null = null;
  private aggregationTimer: ReturnType<typeof setInterval> | null = null;
  private collectionsInitialized = false;

  constructor(deps: MetricsHistoryDeps, config?: Partial<MetricsHistoryConfig>) {
    this.dataStore = deps.dataStore;
    this.registry = deps.registry;
    this.logger = deps.logger;

    // Parse validated config from environment, then override with any explicit values
    const envConfig = parseMetricsHistoryConfig(process.env, deps.logger);
    this.config = {
      samplingIntervalMs: config?.samplingIntervalMs ?? envConfig.samplingIntervalMs,
      aggregationIntervalMs: config?.aggregationIntervalMs ?? envConfig.aggregationIntervalMs,
      liveRetentionMinutes: config?.liveRetentionMinutes ?? envConfig.liveRetentionMinutes,
    };

    this.rateComputer = new RateComputer();
  }

  /**
   * Start both sampling and aggregation timers.
   * Sampling runs every `samplingIntervalMs`, aggregation every `aggregationIntervalMs`.
   */
  start(): void {
    if (this.isRunning()) {
      this.logger.warn("MetricsHistoryService is already running");
      return;
    }

    this.samplingTimer = setInterval(() => {
      this.sampleOnce();
    }, this.config.samplingIntervalMs);

    this.aggregationTimer = setInterval(() => {
      this.aggregateOnce();
    }, this.config.aggregationIntervalMs);

    this.logger.info(
      {
        samplingIntervalMs: this.config.samplingIntervalMs,
        aggregationIntervalMs: this.config.aggregationIntervalMs,
        liveRetentionMinutes: this.config.liveRetentionMinutes,
      },
      "MetricsHistoryService started",
    );
  }

  /**
   * Stop both timers, attempt one final aggregation (best-effort), and clear
   * RateComputer state.
   */
  async dispose(): Promise<void> {
    // Stop timers
    if (this.samplingTimer !== null) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = null;
    }
    if (this.aggregationTimer !== null) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }

    // Best-effort final aggregation
    try {
      this.aggregateOnce();
    } catch (err) {
      this.logger.warn({ err }, "Final aggregation on dispose failed (best-effort)");
    }

    // Clear rate computer state
    this.rateComputer.reset();

    this.logger.info("MetricsHistoryService disposed");
  }

  /**
   * Check if the service is currently running (timers are active).
   */
  isRunning(): boolean {
    return this.samplingTimer !== null || this.aggregationTimer !== null;
  }

  /**
   * Execute one sampling cycle — reads metric values from the prom-client registry
   * and writes Tier 1 records to `_metrics:live:*` collections.
   *
   * Exposed for testing.
   */
  async sampleOnce(): Promise<void> {
    // Skip writes when DataStore is disabled
    if (!this.dataStore.isEnabled()) {
      return;
    }

    // Ensure live collections exist with retention on first call
    if (!this.collectionsInitialized) {
      this.initializeLiveCollections();
    }

    const timestamp = Date.now();
    const intervalSeconds = this.config.samplingIntervalMs / 1000;

    // ─── System metrics ────────────────────────────────────────────────────
    try {
      const memoryUsageMb = (await this.readGaugeValue(METRIC_NAMES.memoryBytes, 0)) / (1024 * 1024);
      const eventLoopLagMs = (await this.readGaugeValue(METRIC_NAMES.eventLoopLag, 0)) * 1000;
      const uptimeSeconds = await this.readGaugeValue(METRIC_NAMES.uptimeSeconds, 0);

      this.safeWrite(LIVE_COLLECTIONS.system, {
        memoryUsageMb,
        eventLoopLagMs,
        uptimeSeconds,
      }, timestamp);
    } catch (err) {
      this.logger.warn({ err }, "Failed to sample system metrics");
    }

    // ─── MQTT metrics ──────────────────────────────────────────────────────
    try {
      const receivedTotal = await this.readCounterValue(METRIC_NAMES.mqttReceived);
      const publishedTotal = await this.readCounterValue(METRIC_NAMES.mqttPublished);
      const connected = await this.readGaugeValue(METRIC_NAMES.mqttConnected, 0);

      const messagesReceivedRate = this.rateComputer.computeRate(
        METRIC_NAMES.mqttReceived,
        receivedTotal,
        intervalSeconds,
      );
      const messagesPublishedRate = this.rateComputer.computeRate(
        METRIC_NAMES.mqttPublished,
        publishedTotal,
        intervalSeconds,
      );

      this.safeWrite(LIVE_COLLECTIONS.mqtt, {
        messagesReceivedRate: messagesReceivedRate ?? 0,
        messagesPublishedRate: messagesPublishedRate ?? 0,
        connected,
      }, timestamp);
    } catch (err) {
      this.logger.warn({ err }, "Failed to sample MQTT metrics");
    }

    // ─── Automation metrics ────────────────────────────────────────────────
    try {
      const executionsTotal = await this.readCounterValue(METRIC_NAMES.automationExecutions);
      const activeRules = await this.readGaugeValue(METRIC_NAMES.automationActiveRules, 0);

      const executionRate = this.rateComputer.computeRate(
        METRIC_NAMES.automationExecutions,
        executionsTotal,
        intervalSeconds,
      );

      // Automation errors: filter executions counter by status="error" label
      const errorsTotal = await this.readCounterValueWithLabels(
        METRIC_NAMES.automationExecutions,
        { status: "error" },
      );
      const errorRate = this.rateComputer.computeRate(
        "aeolus_automations_errors",
        errorsTotal,
        intervalSeconds,
      );

      this.safeWrite(LIVE_COLLECTIONS.automations, {
        executionRate: executionRate ?? 0,
        errorRate: errorRate ?? 0,
        activeRules,
      }, timestamp);
    } catch (err) {
      this.logger.warn({ err }, "Failed to sample automation metrics");
    }

    // ─── HTTP metrics ──────────────────────────────────────────────────────
    try {
      const requestsTotal = await this.readCounterValue(METRIC_NAMES.httpRequests);

      const requestRate = this.rateComputer.computeRate(
        METRIC_NAMES.httpRequests,
        requestsTotal,
        intervalSeconds,
      );

      this.safeWrite(LIVE_COLLECTIONS.http, {
        requestRate: requestRate ?? 0,
      }, timestamp);
    } catch (err) {
      this.logger.warn({ err }, "Failed to sample HTTP metrics");
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Initialize live collections with retention. Called once on first sample.
   */
  private initializeLiveCollections(): void {
    const retentionDays = this.config.liveRetentionMinutes / (60 * 24);

    for (const collectionName of Object.values(LIVE_COLLECTIONS)) {
      try {
        this.dataStore.createCollection(collectionName, undefined, retentionDays);
      } catch {
        // Collection may already exist — that's fine
      }
    }

    this.collectionsInitialized = true;
  }

  /**
   * Read the total value of a counter metric (summing across all label combinations).
   */
  private async readCounterValue(metricName: string): Promise<number> {
    const metric = this.registry.getSingleMetric(metricName);
    if (!metric) {
      return 0;
    }

    const data = await (metric as unknown as { get(): Promise<{ values: Array<{ value: number }> }> }).get();
    if (!data || !data.values || data.values.length === 0) {
      return 0;
    }

    // Sum across all label combinations
    let total = 0;
    for (const entry of data.values) {
      total += entry.value;
    }
    return total;
  }

  /**
   * Read the value of a counter metric filtered by specific labels.
   */
  private async readCounterValueWithLabels(
    metricName: string,
    labels: Record<string, string>,
  ): Promise<number> {
    const metric = this.registry.getSingleMetric(metricName);
    if (!metric) {
      return 0;
    }

    const data = await (metric as unknown as { get(): Promise<{ values: Array<{ value: number; labels: Record<string, string> }> }> }).get();
    if (!data || !data.values || data.values.length === 0) {
      return 0;
    }

    let total = 0;
    for (const entry of data.values) {
      const matches = Object.entries(labels).every(
        ([key, val]) => entry.labels[key] === val,
      );
      if (matches) {
        total += entry.value;
      }
    }
    return total;
  }

  /**
   * Read the value of a gauge metric. Returns defaultValue if metric not found.
   */
  private async readGaugeValue(metricName: string, defaultValue: number): Promise<number> {
    const metric = this.registry.getSingleMetric(metricName);
    if (!metric) {
      return defaultValue;
    }

    const data = await (metric as unknown as { get(): Promise<{ values: Array<{ value: number }> }> }).get();
    if (!data || !data.values || data.values.length === 0) {
      return defaultValue;
    }

    // For gauges, return the first (or only) value
    return data.values[0].value;
  }

  /**
   * Write to DataStore with error handling — logs and continues on failure.
   */
  private safeWrite(collection: string, payload: Record<string, unknown>, timestamp?: number): void {
    try {
      this.dataStore.write(collection, payload, { timestamp });
    } catch (err) {
      this.logger.warn({ err, collection }, "Failed to write metrics to DataStore collection");
    }
  }

  /**
   * Execute one aggregation cycle — queries Tier 1 samples from the preceding
   * 5-minute window and writes Tier 2 aggregate records to `_metrics:history:*`
   * collections.
   *
   * Exposed for testing. Full implementation in task 3.3.
   */
  aggregateOnce(): void {
    // Guard: DataStore must be enabled
    if (!this.dataStore.isEnabled()) {
      this.logger.warn("DataStore is disabled — skipping aggregation cycle");
      return;
    }

    // Determine the 5-minute window to aggregate
    const now = Date.now();
    const windowStart = alignToWindow(now, this.config.aggregationIntervalMs);
    const from = windowStart - this.config.aggregationIntervalMs;
    const to = windowStart;

    const intervalSeconds = this.config.samplingIntervalMs / 1000;

    // Aggregate system metrics
    try {
      this.aggregateSystem(from, to, windowStart, intervalSeconds);
    } catch (err) {
      this.logger.error({ err, collection: LIVE_COLLECTIONS.system }, "Aggregation failed for system metrics");
    }

    // Aggregate MQTT metrics
    try {
      this.aggregateMqtt(from, to, windowStart, intervalSeconds);
    } catch (err) {
      this.logger.error({ err, collection: LIVE_COLLECTIONS.mqtt }, "Aggregation failed for MQTT metrics");
    }

    // Aggregate automations metrics
    try {
      this.aggregateAutomations(from, to, windowStart, intervalSeconds);
    } catch (err) {
      this.logger.error({ err, collection: LIVE_COLLECTIONS.automations }, "Aggregation failed for automations metrics");
    }

    // Aggregate HTTP metrics
    try {
      this.aggregateHttp(from, to, windowStart, intervalSeconds);
    } catch (err) {
      this.logger.error({ err, collection: LIVE_COLLECTIONS.http }, "Aggregation failed for HTTP metrics");
    }
  }

  // ─── Private Aggregation Helpers ─────────────────────────────────────────

  /**
   * Query Tier 1 samples from a collection for the given time window.
   * Returns the records array, or null if fewer than 2 samples exist.
   */
  private queryWindowSamples(
    collection: string,
    from: number,
    to: number,
  ): Array<{ payload: Record<string, unknown>; timestamp: number }> | null {
    const result = this.dataStore.query(collection, { from, to });

    // query returns { records, total } for non-aggregate queries
    if (!("records" in result)) {
      return null;
    }

    const records = result.records;
    if (records.length < 2) {
      this.logger.info(
        { collection, sampleCount: records.length, from, to },
        "Skipping aggregation — fewer than 2 samples in window",
      );
      return null;
    }

    return records.map((r) => ({ payload: r.payload, timestamp: r.timestamp }));
  }

  /**
   * Collect spike results for multiple fields into a single spikes object.
   * Returns null if no spikes detected for any field.
   */
  private collectSpikes(
    samples: Array<{ payload: Record<string, unknown>; timestamp: number }>,
    fields: string[],
  ): Record<string, { at: number; value: number }> | null {
    const spikes: Record<string, { at: number; value: number }> = {};

    for (const field of fields) {
      const timestampedValues = samples.map((s) => ({
        timestamp: s.timestamp,
        value: Number(s.payload[field] ?? 0),
      }));

      const spike = detectSpikes(timestampedValues);
      if (spike !== null) {
        spikes[field] = spike;
      }
    }

    return Object.keys(spikes).length > 0 ? spikes : null;
  }

  /**
   * Aggregate system metrics: avgMemoryMb, peakMemoryMb, avgEventLoopLagMs, peakEventLoopLagMs
   */
  private aggregateSystem(from: number, to: number, windowStart: number, _intervalSeconds: number): void {
    const samples = this.queryWindowSamples(LIVE_COLLECTIONS.system, from, to);
    if (!samples) return;

    const memoryValues = samples.map((s) => Number(s.payload.memoryUsageMb ?? 0));
    const eventLoopValues = samples.map((s) => Number(s.payload.eventLoopLagMs ?? 0));

    const memoryAgg = computeAggregate(memoryValues);
    const eventLoopAgg = computeAggregate(eventLoopValues);

    const spikes = this.collectSpikes(samples, ["memoryUsageMb", "eventLoopLagMs"]);

    this.dataStore.write(HISTORY_COLLECTIONS.system, {
      avgMemoryMb: memoryAgg.avg,
      peakMemoryMb: memoryAgg.peak,
      avgEventLoopLagMs: eventLoopAgg.avg,
      peakEventLoopLagMs: eventLoopAgg.peak,
      spikes,
      timestamp: windowStart,
    });
  }

  /**
   * Aggregate MQTT metrics: avgMessagesPerSec, peakMessagesPerSec, connectedPct
   */
  private aggregateMqtt(from: number, to: number, windowStart: number, _intervalSeconds: number): void {
    const samples = this.queryWindowSamples(LIVE_COLLECTIONS.mqtt, from, to);
    if (!samples) return;

    const rateValues = samples.map((s) => Number(s.payload.messagesReceivedRate ?? 0));
    const rateAgg = computeAggregate(rateValues);

    // connectedPct = (count of samples where connected === 1) / total × 100
    const connectedCount = samples.filter((s) => Number(s.payload.connected) === 1).length;
    const connectedPct = (connectedCount / samples.length) * 100;

    const spikes = this.collectSpikes(samples, ["messagesReceivedRate"]);

    this.dataStore.write(HISTORY_COLLECTIONS.mqtt, {
      avgMessagesPerSec: rateAgg.avg,
      peakMessagesPerSec: rateAgg.peak,
      connectedPct,
      spikes,
      timestamp: windowStart,
    });
  }

  /**
   * Aggregate automations metrics: totalExecutions, totalErrors, avgActiveRules
   */
  private aggregateAutomations(from: number, to: number, windowStart: number, intervalSeconds: number): void {
    const samples = this.queryWindowSamples(LIVE_COLLECTIONS.automations, from, to);
    if (!samples) return;

    // totalExecutions = sum of (executionRate × intervalSeconds) across samples
    const totalExecutions = samples.reduce(
      (sum, s) => sum + Number(s.payload.executionRate ?? 0) * intervalSeconds,
      0,
    );

    // totalErrors = sum of (errorRate × intervalSeconds) across samples
    const totalErrors = samples.reduce(
      (sum, s) => sum + Number(s.payload.errorRate ?? 0) * intervalSeconds,
      0,
    );

    // avgActiveRules = avg of activeRules values
    const activeRulesValues = samples.map((s) => Number(s.payload.activeRules ?? 0));
    const activeRulesAgg = computeAggregate(activeRulesValues);

    const spikes = this.collectSpikes(samples, ["executionRate", "errorRate", "activeRules"]);

    this.dataStore.write(HISTORY_COLLECTIONS.automations, {
      totalExecutions,
      totalErrors,
      avgActiveRules: activeRulesAgg.avg,
      spikes,
      timestamp: windowStart,
    });
  }

  /**
   * Aggregate HTTP metrics: totalRequests, avgResponseMs
   */
  private aggregateHttp(from: number, to: number, windowStart: number, intervalSeconds: number): void {
    const samples = this.queryWindowSamples(LIVE_COLLECTIONS.http, from, to);
    if (!samples) return;

    // totalRequests = sum of (requestRate × intervalSeconds) across samples
    const totalRequests = samples.reduce(
      (sum, s) => sum + Number(s.payload.requestRate ?? 0) * intervalSeconds,
      0,
    );

    // avgResponseMs = 0 (no response time metric available yet, placeholder)
    const avgResponseMs = 0;

    const spikes = this.collectSpikes(samples, ["requestRate"]);

    this.dataStore.write(HISTORY_COLLECTIONS.http, {
      totalRequests,
      avgResponseMs,
      spikes,
      timestamp: windowStart,
    });
  }
}
