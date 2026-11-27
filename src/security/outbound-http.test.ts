import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressPolicy } from "./guarded-request.js";
import { fetchRemote } from "../connectors/aeolus-remote/transport.js";
import { parseRemoteConfig } from "../connectors/aeolus-remote/config.js";
import { ACTION_DRAIN_BUDGET_MS } from "../automations/sandbox.js";
import {
  OUTBOUND_HTTP_MAX_TIMEOUT_MS,
  OUTBOUND_HTTP_MIN_TIMEOUT_MS,
  OUTBOUND_HTTP_TIMEOUT_MS,
  OutboundHttpPolicyError,
  PUBLIC_ONLY_POLICY,
  isPublicIpAddress,
  outboundHeaders,
  requestHttpWithPolicy,
  isPublicIpv4,
  isPublicIpv6,
  requestPublicHttp,
  resolveOutboundTimeoutMs,
  validatePublicHttpUrl,
} from "./outbound-http.js";

describe("outbound HTTP policy", () => {
  it.each([
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "2::1", "200::1", "fe80::1", "fc00::1",
    "2001::1", "2001:0:53aa:64c:0:0:c000:0201", "2001:db8::1", "2002:c0a8:0101::1", "3fff::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => expect(isPublicIpAddress(address)).toBe(true),
  );

  it("rejects non-HTTP schemes and URL credentials", async () => {
    await expect(validatePublicHttpUrl("file:///etc/passwd")).rejects.toBeInstanceOf(OutboundHttpPolicyError);
    await expect(validatePublicHttpUrl("https://user:secret@example.com")).rejects.toThrow(/Credentials/);
  });

  it("rejects a hostname when any DNS answer is private", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(validatePublicHttpUrl("https://example.com/hook", lookup)).rejects.toThrow(/resolves to/);
  });

});

