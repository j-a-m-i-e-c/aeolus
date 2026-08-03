import dotenv from "dotenv";

import { DEFAULT_CONFIRM_TIMEOUT_MS } from "./core/types.js";

dotenv.config();

export interface Config {
  mqttBrokerUrl: string;
  mqttTopics: string[];
  /** Topic leaf names ignored by automatic device discovery. */
  mqttDiscoveryIgnoredTopicSuffixes: string[];
  /** Dashboard-managed Mosquitto provisioning is opt-in while under development. */
  managedMqttProvisioningEnabled: boolean;
  /**
   * Broker-side verification of managed provisioning changes. After writing
   * config/password files and triggering a reload, the provisioning service
   * probes the broker to confirm the new policy is actually enforced before
   * reporting success. Only active when managedMqttProvisioningEnabled is true.
   */
  mqttProvisioningVerify: {
    /** Total polling budget to confirm a change (ms). */
    budgetMs: number;
    /** Gap between poll attempts (ms). */
    pollIntervalMs: number;
    /** Per-attempt connection timeout (ms). */
    connectTimeoutMs: number;
  };
  port: number;
  dbPath: string;
  logLevel: string;
  nodeEnv: string;
  stateHistoryMax: number;
  historyRecordInterval: number;
  rateLimitRpm: number;
  corsOrigins: string[];
  /**
   * Maximum confirmation timeout the Command_Service can apply to a command
   * (ms). Acts as the inner bound the REST device-action timeout must exceed
   * (Req 3.7). Defaults to {@link DEFAULT_CONFIRM_TIMEOUT_MS}.
   */
  maxConfirmTimeoutMs: number;
  /**
   * Outer safety timeout (ms) the REST device-action route applies when
   * submitting a command to the Command_Service (Req 3.6, 3.7). Must be >=
   * maxConfirmTimeoutMs so it never preempts a command still awaiting
   * acknowledgement or observation (asserted at startup).
   */
  restActionTimeoutMs: number;
  /**
   * Raw MQTT publish endpoint confinement (mqtt-publish-confinement spec).
   * The reserved system prefixes are NOT configured here; they are derived at
   * the composition root from the same ack topic filter the ingestion path
   * consumes, so the denied namespace cannot drift from the forged-ack surface.
   */
  mqttPublish: {
    /** Prefix non-admin publishes are confined to. Default "aeolus/pub/". */
    userNamespacePrefix: string;
    /** Maximum serialized publish payload size in bytes. Default 262144 (256 KiB). */
    maxPayloadBytes: number;
  };
  /**
   * Public demo mode (public-demo-mode spec). When enabled, anonymous visitors
   * receive a short-lived `public-demo` session constrained to a fail-closed
   * allowlist. OFF by default and never inferred from hostname/NODE_ENV — a
   * normal Aeolus install must never behave as a public demo.
   */
  publicDemo: {
    /** Master switch. Default false. */
    enabled: boolean;
    /** Demo access-token lifetime in minutes. Default 120. */
    sessionMinutes: number;
    /** Local time (HH:MM) the nightly reset runs, for display/scheduling. Default "03:30". */
    resetTime: string;
  };
}

export const config: Config = {
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || "mqtt://localhost:1883",
  mqttTopics: (process.env.MQTT_TOPICS || "#")
    .split(",")
    .map((t) => t.trim()),
  mqttDiscoveryIgnoredTopicSuffixes: (process.env.MQTT_DISCOVERY_IGNORED_TOPIC_SUFFIXES
    ?? "set,command,cmd,heartbeat,availability")
    .split(",")
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean),
  managedMqttProvisioningEnabled: process.env.MQTT_MANAGED_PROVISIONING_ENABLED === "true",
  mqttProvisioningVerify: {
    budgetMs: parseInt(process.env.MQTT_PROVISIONING_VERIFY_BUDGET_MS || "12000", 10),
    pollIntervalMs: parseInt(process.env.MQTT_PROVISIONING_VERIFY_POLL_MS || "500", 10),
    connectTimeoutMs: parseInt(process.env.MQTT_PROVISIONING_VERIFY_TIMEOUT_MS || "3000", 10),
  },
  port: parseInt(process.env.PORT || "3001", 10),
  dbPath: process.env.DB_PATH || "./data/aeolus.db",
  logLevel: process.env.LOG_LEVEL || "debug",
  nodeEnv: process.env.NODE_ENV || "development",
  stateHistoryMax: parseInt(process.env.STATE_HISTORY_MAX || "100", 10),
  historyRecordInterval: parseInt(process.env.HISTORY_RECORD_INTERVAL || "5000", 10),
  rateLimitRpm: parseInt(process.env.RATE_LIMIT_RPM || "1000", 10),
  corsOrigins: process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) || [],
  maxConfirmTimeoutMs: parseInt(
    process.env.MAX_CONFIRM_TIMEOUT_MS || String(DEFAULT_CONFIRM_TIMEOUT_MS),
    10,
  ),
  restActionTimeoutMs: parseInt(process.env.REST_ACTION_TIMEOUT_MS || "7000", 10),
  mqttPublish: {
    userNamespacePrefix: process.env.MQTT_PUBLISH_USER_NAMESPACE || "aeolus/pub/",
    maxPayloadBytes: parseInt(process.env.MQTT_PUBLISH_MAX_BYTES || "262144", 10),
  },
  publicDemo: {
    enabled: process.env.AEOLUS_PUBLIC_DEMO === "true",
    sessionMinutes: parseInt(process.env.DEMO_SESSION_MINUTES || "120", 10),
    resetTime: process.env.DEMO_RESET_TIME || "03:30",
  },
};

// Startup assertion: the REST outer timeout must never preempt a command still
// legitimately awaiting acknowledgement/observation (Req 3.7).
if (config.restActionTimeoutMs < config.maxConfirmTimeoutMs) {
  throw new Error(
    `Configuration error: restActionTimeoutMs (${config.restActionTimeoutMs}) must be >= maxConfirmTimeoutMs (${config.maxConfirmTimeoutMs})`,
  );
}
