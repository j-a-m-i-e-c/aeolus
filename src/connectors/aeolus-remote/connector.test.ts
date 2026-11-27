// src/connectors/aeolus-remote/connector.test.ts — the connector's device, health,
// config updates and credential hygiene, with the transport replaced.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import logger from "../../logger.js";
import { AeolusRemoteConnector, PLAINTEXT_WARNING } from "./connector.js";
import { configSchema, createConnector, metadata, validateConfig } from "./index.js";
import type { TransportResult } from "./transport.js";

const KEY = "aeo_0123456789abcdef_" + "Z".repeat(43);
const NEW_KEY = "aeo_fedcba9876543210_" + "Y".repeat(43);
const NOW = Date.UTC(2026, 10, 25, 9);
const RAW = { baseUrl: "https://aeolus-a.lan:3001", endpointPath: "/api/exposed/v1/site-a/conditions/summary", apiKey: KEY, sourceTimeField: "observedAt" };

const ok = (body: unknown): TransportResult => ({ kind: "response", status: 200, body: Buffer.from(JSON.stringify(body)), contentType: "application/json", date: null, retryAfter: null });
const status = (code: number, retryAfter: string | null = null): TransportResult => ({ kind: "response", status: code, body: Buffer.alloc(0), contentType: null, date: null, retryAfter });

function make(results: TransportResult[], raw: Record<string, unknown> = RAW, instanceId = "inst-1") {
  const fetch = vi.fn(async () => results.shift() ?? status(503));
  const connector = new AeolusRemoteConnector(raw, instanceId, { fetch, now: () => NOW });
  return { connector, fetch };
}

beforeEach(() => vi.mocked(logger.warn).mockClear());

describe("module", () => {
  it("declares a read-only, multi-instance connector with a password key field", () => {
    expect(metadata).toMatchObject({ id: "aeolus-remote", multiInstance: true, requiresSetup: false });
    expect(configSchema.find((field) => field.id === "apiKey")).toMatchObject({ type: "password", required: true });
    expect(configSchema.find((field) => field.id === "allowPlaintextHttp")).toMatchObject({ type: "boolean", default: false });
    expect(validateConfig(RAW)).toEqual([]);
    expect(validateConfig({ ...RAW, baseUrl: "http://a.lan" }).join()).toMatch(/plain HTTP/);
  });

  it("needs the instance id for a stable device id", () => {
    expect(() => createConnector(RAW)).toThrow(/instance id/);
    expect(createConnector(RAW, { instanceId: "i" })).toBeInstanceOf(AeolusRemoteConnector);
  });

  it("refuses a stored config that no longer parses, without echoing the key", () => {
    expect(() => new AeolusRemoteConnector({ ...RAW, endpointPath: "/x" }, "i")).toThrow(/endpointPath/);
    try { new AeolusRemoteConnector({ ...RAW, endpointPath: "/x" }, "i"); } catch (error) { expect(String(error)).not.toContain(KEY); }
  });
});

describe("device", () => {
  it("is one read-only sensor with a stable id per instance, and every observation key", async () => {
    const { connector } = make([ok({ level: 61, observedAt: NOW - 1000 })]);
    const [device] = await connector.discoverDevices();
    expect(device).toMatchObject({ id: "aeolus-remote-inst-1", name: "Remote site-a", type: "sensor", capabilities: [], integration: "aeolus-remote", lastSeen: NOW });
    expect(device!.state).toMatchObject({ data: { level: 61, observedAt: NOW - 1000 }, sourceTime: NOW - 1000, sourceTimeBasis: "payload", stale: false, httpStatus: 200, fetchedAt: NOW });
    expect(connector.getActionCatalog("aeolus-remote-inst-1")).toEqual([]);
    await expect(connector.execute({ type: "toggle", deviceId: device!.id, params: {} } as never)).rejects.toThrow(/read-only/);
  });

  it("gives two instances on the same endpoint distinct devices", async () => {
    const a = make([ok({})], RAW, "a");
    const b = make([ok({})], RAW, "b");
    expect((await a.connector.discoverDevices())[0]!.id).not.toBe((await b.connector.discoverDevices())[0]!.id);
  });

  it("never puts the key in device state or health", async () => {
    for (const result of [ok({ observedAt: NOW }), status(401), status(503), { kind: "failure", reason: "tls" } as TransportResult]) {
      const { connector } = make([result]);
      const [device] = await connector.discoverDevices();
      expect(JSON.stringify(device)).not.toContain(KEY.slice(21));
      expect(JSON.stringify(connector.getHealthStatus())).not.toContain(KEY.slice(21));
    }
  });
});

