// src/security/guarded-request.test.ts — the shared guarded request against real local
// servers: what is checked is what is dialled, refused destinations are never
// connected to, and redirects, TLS, deadlines, sizes and encodings are bounded.
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { guardedLookup, guardedRequest, guardedRequestOptions, type AddressPolicy, type GuardedRequestOptions, type Resolver } from "./guarded-request.js";
import { SELF_SIGNED_CERT, SELF_SIGNED_KEY } from "../connectors/aeolus-remote/self-signed.fixture.js";

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** Listen, and count every TCP connection the server accepts. */
async function listen(server: net.Server, host = "127.0.0.1"): Promise<{ port: number; connections: () => number }> {
  let connections = 0;
  server.on("connection", (socket: net.Socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  return { port: (server.address() as AddressInfo).port, connections: () => connections };
}

/** Allows exactly the given addresses, and records every set of answers it was asked about. */
function onlyAllow(...allowed: string[]): AddressPolicy & { asked: string[][] } {
  const norm = (address: string) => address.replace(/^::ffff:/, "");
  const asked: string[][] = [];
  return {
    asked,
    allowLiteral: (address) => allowed.includes(norm(address)),
    allowResolved: (addresses) => {
      asked.push([...addresses]);
      return addresses.length > 0 && addresses.every((address) => allowed.includes(norm(address)));
    },
  };
}

type Answer = { address: string; family: number };
function answers(...sets: Answer[][]): Resolver & { calls: () => number } {
  let call = 0;
  const resolver = ((_host: string, callback: Parameters<Resolver>[1]) => {
    const set = sets[Math.min(call, sets.length - 1)]!;
    call += 1;
    callback(null, set);
  }) as Resolver & { calls: () => number };
  resolver.calls = () => call;
  return resolver;
}

const v4 = (address: string): Answer => ({ address, family: 4 });

function options(url: string, over: Partial<GuardedRequestOptions> = {}): GuardedRequestOptions {
  return {
    url: new URL(url),
    method: "GET",
    headers: {},
    policy: onlyAllow("127.0.0.1"),
    maxResponseBytes: 1024,
    connectTimeoutMs: 3000,
    requestTimeoutMs: 5000,
    attemptTimeoutMs: 2500,
    readBody: () => true,
    decode: true,
    ...over,
  };
}

const ok = (body = "{}") => http.createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(body);
});

describe("destination enforcement", () => {
  it("resolves once, and dials exactly the address it checked", async () => {
    const approved = await listen(ok("approved"));
    // Were there a second resolution, it would rebind to another loopback address.
    const resolve = answers([v4("127.0.0.1")], [v4("127.0.0.2")]);
    const policy = onlyAllow("127.0.0.1");
    const result = await guardedRequest(options(`http://peer.test:${approved.port}/`, { policy, resolve }));
    expect(result).toMatchObject({ kind: "response", status: 200 });
    expect(result.kind === "response" && result.body.toString()).toBe("approved");
    expect(resolve.calls()).toBe(1);
    expect(policy.asked).toContainEqual(["127.0.0.1"]);
    expect(approved.connections()).toBe(1);
  });

  it("never connects when the connection-time answer is refused", async () => {
    const target = await listen(ok());
    const result = await guardedRequest(options(`http://rebind.test:${target.port}/`, { policy: onlyAllow("203.0.113.7"), resolve: answers([v4("127.0.0.1")]) }));
    expect(result).toEqual({ kind: "failure", reason: "address-refused" });
    expect(target.connections()).toBe(0);
  });

  it("refuses a name with any refused answer, even if another would be allowed", async () => {
    const target = await listen(ok());
    const resolve = answers([v4("127.0.0.1"), v4("169.254.169.254")]);
    expect(await guardedRequest(options(`http://mixed.test:${target.port}/`, { resolve }))).toEqual({ kind: "failure", reason: "address-refused" });
    expect(target.connections()).toBe(0);
  });

  it("refuses an IP literal before connecting", async () => {
    const target = await listen(ok());
    expect(await guardedRequest(options(`http://127.0.0.1:${target.port}/`, { policy: onlyAllow("10.9.9.9") }))).toEqual({ kind: "failure", reason: "address-refused" });
    expect(target.connections()).toBe(0);
  });

  it("refuses at connect time when something bypasses the guarded lookup", async () => {
    let served = 0;
    const target = await listen(http.createServer((_req, res) => { served += 1; res.end("leaked"); }));
    // A lookup that lies: the policy never sees 127.0.0.1 until the socket connects.
    const lying: net.LookupFunction = (_host, _options, callback) => {
      (callback as unknown as (e: null, a: Answer[]) => void)(null, [v4("127.0.0.1")]);
    };
    const result = await guardedRequest(options(`http://lying.test:${target.port}/`, { policy: onlyAllow("203.0.113.7"), unsafeLookupForTests: lying }));
    expect(result).toEqual({ kind: "failure", reason: "address-refused" });
    // The socket was opened, but no request was served and nothing came back.
    expect(served).toBe(0);
  });

  it("passes the family filter and single-answer form of net.connect's lookup", async () => {
    const lookup = guardedLookup(onlyAllow("127.0.0.1", "::1"), answers([v4("127.0.0.1"), { address: "::1", family: 6 }]));
    const single = await new Promise<unknown[]>((resolve) => lookup("x", { family: 6 } as never, ((...args: unknown[]) => resolve(args)) as never));
    expect(single).toEqual([null, "::1", 6]);
    const none = await new Promise<unknown[]>((resolve) => guardedLookup(onlyAllow("127.0.0.1"), answers([v4("127.0.0.1")]))("x", { family: 6 } as never, ((...args: unknown[]) => resolve(args)) as never));
    expect((none[0] as Error).message).toMatch(/refused/);
  });

  it("reports a DNS failure", async () => {
    const failing: Resolver = (_host, callback) => callback(Object.assign(new Error("x"), { code: "ENOTFOUND" }), []);
    expect(await guardedRequest(options("http://missing.test:1/", { resolve: failing }))).toEqual({ kind: "failure", reason: "dns" });
  });
});

