import dotenv from "dotenv";

dotenv.config();

export interface Config {
  mqttBrokerUrl: string;
  mqttTopics: string[];
  port: number;
  dbPath: string;
  logLevel: string;
  nodeEnv: string;
  simulator: boolean;
}

export const config: Config = {
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || "mqtt://localhost:1883",
  mqttTopics: (process.env.MQTT_TOPICS || "sensor/#,switch/#,motion/#,light/#")
    .split(",")
    .map((t) => t.trim()),
  port: parseInt(process.env.PORT || "3001", 10),
  dbPath: process.env.DB_PATH || "./data/aeolus.db",
  logLevel: process.env.LOG_LEVEL || "debug",
  nodeEnv: process.env.NODE_ENV || "development",
  simulator: process.env.SIMULATOR === "true",
};