describe("health and scheduling", () => {
  it("follows the last fetch", async () => {
    const { connector } = make([ok({ observedAt: NOW }), ok({ observedAt: NOW - 3_600_000 }), status(401)]);
    expect(connector.getHealthStatus()).toMatchObject({ status: "disconnected", lastSeen: 0 });
    await connector.discoverDevices();
    expect(connector.getHealthStatus()).toEqual({ status: "connected", lastSeen: NOW });
    await connector.discoverDevices();
    expect(connector.getHealthStatus()).toMatchObject({ status: "degraded", errorMessage: expect.stringMatching(/observed longer ago/) });
    await connector.discoverDevices();
    expect(connector.getHealthStatus()).toMatchObject({ status: "disconnected", errorMessage: expect.stringMatching(/401/) });
  });

  it("backs off after failures, waits for Retry-After, and resumes the interval on success", async () => {
    const { connector } = make([status(503), status(503), status(429, "120"), ok({})], { ...RAW, pollIntervalSeconds: 10, staleAfterSeconds: 60 });
    expect(connector.getPollIntervalMs()).toBe(10_000);
    await connector.discoverDevices();
    expect(connector.getPollIntervalMs()).toBe(20_000);
    await connector.discoverDevices();
    expect(connector.getPollIntervalMs()).toBe(40_000);
    await connector.discoverDevices();
    expect(connector.getPollIntervalMs()).toBe(120_000);
    await connector.discoverDevices();
    expect(connector.getPollIntervalMs()).toBe(10_000);
  });

  it("reports an aborted poll without changing the observation", async () => {
    const { connector } = make([ok({ observedAt: NOW }), { kind: "failure", reason: "aborted" }]);
    await connector.discoverDevices();
    const [device] = await connector.discoverDevices();
    expect(device!.state).toMatchObject({ stale: false, httpStatus: 200 });
  });

  it("aborts an in-flight request on disconnect", async () => {
    let seen: AbortSignal | undefined;
    const fetch = vi.fn((_c: unknown, signal: AbortSignal) => { seen = signal; return new Promise<TransportResult>((resolve) => signal.addEventListener("abort", () => resolve({ kind: "failure", reason: "aborted" }))); });
    const connector = new AeolusRemoteConnector(RAW, "i", { fetch });
    const pending = connector.discoverDevices();
    await connector.disconnect();
    await pending;
    expect(seen?.aborted).toBe(true);
    await connector.connect();
    fetch.mockResolvedValueOnce(ok({}));
    await connector.discoverDevices();
    // A reconnected connector polls with a live signal again.
    expect((fetch.mock.calls[1]![1] as AbortSignal).aborted).toBe(false);
  });
});

describe("config updates", () => {
  it("keeps the reading when only timing changes, and starts again for a new key or endpoint", async () => {
    const { connector } = make([ok({ observedAt: NOW }), ok({ observedAt: NOW })]);
    await connector.discoverDevices();
    connector.onConfigUpdate({ ...RAW, staleAfterSeconds: 600 });
    expect((await connector.discoverDevices())[0]!.state).toMatchObject({ staleAfterMs: 600_000, stale: false });
    connector.onConfigUpdate({ ...RAW, apiKey: NEW_KEY });
    expect(connector.getHealthStatus().status).toBe("disconnected");
  });

  it("discards a result that belongs to the config it replaced", async () => {
    let release: (value: TransportResult) => void = () => {};
    const fetch = vi.fn(() => new Promise<TransportResult>((resolve) => { release = resolve; }));
    const connector = new AeolusRemoteConnector(RAW, "i", { fetch, now: () => NOW });
    const pending = connector.discoverDevices();
    connector.onConfigUpdate({ ...RAW, apiKey: NEW_KEY });
    release(ok({ observedAt: NOW }));
    expect((await pending)[0]!.state).toMatchObject({ staleReason: "never-fetched", data: null });
  });

  it("refuses an invalid update, leaving the running config", async () => {
    const { connector } = make([ok({})]);
    expect(() => connector.onConfigUpdate({ ...RAW, baseUrl: "ftp://x" })).toThrow(/https or http/);
    await connector.discoverDevices();
    expect(connector.getHealthStatus().status).toBe("connected");
  });
});

describe("plain HTTP", () => {
  const plain = { ...RAW, baseUrl: "http://192.168.1.20:3001", allowPlaintextHttp: true };

  it("warns in the log once per connection and on the card every time, without the key", async () => {
    const { connector } = make([ok({})], plain);
    await connector.connect();
    await connector.connect();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(KEY);
    expect(connector.getHealthStatus().warnings).toEqual([PLAINTEXT_WARNING]);
    connector.onConfigUpdate({ ...plain, baseUrl: "http://192.168.1.21:3001" });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    connector.onConfigUpdate({ ...RAW });
    expect(connector.getHealthStatus().warnings).toBeUndefined();
  });

  it("marks the transport in the observation", async () => {
    const { connector } = make([ok({})], plain);
    expect((await connector.discoverDevices())[0]!.state.transport).toBe("http-plaintext");
  });
});