describe("dual-stack attempts", () => {
  it("falls back to a working address within the per-request attempt budget, changing nothing process-wide", async () => {
    const before = { family: net.getDefaultAutoSelectFamily(), attempt: net.getDefaultAutoSelectFamilyAttemptTimeout() };
    const target = await listen(ok("v4"));
    // The first answer never connects (discard-only IPv6 prefix); the second works.
    const resolve = answers([{ address: "100::1", family: 6 }, v4("127.0.0.1")]);
    const started = Date.now();
    const result = await guardedRequest(options(`http://dual.test:${target.port}/`, { policy: onlyAllow("100::1", "127.0.0.1"), resolve, attemptTimeoutMs: 300 }));
    expect(result).toMatchObject({ kind: "response", status: 200 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect({ family: net.getDefaultAutoSelectFamily(), attempt: net.getDefaultAutoSelectFamilyAttemptTimeout() }).toEqual(before);
  });

  it("sets the attempt timeout on the request, not globally", () => {
    const built = guardedRequestOptions(options("https://peer.test/x?y=1", { attemptTimeoutMs: 2500 }), new AbortController().signal);
    expect(built).toMatchObject({ autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2500, agent: false, path: "/x?y=1", port: 443, hostname: "peer.test" });
    expect(built).not.toHaveProperty("rejectUnauthorized");
  });
});

describe("redirects, TLS and deadlines", () => {
  it("returns a redirect without following it", async () => {
    const elsewhere = await listen(ok("followed"));
    const redirecting = await listen(http.createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${elsewhere.port}/` });
      res.end("moved");
    }));
    const result = await guardedRequest(options(`http://127.0.0.1:${redirecting.port}/`));
    expect(result).toMatchObject({ kind: "response", status: 302 });
    expect(result.kind === "response" && result.headers.location).toBe(`http://127.0.0.1:${elsewhere.port}/`);
    expect(elsewhere.connections()).toBe(0);
  });

  it("refuses a self-signed certificate, and a trusted one issued for another name", async () => {
    const tls = await listen(https.createServer({ cert: SELF_SIGNED_CERT, key: SELF_SIGNED_KEY }, (_req, res) => res.end("{}")));
    expect(await guardedRequest(options(`https://127.0.0.1:${tls.port}/`))).toEqual({ kind: "failure", reason: "tls" });
    // Trusted as a CA, it verifies for its own name; asked for by another name, it is refused.
    expect(await guardedRequest(options(`https://127.0.0.1:${tls.port}/`, { ca: SELF_SIGNED_CERT }))).toMatchObject({ kind: "response", status: 200 });
    const other = await guardedRequest(options(`https://other-name.test:${tls.port}/`, { ca: SELF_SIGNED_CERT, resolve: answers([v4("127.0.0.1")]) }));
    expect(other).toEqual({ kind: "failure", reason: "tls" });
  });

  it("bounds the connection phase, including a TLS handshake that never completes", async () => {
    const silent = await listen(net.createServer(() => { /* never speaks TLS */ }));
    expect(await guardedRequest(options(`https://127.0.0.1:${silent.port}/`, { connectTimeoutMs: 200 }))).toEqual({ kind: "failure", reason: "connect-timeout" });
  });

  it("bounds the request: no answer, and a body that stalls", async () => {
    const mute = await listen(http.createServer(() => { /* never answers */ }));
    expect(await guardedRequest(options(`http://127.0.0.1:${mute.port}/`, { requestTimeoutMs: 200 }))).toEqual({ kind: "failure", reason: "timeout" });
    const stalls = await listen(http.createServer((_req, res) => { res.writeHead(200); res.write("partial"); }));
    expect(await guardedRequest(options(`http://127.0.0.1:${stalls.port}/`, { requestTimeoutMs: 200 }))).toEqual({ kind: "failure", reason: "timeout" });
  });

  it("reports a refused connection and a dropped body", async () => {
    const gone = await listen(net.createServer());
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    expect(await guardedRequest(options(`http://127.0.0.1:${gone.port}/`))).toEqual({ kind: "failure", reason: "connection-refused" });
    const drops = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Length": "100" });
      res.write("{");
      setTimeout(() => res.socket?.destroy(), 20);
    }));
    expect(await guardedRequest(options(`http://127.0.0.1:${drops.port}/`))).toEqual({ kind: "failure", reason: "network" });
  });

  it("stops at once when cancelled, and never starts when already cancelled", async () => {
    const mute = await listen(http.createServer(() => { /* never answers */ }));
    const controller = new AbortController();
    const pending = guardedRequest(options(`http://127.0.0.1:${mute.port}/`, { signal: controller.signal }));
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toEqual({ kind: "failure", reason: "aborted" });
    expect(await guardedRequest(options(`http://127.0.0.1:${mute.port}/`, { signal: controller.signal }))).toEqual({ kind: "failure", reason: "aborted" });
  });
});

