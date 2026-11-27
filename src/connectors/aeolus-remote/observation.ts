// src/connectors/aeolus-remote/observation.ts — what a poll outcome means for the
// remote observation. Pure: every input, including the clock, is passed in.
//
// Two clocks are kept apart. `sourceTime` is when A says the reading was observed,
// taken only from a configured payload field; it is never the HTTP Date header,
// which describes the response, not the measurement (that is `responseDate`).
// `fetchedAt` is when B received and validated the response. A successful fetch can
// still carry an old reading, so freshness is judged on the source time when there
// is one.
//
// Refusals fail closed: on 401, 403, 404, another 4xx, a redirect or a refused
// address, `data` becomes null so no automation keeps acting on withdrawn access.
// The last good reading is kept apart in `lastKnown`, for diagnostics only.
// Outages (timeouts, network, DNS, TLS, 429, 5xx, an invalid body) keep the
// last data but mark it stale. Every failure marks the observation stale.

import type { RemoteConfig } from "./config.js";
import type { TransportFailure, TransportResult } from "./transport.js";

/** How far ahead of B's clock a source time may be and still count as clock difference. */
export const MAX_SOURCE_CLOCK_AHEAD_MS = 120_000;
/** Source times before this are rejected as invalid (catches seconds-for-milliseconds). */
const EARLIEST_SOURCE_TIME = Date.UTC(2000, 0, 1);
/** Longest wait a 429 Retry-After may impose, and the failure backoff ceiling. */
export const MAX_BACKOFF_MS = 15 * 60_000;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type StaleReason =
  | "never-fetched"
  | "source-age"
  | "source-clock-ahead"
  | "no-source-time"
  | "unauthorized"
  | "forbidden"
  | "not-found-or-not-granted"
  | "bad-request"
  | "redirect-refused"
  | "rate-limited"
  | "remote-unavailable"
  | "remote-error"
  | "invalid-response"
  | TransportFailure;

export type SourceTimeProblem = "not-configured" | "missing" | "invalid" | "ahead";

export interface LastKnown {
  data: unknown;
  sourceTime: number | null;
  fetchedAt: number;
}

/** The device state. Every key is always present, so a merge never leaves an old value. */
export interface RemoteObservation {
  /** The current reading, or null when there is none or access was refused. */
  data: unknown;
  /** When A says `data` was observed (from the payload), or null. */
  sourceTime: number | null;
  sourceTimeBasis: "payload" | "unavailable";
  sourceTimeProblem: SourceTimeProblem | null;
  /** fetchedAt − sourceTime, never negative; null when the source time is not usable. */
  sourceAgeMs: number | null;
  /** The peer's HTTP Date header for the response `data` came from: response metadata only. */
  responseDate: number | null;
  /** When B received and validated the response `data` came from. */
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  stale: boolean;
  staleReason: StaleReason | null;
  staleAfterMs: number;
  httpStatus: number | null;
  /** A fixed, safe description of the last failure; never a host, key or remote text. */
  error: string | null;
  /** The last good reading, kept for diagnostics only. Never treat it as live. */
  lastKnown: LastKnown | null;
  transport: "https" | "http-plaintext";
  endpointPath: string;
}

export function initialObservation(config: RemoteConfig): RemoteObservation {
  return {
    data: null,
    sourceTime: null,
    sourceTimeBasis: "unavailable",
    sourceTimeProblem: null,
    sourceAgeMs: null,
    responseDate: null,
    fetchedAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    stale: true,
    staleReason: "never-fetched",
    staleAfterMs: config.staleAfterMs,
    httpStatus: null,
    error: null,
    lastKnown: null,
    transport: config.protocol === "https:" ? "https" : "http-plaintext",
    endpointPath: config.endpointPath,
  };
}

const MESSAGES: Record<StaleReason, string> = {
  "never-fetched": "No reading has been received yet.",
  "source-age": "The reading was received, but the remote says it was observed longer ago than the stale-after limit.",
  "source-clock-ahead": "The remote's source time is ahead of this installation's clock by more than two minutes; check both clocks.",
  "no-source-time": "The reading has no usable source time, and this connector requires one.",
  unauthorized: "The remote refused the key (401): it is missing, invalid, expired or revoked, or the client is disabled.",
  forbidden: "The remote refused the request (403). It may require HTTPS (EXPOSED_API_REQUIRE_HTTPS) while this connection is plain HTTP.",
  "not-found-or-not-granted":
    "The remote answered 404: the API may be unknown or unpublished, the route missing, or not granted to this client. The remote does not say which.",
  "bad-request": "The remote rejected the request as malformed; check the endpoint path.",
  "redirect-refused": "The remote answered with a redirect. Redirects are never followed and the key is not sent on; configure the final URL.",
  "rate-limited": "The remote is limiting requests (429); polling waits as it asked.",
  "remote-unavailable": "The remote API is unavailable (503), for example disabled or busy.",
  "remote-error": "The remote API failed (5xx).",
  "invalid-response": "The remote answered with a response that is not a valid JSON reading.",
  dns: "The remote host name could not be resolved.",
  "address-refused": "The remote host resolved to an address this connector never dials (loopback, link-local, metadata, multicast or reserved).",
  "connection-refused": "The remote refused the connection.",
  "connect-timeout": "Connecting to the remote timed out.",
  timeout: "The remote did not answer within the request deadline.",
  tls: "The remote's TLS certificate could not be verified for the configured host.",
  network: "The connection to the remote failed.",
  "response-too-large": "The remote's response is larger than the configured maximum.",
  aborted: "The request was cancelled.",
};

export function describe(reason: StaleReason): string {
  return MESSAGES[reason];
}

