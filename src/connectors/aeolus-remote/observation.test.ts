// src/connectors/aeolus-remote/observation.test.ts — freshness, source time and the
// fail-closed / keep-stale split.
import { describe, expect, it } from "vitest";
import { parseRemoteConfig, type RemoteConfig } from "./config.js";
import {
  MAX_BACKOFF_MS,
  MAX_SOURCE_CLOCK_AHEAD_MS,
  describe as describeReason,
  failureReason,
  initialObservation,
  nextDelayMs,
  nextObservation,
  parseSourceTime,
  retryAfterMs,
  type RemoteObservation,
} from "./observation.js";
import type { TransportResult } from "./transport.js";

const KEY = "aeo_0123456789abcdef_" + "A".repeat(43);
const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);

function config(over: Record<string, unknown> = {}): RemoteConfig {
  const parsed = parseRemoteConfig({
    baseUrl: "https://aeolus-a.lan:3001",
    endpointPath: "/api/exposed/v1/site-a/conditions/summary",
    apiKey: KEY,
    sourceTimeField: "observedAt",
    staleAfterSeconds: 300,
    ...over,
  });
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.config;
}

function ok(body: unknown, extra: Partial<Extract<TransportResult, { kind: "response" }>> = {}): TransportResult {
  return { kind: "response", status: 200, body: Buffer.from(JSON.stringify(body)), contentType: "application/json; charset=utf-8", date: "Wed, 25 Nov 2026 08:59:59 GMT", retryAfter: null, ...extra };
}
const status = (code: number, retryAfter: string | null = null): TransportResult =>
  ({ kind: "response", status: code, body: Buffer.alloc(0), contentType: null, date: null, retryAfter });

function poll(result: TransportResult, cfg = config(), previous?: RemoteObservation, now = NOW) {
  return nextObservation(previous ?? initialObservation(cfg), cfg, result, now);
}

describe("initial state", () => {
  it("starts with no data, stale, never fetched, and every key present", () => {
    const o = initialObservation(config());
    expect(o).toMatchObject({ data: null, stale: true, staleReason: "never-fetched", fetchedAt: null, sourceTime: null, lastKnown: null, transport: "https" });
    expect(Object.values(o).every((value) => value !== undefined)).toBe(true);
  });
});

describe("source time", () => {
  it("accepts Unix milliseconds and ISO 8601 with a zone, and rejects everything else", () => {
    expect(parseSourceTime(NOW)).toBe(NOW);
    expect(parseSourceTime("2026-11-25T08:58:00Z")).toBe(Date.UTC(2026, 10, 25, 8, 58));
    expect(parseSourceTime("2026-11-25T19:58:00+11:00")).toBe(Date.UTC(2026, 10, 25, 8, 58));
    for (const bad of ["2026-11-25T08:58:00", "2026-11-25", "yesterday", "", "2026-13-45T99:99:00Z", NOW / 1000, Number.NaN, Infinity, -1, true, {}, []]) {
      expect(parseSourceTime(bad), String(bad)).toBeNull();
    }
  });

  it("takes the source time from the payload, never from the HTTP Date header", () => {
    const { observation } = poll(ok({ level: 61, observedAt: NOW - 60_000 }));
    expect(observation).toMatchObject({ sourceTime: NOW - 60_000, sourceTimeBasis: "payload", sourceAgeMs: 60_000, fetchedAt: NOW, stale: false, staleReason: null });
    expect(observation.responseDate).toBe(Date.UTC(2026, 10, 25, 8, 59, 59));
  });

  it("reports a missing timestamp as unavailable, not as the fetch or response time", () => {
    const { observation } = poll(ok({ level: 61 }));
    expect(observation).toMatchObject({ sourceTime: null, sourceTimeBasis: "unavailable", sourceTimeProblem: "missing", sourceAgeMs: null, stale: false });
    expect(observation.fetchedAt).toBe(NOW);
  });

  it("reports an invalid timestamp as invalid, and no field configured as not-configured", () => {
    expect(poll(ok({ observedAt: "last Tuesday" })).observation).toMatchObject({ sourceTime: null, sourceTimeProblem: "invalid", sourceTimeBasis: "unavailable" });
    expect(poll(ok({ observedAt: NOW }), config({ sourceTimeField: "" })).observation).toMatchObject({ sourceTime: null, sourceTimeProblem: "not-configured" });
    // A nested path, and a payload that is not an object.
    expect(poll(ok({ reading: { at: NOW - 1000 } }), config({ sourceTimeField: "reading.at" })).observation.sourceTime).toBe(NOW - 1000);
    expect(poll(ok([1, 2, 3])).observation.sourceTimeProblem).toBe("missing");
  });

  it("marks a successful fetch of an old reading stale", () => {
    const { observation, succeeded } = poll(ok({ observedAt: NOW - 301_000 }));
    expect(succeeded).toBe(true);
    expect(observation).toMatchObject({ stale: true, staleReason: "source-age", sourceAgeMs: 301_000, fetchedAt: NOW, data: { observedAt: NOW - 301_000 } });
  });

  it("treats a source clock a little ahead as ordinary clock difference", () => {
    const { observation } = poll(ok({ observedAt: NOW + MAX_SOURCE_CLOCK_AHEAD_MS }));
    expect(observation).toMatchObject({ stale: false, sourceAgeMs: 0, sourceTimeProblem: null });
  });

  it("flags a source clock far ahead instead of treating it as a future observation", () => {
    const { observation } = poll(ok({ observedAt: NOW + 90 * 60_000 }));
    expect(observation).toMatchObject({ stale: true, staleReason: "source-clock-ahead", sourceTimeProblem: "ahead", sourceAgeMs: null, sourceTime: NOW + 90 * 60_000 });
  });

  it("can require a source time", () => {
    expect(poll(ok({ level: 1 }), config({ requireSourceTime: true })).observation).toMatchObject({ stale: true, staleReason: "no-source-time" });
  });
});