describe("sizes and encodings", () => {
  const encoded = (encoding: string, body: Buffer) => http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Encoding": encoding });
    res.end(body);
  });

  it("decodes gzip, deflate and br bodies", async () => {
    for (const [encoding, body] of [["gzip", gzipSync("hello")], ["deflate", deflateSync("hello")], ["br", brotliCompressSync("hello")]] as const) {
      const server = await listen(encoded(encoding, body));
      const result = await guardedRequest(options(`http://127.0.0.1:${server.port}/`));
      expect(result.kind === "response" && result.body.toString(), encoding).toBe("hello");
    }
  });

  it("refuses a compression bomb by its decoded size", async () => {
    const bomb = gzipSync(Buffer.alloc(200_000));
    expect(bomb.length).toBeLessThan(1024);
    const server = await listen(encoded("gzip", bomb));
    expect(await guardedRequest(options(`http://127.0.0.1:${server.port}/`))).toEqual({ kind: "failure", reason: "response-too-large" });
  });

  it("refuses an unknown encoding, or any encoding when decoding is off", async () => {
    const odd = await listen(encoded("compress", Buffer.from("x")));
    expect(await guardedRequest(options(`http://127.0.0.1:${odd.port}/`))).toEqual({ kind: "failure", reason: "unsupported-encoding" });
    const gz = await listen(encoded("gzip", gzipSync("x")));
    expect(await guardedRequest(options(`http://127.0.0.1:${gz.port}/`, { decode: false }))).toEqual({ kind: "failure", reason: "unsupported-encoding" });
  });

  it("refuses an oversized body, declared or streamed", async () => {
    const declared = await listen(http.createServer((_req, res) => { res.writeHead(200, { "Content-Length": "2048" }); res.end("x".repeat(2048)); }));
    expect(await guardedRequest(options(`http://127.0.0.1:${declared.port}/`))).toEqual({ kind: "failure", reason: "response-too-large" });
    const streamed = await listen(http.createServer((_req, res) => { res.writeHead(200); res.write("x".repeat(800)); res.end("x".repeat(800)); }));
    expect(await guardedRequest(options(`http://127.0.0.1:${streamed.port}/`))).toEqual({ kind: "failure", reason: "response-too-large" });
  });

  it("skips the body when the caller does not want it, and sends a request body", async () => {
    let received = "";
    const echo = await listen(http.createServer((req, res) => {
      req.on("data", (chunk: Buffer) => { received += chunk.toString(); });
      req.on("end", () => { res.writeHead(500); res.end("x".repeat(5000)); });
    }));
    const result = await guardedRequest(options(`http://127.0.0.1:${echo.port}/`, { method: "POST", body: Buffer.from("payload"), readBody: (status) => status < 400 }));
    expect(result).toMatchObject({ kind: "response", status: 500 });
    expect(result.kind === "response" && result.body.length).toBe(0);
    expect(received).toBe("payload");
  });
});
