// src/api/routes/metrics.routes.ts — Split route registration for metrics endpoints

import { Router } from "express";
import type { Registry } from "prom-client";
import { metricsAuthGuard } from "../../metrics/metrics-auth.js";

/** Minimal interface for the metrics service dependency */
interface MetricsServiceLike {
  getRegistry(): Registry;
}

/** JSON summary structure returned by the /api/metrics/summary endpoint */
interface MetricsSummary {
  mqtt: {
    messagesReceivedRate: number;
    messagesPublishedRate: number;
    connected: boolean;
  };
  devices: {
    registeredCount: number;
  };
  automations: {
    executionRate: number;
    activeRules: number;
    errorRate: number;
  };
  websocket: {
    activeConnections: number;
  };
  system: {
    uptimeSeconds: number;
    memoryUsageMb: number;
    eventLoopLagMs: number;
  };
}

/**
 * Creates the Prometheus metrics router.
 * - GET /metrics — Prometheus text exposition format
 *
 * Auth: Uses METRICS_TOKEN env var (bearer token), NOT JWT.
 * This router is mounted BEFORE the `authenticate` middleware in the Express stack.
 */
export function createPrometheusMetricsRoute(metricsService: MetricsServiceLike): Router {
  const router = Router();

  router.get("/metrics", metricsAuthGuard, async (_request, response) => {
    try {
      const registry = metricsService.getRegistry();
      const metrics = await registry.metrics();
      response.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      response.send(metrics);
    } catch {
      response.status(500).json({ error: "Failed to collect metrics" });
    }
  });

  return router;
}

/**
 * Creates the JSON summary router for the frontend dashboard pane.
 * - GET /summary — JSON summary for frontend pane
 *
 * Auth: Uses standard JWT authentication (same as all other /api/ routes).
 * This router is mounted AFTER the `authenticate` middleware alongside other API routes.
 */
export function createMetricsSummaryRoute(metricsService: MetricsServiceLike): Router {
  const router = Router();

  router.get("/summary", async (_request, response) => {
    try {
      const registry = metricsService.getRegistry();
      const summary = await buildMetricsSummary(registry);
      response.json(summary);
    } catch {
      response.status(500).json({ error: "Failed to collect metrics summary" });
    }
  });

  return router;
}

/**
 * Build the MetricsSummary JSON structure from registry metric values.
 * Rates are computed as counter_value / uptime_seconds.
 */
async function buildMetricsSummary(registry: Registry): Promise<MetricsSummary> {
  const uptimeSeconds = await getGaugeValue(registry, "aeolus_process_uptime_seconds");
  const safeUptime = uptimeSeconds > 0 ? uptimeSeconds : 1;

  // MQTT metrics
  const mqttReceived = await getCounterValue(registry, "aeolus_mqtt_messages_received_total");
  const mqttPublished = await getCounterValue(registry, "aeolus_mqtt_messages_published_total");
  const mqttConnected = await getGaugeValue(registry, "aeolus_mqtt_connection_state");

  // Device metrics
  const registeredCount = await getGaugeValue(registry, "aeolus_devices_registered_total");

  // Automation metrics
  const automationExecutions = await getCounterValue(registry, "aeolus_automations_executions_total");
  const automationErrors = await getCounterValueByLabel(
    registry,
    "aeolus_automations_executions_total",
    "status",
    "error",
  );
  const activeRules = await getGaugeValue(registry, "aeolus_automations_active_rules");

  // WebSocket metrics
  const activeConnections = await getGaugeValue(registry, "aeolus_websocket_connections_active");

  // System metrics
  const memoryMetric = registry.getSingleMetric("process_resident_memory_bytes");
  let memoryUsageMb = 0;
  if (memoryMetric) {
    const memoryData = await memoryMetric.get();
    if (memoryData.values.length > 0) {
      memoryUsageMb = (memoryData.values[0]?.value ?? 0) / (1024 * 1024);
    }
  }

  const eventLoopMetric = registry.getSingleMetric("nodejs_eventloop_lag_seconds");
  let eventLoopLagMs = 0;
  if (eventLoopMetric) {
    const lagData = await eventLoopMetric.get();
    if (lagData.values.length > 0) {
      eventLoopLagMs = (lagData.values[0]?.value ?? 0) * 1000;
    }
  }

  return {
    mqtt: {
      messagesReceivedRate: mqttReceived / safeUptime,
      messagesPublishedRate: mqttPublished / safeUptime,
      connected: mqttConnected === 1,
    },
    devices: {
      registeredCount,
    },
    automations: {
      executionRate: automationExecutions / safeUptime,
      activeRules,
      errorRate: automationErrors / safeUptime,
    },
    websocket: {
      activeConnections,
    },
    system: {
      uptimeSeconds,
      memoryUsageMb: Math.round(memoryUsageMb * 10) / 10,
      eventLoopLagMs: Math.round(eventLoopLagMs * 100) / 100,
    },
  };
}

/**
 * Get the total value of a counter metric (summed across all label combinations).
 */
async function getCounterValue(registry: Registry, name: string): Promise<number> {
  const metric = registry.getSingleMetric(name);
  if (!metric) return 0;

  const data = await metric.get();
  let total = 0;
  for (const entry of data.values) {
    total += entry.value;
  }
  return total;
}

/**
 * Get the value of a counter metric filtered by a specific label value.
 */
async function getCounterValueByLabel(
  registry: Registry,
  name: string,
  labelName: string,
  labelValue: string,
): Promise<number> {
  const metric = registry.getSingleMetric(name);
  if (!metric) return 0;

  const data = await metric.get();
  let total = 0;
  for (const entry of data.values) {
    if (entry.labels && (entry.labels as Record<string, string>)[labelName] === labelValue) {
      total += entry.value;
    }
  }
  return total;
}

/**
 * Get the current value of a gauge metric (first value entry).
 */
async function getGaugeValue(registry: Registry, name: string): Promise<number> {
  const metric = registry.getSingleMetric(name);
  if (!metric) return 0;

  const data = await metric.get();
  if (data.values.length === 0) return 0;
  return data.values[0]?.value ?? 0;
}
