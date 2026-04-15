// src/log-buffer.ts — In-memory circular buffer for recent log entries

export interface LogEntry {
  level: number;
  levelLabel: string;
  msg: string;
  time: string;
  [key: string]: unknown;
}

const MAX_ENTRIES = 200;
const buffer: LogEntry[] = [];

const LEVEL_LABELS: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

/**
 * Add a log entry to the circular buffer.
 * Called by the pino write hook in logger.ts.
 */
export function pushLogEntry(raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    const entry: LogEntry = {
      level: parsed.level,
      levelLabel: LEVEL_LABELS[parsed.level] || "unknown",
      msg: parsed.msg || "",
      time: parsed.time || new Date().toISOString(),
      ...parsed,
    };
    // Remove pino internals that aren't useful in the UI
    delete entry.pid;
    delete entry.hostname;

    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) {
      buffer.shift();
    }
  } catch {
    // Ignore unparseable log lines
  }
}

/**
 * Get the last N log entries (most recent first).
 */
export function getRecentLogs(count = 100): LogEntry[] {
  return buffer.slice(-count).reverse();
}