describe("failures", () => {
  const good = () => poll(ok({ level: 61, observedAt: NOW - 1000 })).observation;

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found-or-not-granted"],
    [400, "bad-request"],
    [405, "bad-request"],
    [302, "redirect-refused"],
    [307, "redirect-refused"],
  ])("%i fails closed: data withdrawn, last reading kept apart for diagnostics", (code, reason) => {
    const previous = good();
    const { observation, succeeded } = poll(status(code), config(), previous, NOW + 5000);
    expect(succeeded).toBe(false);
    expect(observation).toMatchObject({ data: null, sourceTime: null, fetchedAt: null, stale: true, staleReason: reason, httpStatus: code, lastAttemptAt: NOW + 5000 });
    expect(observation.lastKnown).toEqual({ data: { level: 61, observedAt: NOW - 1000 }, sourceTime: NOW - 1000, fetchedAt: NOW });
    expect(observation.lastSuccessAt).toBe(NOW);
  });

  it("does not claim a 404 proves revocation, and points a 403 at HTTPS enforcement", () => {
    expect(describeReason("not-found-or-not-granted")).toMatch(/does not say which/);
    expect(describeReason("not-found-or-not-granted")).not.toMatch(/revoked/);
    expect(describeReason("forbidden")).toMatch(/EXPOSED_API_REQUIRE_HTTPS/);
    expect(describeReason("unauthorized")).toMatch(/expired or revoked/);
  });

  it.each([
    [status(503), "remote-unavailable"],
    [status(500), "remote-error"],
    [status(504), "remote-error"],
    [status(429, "30"), "rate-limited"],
    [{ kind: "failure", reason: "timeout" } as TransportResult, "timeout"],
    [{ kind: "failure", reason: "connection-refused" } as TransportResult, "connection-refused"],
    [{ kind: "failure", reason: "dns" } as TransportResult, "dns"],
    [{ kind: "failure", reason: "tls" } as TransportResult, "tls"],
    [ok({}, { contentType: "text/html" }), "invalid-response"],
    [{ ...ok({}), body: Buffer.from("{not json") } as TransportResult, "invalid-response"],
    [{ ...ok({}), body: Buffer.from([0xff, 0xfe, 0x7b]) } as TransportResult, "invalid-response"],
  ])("an outage keeps the last data, marked stale (%#)", (result, reason) => {
    const previous = good();
    const { observation } = poll(result, config(), previous, NOW + 5000);
    expect(observation).toMatchObject({ data: { level: 61, observedAt: NOW - 1000 }, sourceTime: NOW - 1000, fetchedAt: NOW, stale: true, staleReason: reason });
    expect(observation.error).toBe(describeReason(reason as never));
  });

  it("refuses an address-policy failure closed", () => {
    expect(poll({ kind: "failure", reason: "address-refused" }, config(), good()).observation.data).toBeNull();
  });

  it("recovers on the next good response and clears the error", () => {
    const failed = poll(status(503), config(), good(), NOW + 5000).observation;
    const back = poll(ok({ level: 62, observedAt: NOW + 9000 }), config(), failed, NOW + 10_000).observation;
    expect(back).toMatchObject({ data: { level: 62, observedAt: NOW + 9000 }, stale: false, staleReason: null, error: null, httpStatus: 200, fetchedAt: NOW + 10_000 });
  });

  it("classifies statuses without reading a body", () => {
    expect(failureReason(status(418))).toBe("bad-request");
    expect(failureReason({ kind: "failure", reason: "network" })).toBe("network");
  });
});

describe("scheduling", () => {
  it("polls at the interval, backs off on failure up to four intervals, and honours Retry-After", () => {
    const cfg = config({ pollIntervalSeconds: 5 });
    expect(nextDelayMs(cfg, 0, null)).toBe(5000);
    expect([1, 2, 3, 9].map((n) => nextDelayMs(cfg, n, null))).toEqual([10_000, 20_000, 20_000, 20_000]);
    expect(nextDelayMs(cfg, 1, 30_000)).toBe(30_000);
    expect(nextDelayMs(cfg, 1, 1000)).toBe(5000);
    // A long interval is never shortened by a backoff, and never exceeds it either.
    const slow = config({ pollIntervalSeconds: 3600, staleAfterSeconds: 7200 });
    expect(nextDelayMs(slow, 3, null)).toBe(3_600_000);
  });

  it("reads Retry-After as seconds or an HTTP date, capped at 15 minutes", () => {
    expect(retryAfterMs("12", NOW)).toBe(12_000);
    expect(retryAfterMs(new Date(NOW + 60_000).toUTCString(), NOW)).toBe(60_000);
    expect(retryAfterMs("999999", NOW)).toBe(MAX_BACKOFF_MS);
    expect(retryAfterMs("soon", NOW)).toBeNull();
    expect(retryAfterMs(null, NOW)).toBeNull();
    expect(retryAfterMs(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(0);
  });
});
