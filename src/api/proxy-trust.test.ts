// src/api/proxy-trust.test.ts — forwarded headers are trusted only from a trusted proxy.
//
// Real Express, the real exposed-API router and a real express-rate-limit limiter
// configured like the login limiter, over real sockets. The trusted proxy is
// 127.0.0.1; a "direct LAN client" connects from 127.0.0.2 (still loopback on the
// test host, but outside the configured trust list).
import express, { type Express } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import rateLimit from "express-rate-limit";
import { afterEach, describe, expect, it, vi } from "vitest";

const warnings = vi.hoisted(() => [] as unknown[][]);
vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: (...args: unknown[]) => { warnings.push(args); }, error: vi.fn(), debug: vi.fn() },
}));

import { createProxyTrust, normalisePeer, parseTrustedProxies, ProxyTrustConfigError, untrustedForwardingNotice } from "./proxy-trust.js";
import { createExposedApiRouter } from "../project-api/exposed-router.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  warnings.length = 0;
});

/** The production order: trust setting, notice, a login-style limiter, a probe route, the exposed API. */
function app(hops: number, addresses = "127.0.0.1"): Express {
  const trust = createProxyTrust(hops, addresses);
  const application = express();
  application.set("trust proxy", trust.setting);
  application.use(untrustedForwardingNotice(trust));
  const loginLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
  application.post("/login", loginLimiter, (_req, res) => { res.json({ ok: true }); });
  application.get("/whoami", (req, res) => { res.json({ ip: req.ip, secure: req.secure, protocol: req.protocol }); });
  application.use("/api/exposed", createExposedApiRouter({
    publications: { resolve: () => ({ ok: false, reason: "unknown" }) },
    access: { authenticate: () => ({ ok: false }), isGranted: () => false },
    stateFor: () => () => undefined,
    limiter: { admit: () => ({ ok: false, reason: "rate", retryAfterSeconds: 1 }) },
    requireHttps: true,
    logger: { info: vi.fn(), warn: vi.fn() },
  } as never));
  return application;
}

async function listen(application: Express): Promise<number> {
  const server = http.createServer(application);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as AddressInfo).port;
}

/** One request from a chosen source address, with chosen headers. */
function call(port: number, from: string, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, localAddress: from, agent: false }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const PROXY = "127.0.0.1";
const DIRECT = "127.0.0.2";
const forged = { "X-Forwarded-For": "203.0.113.50", "X-Forwarded-Proto": "https" };

describe("trusted proxy traffic", () => {
  it("uses the proxy's forwarded client address and scheme", async () => {
    const port = await listen(app(1));
    const res = await call(port, PROXY, "GET", "/whoami", { "X-Forwarded-For": "198.51.100.7", "X-Forwarded-Proto": "https" });
    expect(JSON.parse(res.body)).toEqual({ ip: "198.51.100.7", secure: true, protocol: "https" });
  });

  it("passes HTTPS enforcement only through the proxy (401 for the missing key, not 403)", async () => {
    const port = await listen(app(1));
    expect((await call(port, PROXY, "GET", "/api/exposed/v1/site/x", { "X-Forwarded-Proto": "https" })).status).toBe(401);
    expect((await call(port, PROXY, "GET", "/api/exposed/v1/site/x")).status).toBe(403);
  });

  it("takes only the nearest hop's view of a client-supplied X-Forwarded-For chain", async () => {
    const port = await listen(app(1));
    // The client forged 1.1.1.1; the proxy appended the real client address.
    const res = await call(port, PROXY, "GET", "/whoami", { "X-Forwarded-For": "1.1.1.1, 198.51.100.7" });
    expect(JSON.parse(res.body).ip).toBe("198.51.100.7");
  });

  it("attributes login attempts to the forwarded client, one bucket each", async () => {
    const port = await listen(app(1));
    for (let i = 0; i < 5; i += 1) expect((await call(port, PROXY, "POST", "/login", { "X-Forwarded-For": "198.51.100.1" })).status).toBe(200);
    expect((await call(port, PROXY, "POST", "/login", { "X-Forwarded-For": "198.51.100.1" })).status).toBe(429);
    expect((await call(port, PROXY, "POST", "/login", { "X-Forwarded-For": "198.51.100.2" })).status).toBe(200);
  });
});

