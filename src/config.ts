import dotenv from "dotenv";

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
};
