// src/simulator/config.test.ts
import { describe, it, expect } from "vitest";
import {
  loadSimulatorConfig,
  describeSimulatorConfig,
  redactBrokerUrl,
  DEFAULT_BASE_RETRY_DELAY_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MAX_PENDING_TIMERS,
  DEFAULT_MAX_COMMAND_QUEUE_DEPTH,
  DEFAULT_STATE_REFRESH_MS,
  DEFAULT_CLIENT_ID,
} from "./config.js";

describe("loadSimulatorConfig", () => {
  it("applies safe defaults for an empty environment", () => {
    const config = loadSimulatorConfig({});
    expect(config.enabled).toBe(false);
    expect(config.brokerUrl).toBe("mqtt://localhost:1883");
    expect(config.clientId).toBe(DEFAULT_CLIENT_ID);
    expect(config.scenarios).toEqual([]);
    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(config.randomSeed).toBeUndefined();
    expect(config.maxDelayMs).toBe(DEFAULT_MAX_DELAY_MS);
    expect(config.maxPendingTimers).toBe(DEFAULT_MAX_PENDING_TIMERS);
    expect(config.maxCommandQueueDepth).toBe(DEFAULT_MAX_COMMAND_QUEUE_DEPTH);
    expect(config.stateRefreshMs).toBe(DEFAULT_STATE_REFRESH_MS);
    expect(config.baseRetryDelayMs).toBe(DEFAULT_BASE_RETRY_DELAY_MS);
    expect(config.maxBackoffMs).toBe(DEFAULT_MAX_BACKOFF_MS);
    expect(config.logLevel).toBe("info");
  });

  it("is disabled unless AEOLUS_SIMULATOR_ENABLED is exactly 'true'", () => {
    expect(loadSimulatorConfig({ AEOLUS_SIMULATOR_ENABLED: "true" }).enabled).toBe(true);
    expect(loadSimulatorConfig({ AEOLUS_SIMULATOR_ENABLED: "1" }).enabled).toBe(false);
    expect(loadSimulatorConfig({ AEOLUS_SIMULATOR_ENABLED: "TRUE" }).enabled).toBe(false);
  });

  it("parses a comma-separated scenario list, trimming and dropping blanks", () => {
    const config = loadSimulatorConfig({ AEOLUS_SIMULATOR_SCENARIOS: " reference-water , , second-scenario " });
    expect(config.scenarios).toEqual(["reference-water", "second-scenario"]);
  });

  it("reads broker credentials without embedding them in the URL", () => {
    const config = loadSimulatorConfig({
      MQTT_BROKER_URL: "mqtt://mosquitto:1883",
      MQTT_USERNAME: "sim",
      MQTT_PASSWORD: "secret",
    });
    expect(config.username).toBe("sim");
    expect(config.password).toBe("secret");
  });

  it("clamps numeric values to their configured minimums and falls back on garbage", () => {
    const config = loadSimulatorConfig({
      AEOLUS_SIMULATOR_MAX_PENDING_TIMERS: "0", // below min 1 -> clamped to 1
      AEOLUS_SIMULATOR_MAX_DELAY_MS: "-5", // below min 0 -> clamped to 0
      AEOLUS_SIMULATOR_BASE_RETRY_DELAY_MS: "not-a-number", // NaN -> default
    });
    expect(config.maxPendingTimers).toBe(1);
    expect(config.maxDelayMs).toBe(0);
    expect(config.baseRetryDelayMs).toBe(DEFAULT_BASE_RETRY_DELAY_MS);
  });

  it("parses the optional coherent state refresh interval", () => {
    expect(loadSimulatorConfig({ AEOLUS_SIMULATOR_STATE_REFRESH_MS: "300000" }).stateRefreshMs).toBe(300000);
    expect(loadSimulatorConfig({ AEOLUS_SIMULATOR_STATE_REFRESH_MS: "-1" }).stateRefreshMs).toBe(0);
  });

  it("prefers the simulator log level over the shared LOG_LEVEL", () => {
    expect(loadSimulatorConfig({ LOG_LEVEL: "warn" }).logLevel).toBe("warn");
    expect(loadSimulatorConfig({ LOG_LEVEL: "warn", AEOLUS_SIMULATOR_LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });
});

describe("redactBrokerUrl", () => {
  it("redacts embedded userinfo", () => {
    expect(redactBrokerUrl("mqtt://user:pass@mosquitto:1883")).not.toContain("pass");
    expect(redactBrokerUrl("mqtt://user:pass@mosquitto:1883")).toContain("***");
  });

  it("leaves a credential-free URL intact", () => {
    expect(redactBrokerUrl("mqtt://mosquitto:1883")).toBe("mqtt://mosquitto:1883");
  });

  it("falls back to a regex redaction for an unparseable URL", () => {
    expect(redactBrokerUrl("://user:pass@host")).toContain("***");
    expect(redactBrokerUrl("://user:pass@host")).not.toContain("pass");
  });
});

describe("describeSimulatorConfig", () => {
  it("never exposes credentials, only their presence", () => {
    const config = loadSimulatorConfig({
      MQTT_BROKER_URL: "mqtt://user:pass@mosquitto:1883",
      MQTT_USERNAME: "sim",
      MQTT_PASSWORD: "secret",
    });
    const described = describeSimulatorConfig(config);
    const serialized = JSON.stringify(described);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("pass");
    expect(described.hasCredentials).toBe(true);
    expect(described.broker).not.toContain("pass");
  });

  it("reports hasCredentials false when no credentials are configured", () => {
    const described = describeSimulatorConfig(loadSimulatorConfig({}));
    expect(described.hasCredentials).toBe(false);
    expect(described.hasRandomSeed).toBe(false);
    expect(described.stateRefreshMs).toBe(DEFAULT_STATE_REFRESH_MS);
  });
});