describe("direct traffic that bypasses the proxy", () => {
  it("ignores forged X-Forwarded-For and X-Forwarded-Proto", async () => {
    const port = await listen(app(1));
    const res = await call(port, DIRECT, "GET", "/whoami", forged);
    expect(JSON.parse(res.body)).toEqual({ ip: DIRECT, secure: false, protocol: "http" });
  });

  it("cannot satisfy HTTPS enforcement with a forged header", async () => {
    const port = await listen(app(1));
    expect((await call(port, DIRECT, "GET", "/api/exposed/v1/site/x", forged)).status).toBe(403);
  });

  it("cannot escape the login limiter by rotating X-Forwarded-For", async () => {
    const port = await listen(app(1));
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await call(port, DIRECT, "POST", "/login", { "X-Forwarded-For": `203.0.113.${i}` })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });

  it("logs once per peer that forwarded headers were ignored", async () => {
    const port = await listen(app(1));
    await call(port, DIRECT, "GET", "/whoami", forged);
    await call(port, DIRECT, "GET", "/whoami", forged);
    await call(port, PROXY, "GET", "/whoami", forged);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toMatchObject({ peer: DIRECT, trustedProxyHops: 1 });
  });
});

describe("no proxy configured", () => {
  it("trusts forwarded headers from nobody, loopback included", async () => {
    const port = await listen(app(0));
    expect(JSON.parse((await call(port, PROXY, "GET", "/whoami", forged)).body)).toEqual({ ip: PROXY, secure: false, protocol: "http" });
    expect((await call(port, PROXY, "GET", "/api/exposed/v1/site/x", forged)).status).toBe(403);
    expect(warnings).toHaveLength(0);
  });
});

describe("configuration", () => {
  it("accepts addresses, CIDR ranges and named ranges, IPv4 and IPv6", () => {
    const list = parseTrustedProxies("loopback, 10.1.2.0/24, fd00::/8, 192.0.2.10, uniquelocal, linklocal");
    for (const [address, type] of [["127.0.0.1", "ipv4"], ["::1", "ipv6"], ["10.1.2.200", "ipv4"], ["fd12::1", "ipv6"], ["192.0.2.10", "ipv4"], ["172.20.0.1", "ipv4"], ["169.254.1.1", "ipv4"]] as const) {
      expect(list.check(address, type), address).toBe(true);
    }
    expect(list.check("203.0.113.1", "ipv4")).toBe(false);
  });

  it("refuses an unreadable list instead of guessing", () => {
    for (const bad of ["", " , ", "proxy.lan", "10.0.0.0/33", "10.0.0.0/x", "::1/129", "10.0.0.0/8/1"]) {
      expect(() => parseTrustedProxies(bad), bad).toThrow(ProxyTrustConfigError);
    }
  });

  it("treats IPv4-mapped peers as IPv4 and refuses non-addresses", () => {
    expect(normalisePeer("::ffff:127.0.0.1")).toEqual({ address: "127.0.0.1", type: "ipv4" });
    expect(normalisePeer("fe80::1%eth0")).toEqual({ address: "fe80::1", type: "ipv6" });
    expect(normalisePeer("nonsense")).toBeNull();
    const trust = createProxyTrust(2, "127.0.0.1");
    expect(trust.trusts("::ffff:127.0.0.1")).toBe(true);
    expect(trust.trusts(undefined)).toBe(false);
    expect(trust.setting !== false && trust.setting("127.0.0.1", 2)).toBe(false);
    expect(createProxyTrust(0, "not even parsed").setting).toBe(false);
  });
});
