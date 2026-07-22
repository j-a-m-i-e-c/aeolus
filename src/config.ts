import dotenv from "dotenv";

import { DEFAULT_CONFIRM_TIMEOUT_MS } from "./core/types.js";

dotenv.config();

export interface Config {
  mqttBrokerUrl: string;
  mqttTopics: string[];
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
}

export const config: Config = {
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || "mqtt://localhost:1883",
  mqttTopics: (process.env.MQTT_TOPICS || "#")
    .split(",")
    .map((t) => t.trim()),
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
};

// Startup assertion: the REST outer timeout must never preempt a command still
// legitimately awaiting acknowledgement/observation (Req 3.7).
if (config.restActionTimeoutMs < config.maxConfirmTimeoutMs) {
  throw new Error(
    `Configuration error: restActionTimeoutMs (${config.restActionTimeoutMs}) must be >= maxConfirmTimeoutMs (${config.maxConfirmTimeoutMs})`,
  );
}