// The address classifiers are the load-bearing half of this SSRF boundary, so
// their reserved-range and malformed-input branches are asserted directly
// rather than only through the URL/DNS paths above.
describe("outbound HTTP address classification", () => {
  it.each([
    "1.2.3",           // too few octets
    "1.2.3.4.5",       // too many octets
    "1.2.3.999",       // octet out of range
    "1.2.3.-1",        // negative octet
    "1.2.3.x",         // non-numeric octet
    "1.2.3.4.",        // trailing separator
  ])("treats malformed IPv4 %s as non-public", (address) => {
    expect(isPublicIpv4(address)).toBe(false);
  });

  it.each([
    "192.0.0.1",       // IETF protocol assignments
    "192.0.2.5",       // documentation
    "198.18.0.1",      // benchmarking
    "198.19.0.1",      // benchmarking
    "198.51.100.7",    // documentation
    "203.0.113.7",     // documentation
    "240.0.0.1",       // reserved
    "255.255.255.255", // broadcast
  ])("treats reserved IPv4 %s as non-public", (address) => {
    expect(isPublicIpv4(address)).toBe(false);
  });

  it.each(["203.0.114.1", "198.20.0.1", "192.1.0.1"])(
    "treats neighbouring public IPv4 %s as public",
    (address) => expect(isPublicIpv4(address)).toBe(true),
  );

  it("judges IPv4-mapped IPv6 by the embedded IPv4 address", () => {
    expect(isPublicIpv6("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIpv6("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpv6("::ffff:192.168.1.1")).toBe(false);
  });

  it.each([
    "1::2::3",           // more than one "::" group
    "20000::1",          // hextet out of range
    "2000:1:2:3:4:5:6",  // too few hextets without "::"
    "2000::1.2.3.4",     // dotted tail that is not ::ffff:
    "2000:1:2:3:4:5:6:7:8", // too many hextets
    "2000::zzzz",        // non-hex hextet
  ])("treats malformed IPv6 %s as non-public", (address) => {
    expect(isPublicIpv6(address)).toBe(false);
  });

  it("strips brackets and zone identifiers before classifying", () => {
    expect(isPublicIpv6("[2606:4700:4700::1111]")).toBe(true);
    expect(isPublicIpAddress("[2606:4700:4700::1111]")).toBe(true);
    expect(isPublicIpv6("fe80::1%eth0")).toBe(false);
  });

  it("treats anything that is not an IP literal as non-public", () => {
    expect(isPublicIpAddress("example.com")).toBe(false);
    expect(isPublicIpAddress("")).toBe(false);
  });
});

describe("validatePublicHttpUrl", () => {
  it("rejects an unparseable URL", async () => {
    await expect(validatePublicHttpUrl("not a url")).rejects.toThrow(/Invalid outbound URL/);
  });

  it("accepts a public IP literal without consulting DNS", async () => {
    const lookup = vi.fn();
    const url = await validatePublicHttpUrl("http://1.1.1.1/hook", lookup);
    expect(url.hostname).toBe("1.1.1.1");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a private IP literal without consulting DNS", async () => {
    const lookup = vi.fn();
    await expect(validatePublicHttpUrl("http://127.0.0.1/hook", lookup)).rejects.toThrow(/blocked/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a bracketed private IPv6 literal", async () => {
    await expect(validatePublicHttpUrl("http://[::1]/hook")).rejects.toThrow(/blocked/);
  });

  it("surfaces a DNS failure as a policy error", async () => {
    const lookup = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    await expect(validatePublicHttpUrl("https://example.com", lookup))
      .rejects.toThrow(/DNS lookup failed for outbound host: ENOTFOUND/);
  });

  it("rejects a hostname that resolves to nothing", async () => {
    const lookup = vi.fn(async () => []);
    await expect(validatePublicHttpUrl("https://example.com", lookup)).rejects.toThrow(/did not resolve/);
  });

  it("accepts a hostname whose every answer is public", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    const url = await validatePublicHttpUrl("https://example.com/hook", lookup);
    expect(url.hostname).toBe("example.com");
    expect(lookup).toHaveBeenCalledWith("example.com");
  });
});

describe("resolveOutboundTimeoutMs", () => {
  it("defaults when the author gives nothing usable", () => {
    for (const value of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, "20000", {}]) {
      expect(resolveOutboundTimeoutMs(value), String(value)).toBe(OUTBOUND_HTTP_TIMEOUT_MS);
    }
  });

  it("honours a value inside the allowed range", () => {
    expect(resolveOutboundTimeoutMs(15_000)).toBe(15_000);
    expect(resolveOutboundTimeoutMs(2_500.4)).toBe(2_500);
  });

  it("clamps rather than refuses an out-of-range value", () => {
    expect(resolveOutboundTimeoutMs(60_000)).toBe(OUTBOUND_HTTP_MAX_TIMEOUT_MS);
    expect(resolveOutboundTimeoutMs(50)).toBe(OUTBOUND_HTTP_MIN_TIMEOUT_MS);
  });

  it("keeps the ceiling inside the sandbox's 30 s completion budget", () => {
    // A request allowed to outlive the run would be abandoned with it, so the option
    // would promise a wait the platform cannot keep.
    expect(OUTBOUND_HTTP_MAX_TIMEOUT_MS).toBeLessThan(ACTION_DRAIN_BUDGET_MS);
  });
});

