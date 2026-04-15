import pino from "pino";
import { config } from "./config.js";
import { pushLogEntry } from "./log-buffer.js";

// Create a pino destination that also captures entries into the log buffer
const dest = pino.destination({ fd: 1, sync: false });

// Wrap the destination to intercept writes
const originalWrite = dest.write.bind(dest);
dest.write = function (chunk: string) {
  pushLogEntry(chunk);
  return originalWrite(chunk);
};

const logger = pino(
  {
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  dest,
);

export default logger;