/** Read a dotted path from a JSON value. */
function readPath(data: unknown, path: string): unknown {
  let value: unknown = data;
  for (const part of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Unix milliseconds, or an ISO-8601 string with an explicit zone. */
export function parseSourceTime(value: unknown): number | null {
  let time: number;
  if (typeof value === "number") time = value;
  else if (typeof value === "string" && ISO_WITH_ZONE.test(value)) time = Date.parse(value);
  else return null;
  if (!Number.isFinite(time) || time < EARLIEST_SOURCE_TIME) return null;
  return Math.trunc(time);
}

function parseHttpDate(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** A 429's Retry-After (seconds or HTTP date) in milliseconds, capped; null if absent. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : (parseHttpDate(trimmed) ?? Number.NaN) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(MAX_BACKOFF_MS, Math.max(0, ms));
}

/** Outcome categories that withdraw the reading rather than only marking it stale. */
const REFUSALS = new Set<StaleReason>(["unauthorized", "forbidden", "not-found-or-not-granted", "bad-request", "redirect-refused", "address-refused"]);

export function failureReason(result: TransportResult): StaleReason {
  if (result.kind === "failure") return result.reason;
  const { status } = result;
  if (status >= 300 && status < 400) return "redirect-refused";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found-or-not-granted";
  if (status === 429) return "rate-limited";
  if (status === 503) return "remote-unavailable";
  if (status >= 500) return "remote-error";
  return "bad-request";
}

function isJson(contentType: string | null): boolean {
  return contentType !== null && /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i.test(contentType);
}

export interface PollOutcome {
  observation: RemoteObservation;
  succeeded: boolean;
  reason: StaleReason | null;
}

/** The next observation, from the previous one, a transport result and the time it finished. */
export function nextObservation(previous: RemoteObservation, config: RemoteConfig, result: TransportResult, now: number): PollOutcome {
  const base: RemoteObservation = {
    ...previous,
    staleAfterMs: config.staleAfterMs,
    transport: config.protocol === "https:" ? "https" : "http-plaintext",
    endpointPath: config.endpointPath,
    lastAttemptAt: now,
    httpStatus: result.kind === "response" ? result.status : null,
  };

  if (result.kind === "response" && result.status >= 200 && result.status < 300) {
    const parsed = isJson(result.contentType) ? safeParse(result.body) : { ok: false as const };
    if (!parsed.ok) return failed(base, "invalid-response");
    return { observation: fresh(base, config, parsed.value, parseHttpDate(result.date), now), succeeded: true, reason: null };
  }
  return failed(base, failureReason(result));
}

function safeParse(body: Buffer): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) };
  } catch {
    return { ok: false };
  }
}

function fresh(base: RemoteObservation, config: RemoteConfig, data: unknown, responseDate: number | null, now: number): RemoteObservation {
  let sourceTime: number | null = null;
  let problem: SourceTimeProblem | null = null;
  if (!config.sourceTimeField) {
    problem = "not-configured";
  } else {
    const raw = readPath(data, config.sourceTimeField);
    if (raw === undefined || raw === null) problem = "missing";
    else {
      sourceTime = parseSourceTime(raw);
      if (sourceTime === null) problem = "invalid";
    }
  }

  let sourceAgeMs: number | null = null;
  let staleReason: StaleReason | null = null;
  if (sourceTime !== null) {
    if (sourceTime - now > MAX_SOURCE_CLOCK_AHEAD_MS) {
      problem = "ahead";
      staleReason = "source-clock-ahead";
    } else {
      // A source clock slightly ahead of ours is ordinary clock difference: age 0.
      sourceAgeMs = Math.max(0, now - sourceTime);
      if (sourceAgeMs > config.staleAfterMs) staleReason = "source-age";
    }
  } else if (config.requireSourceTime) {
    staleReason = "no-source-time";
  }

  return {
    ...base,
    data,
    sourceTime,
    sourceTimeBasis: sourceTime !== null ? "payload" : "unavailable",
    sourceTimeProblem: problem,
    sourceAgeMs,
    responseDate,
    fetchedAt: now,
    lastSuccessAt: now,
    stale: staleReason !== null,
    staleReason,
    error: staleReason ? describe(staleReason) : null,
    lastKnown: { data, sourceTime, fetchedAt: now },
  };
}

function failed(base: RemoteObservation, reason: StaleReason): PollOutcome {
  const observation: RemoteObservation = { ...base, stale: true, staleReason: reason, error: describe(reason) };
  if (REFUSALS.has(reason)) {
    // Fail closed: withdraw the reading; lastKnown keeps it for diagnostics only.
    observation.data = null;
    observation.sourceTime = null;
    observation.sourceTimeBasis = "unavailable";
    observation.sourceTimeProblem = null;
    observation.sourceAgeMs = null;
    observation.responseDate = null;
    observation.fetchedAt = null;
  }
  return { observation, succeeded: false, reason };
}

/**
 * Delay before the next poll. Success: the configured interval. 429: the remote's
 * Retry-After, at least the interval. Other failures: the interval doubled per
 * consecutive failure, up to four intervals or 15 minutes, whichever is less, but
 * never less than one interval.
 */
export function nextDelayMs(config: RemoteConfig, consecutiveFailures: number, retryAfter: number | null): number {
  if (retryAfter !== null) return Math.min(MAX_BACKOFF_MS, Math.max(config.pollIntervalMs, retryAfter));
  if (consecutiveFailures <= 0) return config.pollIntervalMs;
  // Never sooner than the interval, so a backoff cannot poll faster than normal.
  const ceiling = Math.max(config.pollIntervalMs, Math.min(MAX_BACKOFF_MS, config.pollIntervalMs * 4));
  return Math.min(ceiling, config.pollIntervalMs * 2 ** Math.min(consecutiveFailures, 10));
}
