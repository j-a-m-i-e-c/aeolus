// src/simulator/config.ts
// phase-2-mqtt-simulator Task 1 — simulator process configuration.
//
// The simulator is a SEPARATE process from the Aeolus backend. It never imports
// the backend `config.ts` (which loads the whole backend environment); instead
// it parses only the simulator-relevant environment into a small typed shape.
// The simulator is OFF by default: `AEOLUS_SIMULATOR_ENABLED` must be "true".

/** Parsed, validated configuration for the simulator runtime. */
export interface SimulatorConfig {
  /** Master switch. The process exits without connecting unless this is true. */
  enabled: boolean;
  /** MQTT broker URL, e.g. "mqtt://mosquitto:1883". */
  brokerUrl: string;
  /** MQTT client id used when connecting to the broker. */
  clientId: string;
  /** Optional broker username (never logged). */
  username?: string;
  /** Optional broker password (never logged). */
  password?: string;
  /** Scenario keys to load, e.g. ["reference-water"]. */
  scenarios: string[];
  /** Optional deterministic seed for scenario pseudo-random telemetry. */
  randomSeed?: string;
  /** Upper bound (ms) applied to any model-requested ACK/state delay. */
  maxDelayMs: number;
  /** Maximum number of outstanding delayed operations across the runtime. */
  maxPendingTimers: number;
  /** Maximum queued commands per device before fail-fast drop. */
  maxCommandQueueDepth: number;
  /** Base reconnect backoff delay (ms). */
  baseRetryDelayMs: number;
  /** Maximum reconnect backoff delay (ms). */
  maxBackoffMs: number;
  /** Log level for the simulator's own logger. */
  logLevel: string;
}

/** Default reconnect backoff base delay, matching the backend MQTT service. */
export const DEFAULT_BASE_RETRY_DELAY_MS = 1000;
/** Default reconnect backoff ceiling, matching the backend MQTT service. */
export const DEFAULT_MAX_BACKOFF_MS = 30_000;
/** Default ceiling for any model-requested ACK/state delay. */
export const DEFAULT_MAX_DELAY_MS = 15_000;
/** Default ceiling for outstanding delayed operations. */
export const DEFAULT_MAX_PENDING_TIMERS = 200;
/** Default per-device command-queue depth before fail-fast. */
export const DEFAULT_MAX_COMMAND_QUEUE_DEPTH = 100;
/** Default MQTT client id for the simulator process. */
export const DEFAULT_CLIENT_ID = "aeolus-simulator";

function parseIntEnv(value: string | undefined, fallback: number, min: number): number {
  const parsed = value !== undefined ? Number.parseInt(value, 10) : Number.NaN;
  if (Number.isNaN(parsed)) return fallback;
  return parsed < min ? min : parsed;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Build a {@link SimulatorConfig} from an environment record.
 *
 * Pure and side-effect free (takes the environment explicitly) so it is
 * unit-testable without mutating `process.env`.
 */
export function loadSimulatorConfig(env: NodeJS.ProcessEnv): SimulatorConfig {
  const username = env.MQTT_USERNAME?.trim();
  const password = env.MQTT_PASSWORD;
  const randomSeed = env.AEOLUS_SIMULATOR_RANDOM_SEED?.trim();

  return {
    enabled: env.AEOLUS_SIMULATOR_ENABLED === "true",
    brokerUrl: env.MQTT_BROKER_URL || "mqtt://localhost:1883",
    clientId: env.AEOLUS_SIMULATOR_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    scenarios: parseCsv(env.AEOLUS_SIMULATOR_SCENARIOS),
    ...(randomSeed ? { randomSeed } : {}),
    maxDelayMs: parseIntEnv(env.AEOLUS_SIMULATOR_MAX_DELAY_MS, DEFAULT_MAX_DELAY_MS, 0),
    maxPendingTimers: parseIntEnv(env.AEOLUS_SIMULATOR_MAX_PENDING_TIMERS, DEFAULT_MAX_PENDING_TIMERS, 1),
    maxCommandQueueDepth: parseIntEnv(env.AEOLUS_SIMULATOR_MAX_COMMAND_QUEUE, DEFAULT_MAX_COMMAND_QUEUE_DEPTH, 1),
    baseRetryDelayMs: parseIntEnv(env.AEOLUS_SIMULATOR_BASE_RETRY_DELAY_MS, DEFAULT_BASE_RETRY_DELAY_MS, 1),
    maxBackoffMs: parseIntEnv(env.AEOLUS_SIMULATOR_MAX_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS, 1),
    logLevel: env.AEOLUS_SIMULATOR_LOG_LEVEL?.trim() || env.LOG_LEVEL?.trim() || "info",
  };
}

/**
 * Redact any credentials embedded in a broker URL so it is safe to log
 * (Req 6.8). Userinfo (`user:pass@`) is replaced with `***`.
 */
export function redactBrokerUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "";
    }
    return parsed.toString();
  } catch {
    return url.replace(/\/\/[^@/]+@/, "//***@");
  }
}

/**
 * Produce a log-safe view of the configuration. Broker credentials are never
 * included: the URL is redacted and the presence of separate credentials is
 * reported only as a boolean (Req 6.8, 6.9).
 */
export function describeSimulatorConfig(config: SimulatorConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    broker: redactBrokerUrl(config.brokerUrl),
    clientId: config.clientId,
    hasCredentials: config.username !== undefined || config.password !== undefined,
    scenarios: config.scenarios,
    hasRandomSeed: config.randomSeed !== undefined,
    maxDelayMs: config.maxDelayMs,
    maxPendingTimers: config.maxPendingTimers,
    maxCommandQueueDepth: config.maxCommandQueueDepth,
    baseRetryDelayMs: config.baseRetryDelayMs,
    maxBackoffMs: config.maxBackoffMs,
    logLevel: config.logLevel,
  };
}
