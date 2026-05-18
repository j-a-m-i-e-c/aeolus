// src/metrics/metrics-history-config.ts — Configuration validation for MetricsHistoryService

/** Validated configuration output from parseMetricsHistoryConfig */
export interface ValidatedMetricsHistoryConfig {
  /** Tier 1 sampling interval in milliseconds (default: 30,000, min: 5,000) */
  samplingIntervalMs: number;
  /** Tier 2 aggregation interval in milliseconds (default: 300,000, min: 60,000) */
  aggregationIntervalMs: number;
  /** Retention for live collections in minutes (default: 10, min: 5) */
  liveRetentionMinutes: number;
}

/** Logger interface accepted by the config parser (subset of pino) */
export interface ConfigLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Default configuration values */
const DEFAULTS = {
  samplingIntervalMs: 30_000,
  aggregationIntervalMs: 300_000,
  liveRetentionMinutes: 10,
} as const;

/** Minimum allowed values */
const MINIMUMS = {
  samplingIntervalMs: 5_000,
  aggregationIntervalMs: 60_000,
  liveRetentionMinutes: 5,
} as const;

/** Environment variable names */
const ENV_KEYS = {
  samplingIntervalMs: "METRICS_HISTORY_INTERVAL_MS",
  aggregationIntervalMs: "METRICS_HISTORY_AGGREGATION_INTERVAL_MS",
  liveRetentionMinutes: "METRICS_HISTORY_LIVE_RETENTION_MINUTES",
} as const;

/**
 * Parse a single numeric environment variable with default and minimum clamping.
 * Returns the parsed value, clamped to minimum if below threshold.
 * Logs warnings for invalid or clamped values. Missing values use defaults silently.
 */
function parseNumericEnv(
  raw: string | undefined,
  envKey: string,
  defaultValue: number,
  minimum: number,
  logger?: ConfigLogger,
): number {
  // Missing env var — use default silently (no warning)
  if (raw === undefined || raw === "") {
    return defaultValue;
  }

  const parsed = Number(raw);

  // Non-numeric or non-positive value — log warning, use default
  if (isNaN(parsed) || parsed <= 0) {
    logger?.warn(
      { envKey, value: raw, default: defaultValue },
      `Invalid value for ${envKey}: "${raw}" is not a positive number, using default ${defaultValue}`,
    );
    return defaultValue;
  }

  // Below minimum — log warning, clamp to minimum
  if (parsed < minimum) {
    logger?.warn(
      { envKey, value: parsed, minimum },
      `Value for ${envKey} (${parsed}) is below minimum ${minimum}, clamping to ${minimum}`,
    );
    return minimum;
  }

  return parsed;
}

/**
 * Parse and validate metrics history configuration from environment variables.
 * Invalid values are clamped to safe minimums with warning logs.
 * Missing values use defaults silently (no warning).
 *
 * @param env - Environment variable map (typically process.env)
 * @param logger - Optional logger for warning messages
 * @returns Validated configuration with all values guaranteed within safe bounds
 */
export function parseMetricsHistoryConfig(
  env: Record<string, string | undefined>,
  logger?: ConfigLogger,
): ValidatedMetricsHistoryConfig {
  return {
    samplingIntervalMs: parseNumericEnv(
      env[ENV_KEYS.samplingIntervalMs],
      ENV_KEYS.samplingIntervalMs,
      DEFAULTS.samplingIntervalMs,
      MINIMUMS.samplingIntervalMs,
      logger,
    ),
    aggregationIntervalMs: parseNumericEnv(
      env[ENV_KEYS.aggregationIntervalMs],
      ENV_KEYS.aggregationIntervalMs,
      DEFAULTS.aggregationIntervalMs,
      MINIMUMS.aggregationIntervalMs,
      logger,
    ),
    liveRetentionMinutes: parseNumericEnv(
      env[ENV_KEYS.liveRetentionMinutes],
      ENV_KEYS.liveRetentionMinutes,
      DEFAULTS.liveRetentionMinutes,
      MINIMUMS.liveRetentionMinutes,
      logger,
    ),
  };
}
