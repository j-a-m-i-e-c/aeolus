// src/config.test.ts — Exercises every branch in config.ts (env-var present + absent)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dotenv to prevent it from reading .env file during tests
vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses defaults when no env vars are set", async () => {
    // Clear relevant env vars
    delete process.env.MQTT_BROKER_URL;
    delete process.env.MQTT_TOPICS;
    delete process.env.MQTT_DISCOVERY_IGNORED_TOPIC_SUFFIXES;
    delete process.env.MQTT_MANAGED_PROVISIONING_ENABLED;
    delete process.env.PORT;
    delete process.env.DB_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    delete process.env.STATE_HISTORY_MAX;
    delete process.env.HISTORY_RECORD_INTERVAL;
    delete process.env.RATE_LIMIT_RPM;
    delete process.env.CORS_ORIGINS;

    const { config } = await import("./config.js");
    expect(config.mqttBrokerUrl).toBe("mqtt://localhost:1883");
    expect(config.mqttTopics).toEqual(["#"]);
    expect(config.mqttDiscoveryIgnoredTopicSuffixes).toEqual([
      "set", "command", "cmd", "heartbeat", "availability",
    ]);
    expect(config.managedMqttProvisioningEnabled).toBe(false);
    expect(config.mqttProvisioningVerify).toEqual({
      budgetMs: 12000,
      pollIntervalMs: 500,
      connectTimeoutMs: 3000,
    });
    expect(config.port).toBe(3001);
    expect(config.dbPath).toBe("./data/aeolus.db");
    expect(config.logLevel).toBe("debug");
    expect(config.nodeEnv).toBe("development");
    expect(config.stateHistoryMax).toBe(100);
    expect(config.historyRecordInterval).toBe(5000);
    expect(config.rateLimitRpm).toBe(1000);
    expect(config.corsOrigins).toEqual([]);
  });

  it("reads values from env vars when they are set", async () => {
    process.env.MQTT_BROKER_URL = "mqtt://broker.local:1884";
    process.env.MQTT_TOPICS = "home/+/temp, office/# ";
    process.env.MQTT_DISCOVERY_IGNORED_TOPIC_SUFFIXES = "set, status ";
    process.env.MQTT_MANAGED_PROVISIONING_ENABLED = "true";
    process.env.MQTT_PROVISIONING_VERIFY_BUDGET_MS = "8000";
    process.env.MQTT_PROVISIONING_VERIFY_POLL_MS = "250";
    process.env.MQTT_PROVISIONING_VERIFY_TIMEOUT_MS = "2000";
    process.env.PORT = "4000";
    process.env.DB_PATH = "/data/custom.db";
    process.env.LOG_LEVEL = "warn";
    process.env.NODE_ENV = "production";
    process.env.STATE_HISTORY_MAX = "200";
    process.env.HISTORY_RECORD_INTERVAL = "10000";
    process.env.RATE_LIMIT_RPM = "500";
    process.env.CORS_ORIGINS = "https://app.example.com, https://admin.example.com";

    const { config } = await import("./config.js");
    expect(config.mqttBrokerUrl).toBe("mqtt://broker.local:1884");
    expect(config.mqttTopics).toEqual(["home/+/temp", "office/#"]);
    expect(config.mqttDiscoveryIgnoredTopicSuffixes).toEqual(["set", "status"]);
    expect(config.managedMqttProvisioningEnabled).toBe(true);
    expect(config.mqttProvisioningVerify).toEqual({
      budgetMs: 8000,
      pollIntervalMs: 250,
      connectTimeoutMs: 2000,
    });
    expect(config.port).toBe(4000);
    expect(config.dbPath).toBe("/data/custom.db");
    expect(config.logLevel).toBe("warn");
    expect(config.nodeEnv).toBe("production");
    expect(config.stateHistoryMax).toBe(200);
    expect(config.historyRecordInterval).toBe(10000);
    expect(config.rateLimitRpm).toBe(500);
    expect(config.corsOrigins).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  it("handles a single MQTT topic without commas", async () => {
    delete process.env.MQTT_BROKER_URL;
    delete process.env.PORT;
    delete process.env.DB_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    delete process.env.STATE_HISTORY_MAX;
    delete process.env.HISTORY_RECORD_INTERVAL;
    delete process.env.RATE_LIMIT_RPM;
    delete process.env.CORS_ORIGINS;
    process.env.MQTT_TOPICS = "sensor/temperature";

    const { config } = await import("./config.js");
    expect(config.mqttTopics).toEqual(["sensor/temperature"]);
  });

  it("filters empty entries from CORS_ORIGINS", async () => {
    delete process.env.MQTT_BROKER_URL;
    delete process.env.MQTT_TOPICS;
    delete process.env.PORT;
    delete process.env.DB_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    delete process.env.STATE_HISTORY_MAX;
    delete process.env.HISTORY_RECORD_INTERVAL;
    delete process.env.RATE_LIMIT_RPM;
    process.env.CORS_ORIGINS = "https://foo.com,,  ,https://bar.com";

    const { config } = await import("./config.js");
    expect(config.corsOrigins).toEqual(["https://foo.com", "https://bar.com"]);
  });

  it("throws when restActionTimeoutMs < maxConfirmTimeoutMs", async () => {
    process.env.REST_ACTION_TIMEOUT_MS = "1000";
    process.env.MAX_CONFIRM_TIMEOUT_MS = "5000";

    await expect(() => import("./config.js")).rejects.toThrow(
      "Configuration error: restActionTimeoutMs (1000) must be >= maxConfirmTimeoutMs (5000)",
    );
  });
});
