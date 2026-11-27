import pino from "pino";
import { config } from "./config.js";
import { pushLogEntry } from "./log-buffer.js";
import { LOG_REDACT_PATHS, scrubLogLine, serializeError } from "./log-safety.js";

// Create a pino destination that also captures entries into the log buffer
const dest = pino.destination({ fd: 1, sync: false });

// Wrap the destination to intercept writes. Every serialized line is scrubbed once,
// here, so stdout and the admin-visible buffer receive exactly the same safe text.
const originalWrite = dest.write.bind(dest);
dest.write = function (chunk: string) {
  const safe = scrubLogLine(chunk);
  pushLogEntry(safe);
  return originalWrite(safe);
};

const logger = pino(
  {
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    // Errors are reduced to an allowlist of fields (log-safety.ts): no bodies, configs or headers.
    serializers: { err: serializeError, error: (value: unknown) => (value instanceof Error ? serializeError(value) : value) },
    redact: { paths: LOG_REDACT_PATHS, censor: "[redacted]" },
  },
  dest,
);

export default logger;