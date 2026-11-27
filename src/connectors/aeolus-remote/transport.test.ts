// src/connectors/aeolus-remote/transport.test.ts — the remote connector's transport
// against real local servers: no redirects, byte caps, deadlines, TLS verification,
// the DNS address policy, and per-request (not process-wide) connection options.
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { parseRemoteConfig, type RemoteConfig } from "./config.js";
import { CONNECT_ATTEMPT_MS, USER_AGENT, fetchRemote, policyLookup, requestOptions, type Resolver } from "./transport.js";
import { SELF_SIGNED_CERT, SELF_SIGNED_KEY } from "./self-signed.fixture.js";

const KEY = "aeo_0123456789abcdef_" + "K".repeat(43);
const PATH = "/api/exposed/v1/site-a/conditions/summary";
const servers: Array<http.Server | net.Server> = [];
const sockets = new Set<net.Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen<T extends http.Server | net.Server>(server: T): Promise<number> {
  servers.push(server);
  server.on("connection", (socket: net.Socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function cfg(origin: string, over: Record<string, unknown> = {}): RemoteConfig {
  const parsed = parseRemoteConfig({ baseUrl: origin, endpointPath: PATH, apiKey: KEY, allowPlaintextHttp: true, ...over });
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.config;
}

const signal = () => new AbortController().signal;

describe("request options", () => {
  it("sets per-request dual-stack attempts, a fresh socket and no TLS bypass, and changes nothing process-wide", () => {
    const before = net.getDefaultAutoSelectFamilyAttemptTimeout();
    const options = requestOptions(cfg("https://aeolus-a.lan:3001"), signal());
    expect(options).toMatchObject({ autoSelectFamily: true, autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_MS, agent: false, method: "GET", path: PATH, hostname: "aeolus-a.lan" });
    expect(options).not.toHaveProperty("rejectUnauthorized");
    expect(options).not.toHaveProperty("checkServerIdentity");
    expect(options.headers).toEqual({ Authorization: `Bearer ${KEY}`, Accept: "application/json", "Accept-Encoding": "identity", "User-Agent": USER_AGENT });
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(before);
  });
});

describe("policy lookup", () => {
  const run = (answers: Array<{ address: string; family: number }>, options: object) =>
    new Promise<{ error: Error | null; result: unknown }>((resolve) => {
      const resolver: Resolver = (_host, callback) => callback(null, answers);
      policyLookup(resolver)("peer.lan", options as never, ((error: Error | null, result: unknown) => resolve({ error, result })) as never);
    });

  it("passes every allowed answer when net asks for all, so the checked addresses are the dialled ones", async () => {
    const answers = [{ address: "192.168.1.20", family: 4 }, { address: "fd00::20", family: 6 }];
    expect(await run(answers, { all: true })).toEqual({ error: null, result: answers });
    expect((await run(answers, { family: 6 })).result).toBe("fd00::20");
  });

  it("refuses a name with any loopback, metadata or link-local answer", async () => {
    for (const bad of ["127.0.0.1", "169.254.169.254", "fe80::1"]) {
      const outcome = await run([{ address: "192.168.1.20", family: 4 }, { address: bad, family: bad.includes(":") ? 6 : 4 }], { all: true });
      expect(outcome.error?.message, bad).toMatch(/address refused/);
    }
  });

  it("passes DNS errors through", async () => {
    const resolver: Resolver = (_host, callback) => callback(Object.assign(new Error("nope"), { code: "ENOTFOUND" }), []);
    const error = await new Promise<Error | null>((resolve) => policyLookup(resolver)("x.lan", { all: true } as never, ((e: Error | null) => resolve(e)) as never));
    expect((error as NodeJS.ErrnoException).code).toBe("ENOTFOUND");
  });
});

describe("fetchRemote", () => {
  it("sends the key only as a bearer header and returns the JSON body", async () => {
    let seen: http.IncomingHttpHeaders = {};
    let url = "";
    const port = await listen(http.createServer((req, res) => {
      seen = req.headers; url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ level: 61 }));
    }));
    const result = await fetchRemote(cfg(`http://127.0.0.1:${port}`), signal());
    expect(result).toMatchObject({ kind: "response", status: 200, contentType: "application/json" });
    expect(result.kind === "response" && JSON.parse(result.body.toString())).toEqual({ level: 61 });
    expect(seen.authorization).toBe(`Bearer ${KEY}`);
    expect(seen.cookie).toBeUndefined();
    expect(url).toBe(PATH);
    expect(url).not.toContain(KEY);
  });

  it("never follows a redirect, so the key never reaches the Location target", async () => {
    let targetHits = 0;
    const target = await listen(http.createServer((_req, res) => { targetHits += 1; res.end("{}"); }));
    const port = await listen(http.createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${target}${PATH}` });
      res.end();
    }));
    const result = await fetchRemote(cfg(`http://127.0.0.1:${port}`), signal());
    expect(result).toMatchObject({ kind: "response", status: 302 });
    expect(targetHits).toBe(0);
  });

  it("returns refusals without reading their bodies, with Retry-After", async () => {
    const port = await listen(http.createServer((_req, res) => {
      res.writeHead(429, { "Retry-After": "7", "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "x".repeat(10_000) }));
    }));
    const result = await fetchRemote(cfg(`http://127.0.0.1:${port}`), signal());
    expect(result).toMatchObject({ kind: "response", status: 429, retryAfter: "7" });
    expect(result.kind === "response" && result.body.length).toBe(0);
  });

  it("refuses a body over the cap, declared or streamed", async () => {
    const declared = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(2048) });
      res.end("x".repeat(2048));
    }));
    expect(await fetchRemote(cfg(`http://127.0.0.1:${declared}`, { maxResponseKiB: 1 }), signal())).toEqual({ kind: "failure", reason: "response-too-large" });
    const streamed = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write("[" + "1,".repeat(600));
      res.end("1]");
    }));
    expect(await fetchRemote(cfg(`http://127.0.0.1:${streamed}`, { maxResponseKiB: 1 }), signal())).toEqual({ kind: "failure", reason: "response-too-large" });
  });

  it("refuses a compressed body rather than inflating it", async () => {
    const port = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
      res.end(gzipSync(Buffer.alloc(100_000)));
    }));
    expect(await fetchRemote(cfg(`http://127.0.0.1:${port}`), signal())).toEqual({ kind: "failure", reason: "invalid-response" });
  });

  it("enforces the request deadline on a peer that never answers", async () => {
    const port = await listen(http.createServer(() => { /* never answers */ }));
    const started = Date.now();
    expect(await fetchRemote(cfg(`http://127.0.0.1:${port}`), signal(), { deadlines: { requestMs: 300 } })).toEqual({ kind: "failure", reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("enforces the connection deadline separately, including the TLS handshake", async () => {
    // Accepts TCP but never speaks TLS, so the handshake cannot complete.
    const port = await listen(net.createServer(() => { /* silent */ }));
    expect(await fetchRemote(cfg(`https://127.0.0.1:${port}`), signal(), { deadlines: { connectMs: 300, requestMs: 5000 } }))
      .toEqual({ kind: "failure", reason: "connect-timeout" });
  });

  it("reports a refused connection", async () => {
    const port = await listen(net.createServer());
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    expect(await fetchRemote(cfg(`http://127.0.0.1:${port}`), signal())).toEqual({ kind: "failure", reason: "connection-refused" });
  });

  it("refuses an untrusted certificate and has no way to skip verification", async () => {
    const port = await listen(https.createServer({ cert: SELF_SIGNED_CERT, key: SELF_SIGNED_KEY }, (_req, res) => res.end("{}")));
    expect(await fetchRemote(cfg(`https://127.0.0.1:${port}`), signal())).toEqual({ kind: "failure", reason: "tls" });
  });

  it("refuses a host name that resolves to loopback, before connecting", async () => {
    let hits = 0;
    const port = await listen(http.createServer((_req, res) => { hits += 1; res.end("{}"); }));
    const resolve: Resolver = (_host, callback) => callback(null, [{ address: "127.0.0.1", family: 4 }]);
    expect(await fetchRemote(cfg(`http://peer.lan:${port}`), signal(), { resolve })).toEqual({ kind: "failure", reason: "address-refused" });
    expect(hits).toBe(0);
  });

  it("reports a name that does not resolve", async () => {
    const resolve: Resolver = (_host, callback) => callback(Object.assign(new Error("x"), { code: "ENOTFOUND" }), []);
    expect(await fetchRemote(cfg("http://missing.lan:3001"), signal(), { resolve })).toEqual({ kind: "failure", reason: "dns" });
  });

  it("stops at once when aborted, and never starts when already aborted", async () => {
    const port = await listen(http.createServer(() => { /* never answers */ }));
    const controller = new AbortController();
    const pending = fetchRemote(cfg(`http://127.0.0.1:${port}`), controller.signal);
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toEqual({ kind: "failure", reason: "aborted" });
    expect(await fetchRemote(cfg(`http://127.0.0.1:${port}`), controller.signal)).toEqual({ kind: "failure", reason: "aborted" });
  });

  it("reports a connection dropped mid-body as a network failure", async () => {
    const port = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
      res.write("{\"partial\":");
      setTimeout(() => res.socket?.destroy(), 20);
    }));
    expect(await fetchRemote(cfg(`http://127.0.0.1:${port}`), signal())).toEqual({ kind: "failure", reason: "network" });
  });
});
