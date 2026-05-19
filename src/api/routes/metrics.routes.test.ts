// src/api/routes/metrics.routes.test.ts — Unit tests for metrics route handlers

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createPrometheusMetricsRoute, createMetricsSummaryRoute } from "./metrics.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../metrics/metrics-auth.js", () => ({
  metricsAuthGuard: (_req: any, _res: any, next: any) => next(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockRegistry(metricValues: Record<string, { values: Array<{ value: number; labels?: Record<string, string> }> }> = {}) {
  return {
    metrics: vi.fn().mockResolvedValue("# HELP test_metric\ntest_metric 42\n"),
    getSingleMetric: vi.fn((name: string) => {
      const data = metricValues[name];
      if (!data) return undefined;
      return { get: async () => data };
    }),
  };
}

function createMockMetricsService(registry = createMockRegistry()) {
  return { getRegistry: () => registry };
}

async function request(
  app: express.Express,
  method: string,
  path: string,
): Promise<{ status: number; body: any; text: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      fetch(`http://127.0.0.1:${addr.port}${path}`, { method: method.toUpperCase() })
        .then(async (res) => {
          const text = await res.text();
          let body: any;
          try { body = JSON.parse(text); } catch { body = text; }
          server.close();
          resolve({ status: res.status, body, text, contentType: res.headers.get("content-type") || "" });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("metrics.routes", () => {
  describe("createPrometheusMetricsRoute", () => {
    let app: express.Express;
    let mockService: ReturnType<typeof createMockMetricsService>;

    beforeEach(() => {
      mockService = createMockMetricsService();
      app = express();
      app.use("/", createPrometheusMetricsRoute(mockService));
      app.use(errorHandler);
    });

    it("GET /metrics returns Prometheus text format with 200", async () => {
      const res = await request(app, "GET", "/metrics");
      expect(res.status).toBe(200);
      expect(res.contentType).toContain("text/plain");
      expect(res.text).toContain("test_metric 42");
    });

    it("GET /metrics returns 500 when registry.metrics() throws", async () => {
      const registry = createMockRegistry();
      registry.metrics.mockRejectedValue(new Error("registry error"));
      const svc = createMockMetricsService(registry as any);
      const failApp = express();
      failApp.use("/", createPrometheusMetricsRoute(svc));
      failApp.use(errorHandler);

      const res = await request(failApp, "GET", "/metrics");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to collect metrics");
    });
  });

  describe("createMetricsSummaryRoute", () => {
    it("GET /summary returns JSON summary with correct shape", async () => {
      const metricValues: Record<string, any> = {
        aeolus_process_uptime_seconds: { values: [{ value: 100 }] },
        aeolus_mqtt_messages_received_total: { values: [{ value: 500 }] },
        aeolus_mqtt_messages_published_total: { values: [{ value: 200 }] },
        aeolus_mqtt_connection_state: { values: [{ value: 1 }] },
        aeolus_devices_registered_total: { values: [{ value: 10 }] },
        aeolus_automations_executions_total: { values: [{ value: 50, labels: { status: "success" } }, { value: 5, labels: { status: "error" } }] },
        aeolus_automations_active_rules: { values: [{ value: 3 }] },
        aeolus_websocket_connections_active: { values: [{ value: 2 }] },
        process_resident_memory_bytes: { values: [{ value: 104857600 }] }, // 100MB
        nodejs_eventloop_lag_seconds: { values: [{ value: 0.015 }] }, // 15ms
      };
      const registry = createMockRegistry(metricValues);
      const svc = createMockMetricsService(registry as any);

      const app = express();
      app.use("/", createMetricsSummaryRoute(svc));
      app.use(errorHandler);

      const res = await request(app, "GET", "/summary");
      expect(res.status).toBe(200);

      const body = res.body;
      expect(body.mqtt).toBeDefined();
      expect(body.mqtt.connected).toBe(true);
      expect(body.mqtt.messagesReceivedRate).toBeCloseTo(5, 1); // 500/100
      expect(body.mqtt.messagesPublishedRate).toBeCloseTo(2, 1); // 200/100
      expect(body.devices.registeredCount).toBe(10);
      expect(body.automations.activeRules).toBe(3);
      expect(body.automations.executionRate).toBeCloseTo(0.55, 1); // 55/100
      expect(body.automations.errorRate).toBeCloseTo(0.05, 2); // 5/100
      expect(body.websocket.activeConnections).toBe(2);
      expect(body.system.uptimeSeconds).toBe(100);
      expect(body.system.memoryUsageMb).toBe(100);
      expect(body.system.eventLoopLagMs).toBe(15);
    });

    it("GET /summary returns zeros when metrics are missing", async () => {
      const registry = createMockRegistry({});
      const svc = createMockMetricsService(registry as any);

      const app = express();
      app.use("/", createMetricsSummaryRoute(svc));
      app.use(errorHandler);

      const res = await request(app, "GET", "/summary");
      expect(res.status).toBe(200);
      expect(res.body.mqtt.connected).toBe(false);
      expect(res.body.mqtt.messagesReceivedRate).toBe(0);
      expect(res.body.devices.registeredCount).toBe(0);
      expect(res.body.system.uptimeSeconds).toBe(0);
    });

    it("GET /summary returns 500 when registry throws", async () => {
      const registry = {
        metrics: vi.fn(),
        getSingleMetric: vi.fn(() => { throw new Error("boom"); }),
      };
      const svc = createMockMetricsService(registry as any);

      const app = express();
      app.use("/", createMetricsSummaryRoute(svc));
      app.use(errorHandler);

      const res = await request(app, "GET", "/summary");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to collect metrics summary");
    });

    it("GET /summary handles uptime of 0 without division by zero", async () => {
      const metricValues: Record<string, any> = {
        aeolus_process_uptime_seconds: { values: [{ value: 0 }] },
        aeolus_mqtt_messages_received_total: { values: [{ value: 100 }] },
      };
      const registry = createMockRegistry(metricValues);
      const svc = createMockMetricsService(registry as any);

      const app = express();
      app.use("/", createMetricsSummaryRoute(svc));
      app.use(errorHandler);

      const res = await request(app, "GET", "/summary");
      expect(res.status).toBe(200);
      // safeUptime should be 1 when uptime is 0
      expect(res.body.mqtt.messagesReceivedRate).toBe(100);
    });
  });
});
