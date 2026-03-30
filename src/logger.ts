import pino from "pino";
import { config } from "./config.js";

const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