// ─── requestPublicHttp against real local servers ─────────────────────────────

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function serve(handler: http.RequestListener): Promise<{ port: number; connections: () => number; requests: http.IncomingMessage[] }> {
  const requests: http.IncomingMessage[] = [];
  let connections = 0;
  const server = http.createServer((req, res) => { requests.push(req); handler(req, res); });
  server.on("connection", (socket: net.Socket) => { connections += 1; sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return { port: (server.address() as AddressInfo).port, connections: () => connections, requests };
}

/** Test-only: loopback allowed, so the response contract can be checked locally. */
const LOOPBACK: AddressPolicy = {
  allowLiteral: (address) => address === "127.0.0.1",
  allowResolved: (addresses) => addresses.length > 0 && addresses.every((address) => address === "127.0.0.1" || address === "::ffff:127.0.0.1"),
};
const toLoopback = async () => [{ address: "127.0.0.1", family: 4 }];

describe("requestPublicHttp destination enforcement", () => {
  it("never connects to a loopback server, whatever name or answer leads there", async () => {
    const internal = await serve((_req, res) => res.end("internal-only"));
    // Rebinding: the only resolution is the one the connection uses, and it is refused.
    await expect(requestPublicHttp(`http://rebind.example:${internal.port}/`, { lookup: toLoopback }))
      .rejects.toThrow("Outbound hostname resolves to a private, local, link-local, or reserved address");
    // Mixed answers, a literal, a mapped literal and the metadata address.
    const mixed = async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
    await expect(requestPublicHttp(`http://mixed.example:${internal.port}/`, { lookup: mixed })).rejects.toBeInstanceOf(OutboundHttpPolicyError);
    await expect(requestPublicHttp(`http://127.0.0.1:${internal.port}/`)).rejects.toThrow(/blocked/);
    await expect(requestPublicHttp(`http://[::ffff:127.0.0.1]:${internal.port}/`)).rejects.toThrow(/blocked/);
    await expect(requestPublicHttp("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/blocked/);
    expect(internal.connections()).toBe(0);
  });

  it("consults DNS once, at connection time", async () => {
    const lookup = vi.fn(toLoopback);
    await expect(requestPublicHttp("http://once.example/", { lookup })).rejects.toBeInstanceOf(OutboundHttpPolicyError);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("reports DNS failures and empty answers as policy errors", async () => {
    await expect(requestPublicHttp("http://missing.example/", { lookup: async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); } }))
      .rejects.toThrow("DNS lookup failed for outbound host");
    await expect(requestPublicHttp("http://empty.example/", { lookup: async () => [] })).rejects.toThrow("DNS lookup failed for outbound host");
  });

  it("is refused for a LAN peer the Aeolus Remote connector may reach", async () => {
    const peer = await serve((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end("{}"); });
    await expect(requestPublicHttp(`http://127.0.0.1:${peer.port}/api/exposed/v1/site/x`)).rejects.toThrow(/blocked/);
    const parsed = parseRemoteConfig({ baseUrl: `http://127.0.0.1:${peer.port}`, endpointPath: "/api/exposed/v1/site/x", apiKey: `aeo_0123456789abcdef_${"A".repeat(43)}`, allowPlaintextHttp: true });
    if (!parsed.ok) throw new Error(parsed.problems.join());
    expect(await fetchRemote(parsed.config, new AbortController().signal)).toMatchObject({ kind: "response", status: 200 });
    expect(peer.connections()).toBe(1);
  });

  it("exposes only the public-only policy to authored code and webhooks", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const file of ["../automations/sandbox.ts", "../automations/command-service.ts"]) {
      const source = readFileSync(path.join(here, file), "utf8");
      expect(source, file).not.toMatch(/requestHttpWithPolicy|guarded-request|aeolus-remote|CONFIGURED_PEER_POLICY/);
      expect(source, file).toMatch(/requestPublicHttp\(/);
    }
    expect(PUBLIC_ONLY_POLICY.allowResolved([])).toBe(false);
    expect(PUBLIC_ONLY_POLICY.allowLiteral("192.88.99.1")).toBe(false);
  });
});

describe("requestPublicHttp response contract (over loopback, test policy)", () => {
  it("returns status, statusText, Headers and the decoded body, and defaults to GET", async () => {
    const server = await serve((_req, res) => { res.writeHead(201, "Created", { "X-Test": "1", "Set-Cookie": ["a=1", "b=2"] }); res.end("hello"); });
    const result = await requestHttpWithPolicy(`http://local.test:${server.port}/p?q=1`, { lookup: toLoopback }, LOOPBACK);
    expect(result).toMatchObject({ status: 201, statusText: "Created", body: "hello" });
    expect(result.headers.get("x-test")).toBe("1");
    expect(server.requests[0]!.method).toBe("GET");
    expect(server.requests[0]!.url).toBe("/p?q=1");
  });

  it("sends method, body and author headers, with fetch's defaults, and drops transport headers", async () => {
    let body = "";
    const server = await serve((req, res) => { req.on("data", (c: Buffer) => { body += c.toString(); }); req.on("end", () => res.end("{}")); });
    await requestHttpWithPolicy(`http://local.test:${server.port}/`, {
      method: "post",
      body: "{\"a\":1}",
      headers: { "X-Api": "v", Host: "evil.example", "Transfer-Encoding": "chunked", "Proxy-Authorization": "x", "Accept-Encoding": "gzip" },
      lookup: toLoopback,
    }, LOOPBACK);
    const req = server.requests[0]!;
    expect(req.method).toBe("POST");
    expect(body).toBe("{\"a\":1}");
    expect(req.headers).toMatchObject({ "x-api": "v", accept: "*/*", "accept-language": "*", "user-agent": "node", "content-type": "text/plain;charset=UTF-8", "accept-encoding": "identity" });
    expect(req.headers.host).toBe(`local.test:${server.port}`);
    expect(req.headers["proxy-authorization"]).toBeUndefined();
    expect(req.headers["content-length"]).toBe("7");
  });

  it("returns a redirect to the author and never follows it", async () => {
    const target = await serve((_req, res) => res.end("followed"));
    const server = await serve((_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/` }); res.end("moved"); });
    const result = await requestHttpWithPolicy(`http://local.test:${server.port}/`, { lookup: toLoopback }, LOOPBACK);
    expect(result.status).toBe(302);
    expect(result.body).toBe("moved");
    expect(target.connections()).toBe(0);
  });

  it("decodes a compressed body a server sends anyway, under the response cap", async () => {
    const small = await serve((_req, res) => { res.writeHead(200, { "Content-Encoding": "gzip" }); res.end(gzipSync("compressed")); });
    expect((await requestHttpWithPolicy(`http://local.test:${small.port}/`, { lookup: toLoopback }, LOOPBACK)).body).toBe("compressed");
    const bomb = await serve((_req, res) => { res.writeHead(200, { "Content-Encoding": "gzip" }); res.end(gzipSync(Buffer.alloc(2_000_000))); });
    await expect(requestHttpWithPolicy(`http://local.test:${bomb.port}/`, { lookup: toLoopback }, LOOPBACK)).rejects.toThrow("Outbound response exceeds 1048576 bytes");
    const odd = await serve((_req, res) => { res.writeHead(200, { "Content-Encoding": "compress" }); res.end("x"); });
    await expect(requestHttpWithPolicy(`http://local.test:${odd.port}/`, { lookup: toLoopback }, LOOPBACK)).rejects.toThrow(/unsupported content encoding/);
  });

  it("keeps the request and response size limits and their messages", async () => {
    const server = await serve((_req, res) => res.end("12345"));
    await expect(requestHttpWithPolicy(`http://local.test:${server.port}/`, { body: "12345", maxRequestBytes: 4, lookup: toLoopback }, LOOPBACK)).rejects.toThrow(/request body exceeds 4 bytes/);
    await expect(requestHttpWithPolicy(`http://local.test:${server.port}/`, { maxResponseBytes: 4, lookup: toLoopback }, LOOPBACK)).rejects.toThrow("Outbound response exceeds 4 bytes");
  });

  it("times out a slow server with the same message as before", async () => {
    const mute = await serve(() => { /* never answers */ });
    await expect(requestHttpWithPolicy(`http://local.test:${mute.port}/`, { timeoutMs: 300, lookup: toLoopback }, LOOPBACK)).rejects.toThrow("Outbound request timed out after 300 ms");
  });

  it("reports connection failures without echoing the URL or headers", async () => {
    const gone = await serve(() => undefined);
    servers.pop()!.close();
    for (const socket of sockets) socket.destroy();
    const secret = "Bearer sentinel-token-not-for-logs";
    const error = await requestHttpWithPolicy(`http://local.test:${gone.port}/hook?token=sentinel-query`, { headers: { Authorization: secret }, lookup: toLoopback }, LOOPBACK).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Outbound request failed: connection refused");
    expect(`${(error as Error).message}${(error as Error).stack}`.includes("sentinel")).toBe(false);
  });

  it("filters headers and applies defaults predictably", () => {
    expect(outboundHeaders({ accept: "application/json", "user-agent": "me", Connection: "close", "proxy-x": "1" }, false))
      .toEqual({ accept: "application/json", "user-agent": "me", "Accept-Language": "*", "Accept-Encoding": "identity" });
    expect(outboundHeaders(undefined, true)).toMatchObject({ "Content-Type": "text/plain;charset=UTF-8" });
  });
});
