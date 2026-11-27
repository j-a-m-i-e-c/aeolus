// src/security/guarded-request.ts — one HTTP(S) request whose connected destination
// is checked against an address policy.
//
// Shared by authored HTTP (public addresses only, src/security/outbound-http.ts) and the
// Aeolus Remote connector (a configured LAN peer, src/connectors/aeolus-remote/). Each
// passes its own policy, which is required, so neither can inherit the other's reach.
//
// How the destination is enforced:
// - A host name is resolved once, inside the `lookup` hook that `net.connect` calls.
//   The hook checks every answer and hands back only checked addresses, so the
//   addresses checked are exactly the addresses dialled: there is no second resolution
//   for a rebinding DNS answer to slip into.
// - An IP literal skips `lookup` in Node, so it is checked before the request starts.
// - When the socket connects, its remote address is checked again and the socket is
//   destroyed if the policy refuses it. This catches any path that bypasses `lookup`.
//
// Also: never follows redirects (node:http does not); TLS verification is Node's
// default, against the URL's host name, with no option to disable it; per-request
// dual-stack attempts (nothing process-wide); separate connection and request
// deadlines; a fresh socket per request (`agent: false`, so no pooling and no
// environment proxy); byte caps on the request and on the response, compressed and
// decoded. Nothing here logs; failures are categories that never carry a credential.

import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction, type Socket } from "node:net";
import type { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export interface AddressPolicy {
  /** May this IP literal, taken from the URL, be dialled? */
  allowLiteral(address: string): boolean;
  /** May this set of DNS answers be dialled? One refused answer refuses the name. */
  allowResolved(addresses: readonly string[]): boolean;
}

/** Raw DNS, replaceable in tests. Must return every answer. */
export type Resolver = (hostname: string, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const systemResolver: Resolver = (hostname, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, callback);
};

export type GuardedFailure =
  | "dns"
  | "address-refused"
  | "connection-refused"
  | "connect-timeout"
  | "timeout"
  | "tls"
  | "network"
  | "response-too-large"
  | "unsupported-encoding"
  | "aborted";

export type GuardedResult =
  | {
      kind: "response";
      status: number;
      statusText: string;
      headers: http.IncomingHttpHeaders;
      /** The (decoded) body, or empty when the caller chose not to read it. */
      body: Buffer;
    }
  | { kind: "failure"; reason: GuardedFailure };

export interface GuardedRequestOptions {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  policy: AddressPolicy;
  maxResponseBytes: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  /** Per-address connection attempt for dual-stack hosts. */
  attemptTimeoutMs: number;
  /** Read the body for this status? Unread bodies are discarded unconsumed. */
  readBody: (status: number) => boolean;
  /** Decode gzip, deflate and br bodies (counting decoded bytes). Otherwise any encoding is refused. */
  decode: boolean;
  signal?: AbortSignal;
  resolve?: Resolver;
  /** Test-only trust anchor; never reachable from user configuration. */
  ca?: string;
  /** Test-only: replace the guarded lookup, to prove the post-connect check alone refuses. */
  unsafeLookupForTests?: LookupFunction;
}

class AddressRefusedError extends Error {
  readonly code = "EAEOLUS_ADDRESS_REFUSED";
}

/** A `net.connect` lookup that returns only policy-approved answers. */
export function guardedLookup(policy: AddressPolicy, resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (error, answers) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const family = typeof options === "object" && options ? options.family : undefined;
      const wanted = family === 4 || family === 6 ? answers.filter((answer) => answer.family === family) : answers;
      if (!policy.allowResolved(answers.map((answer) => answer.address)) || wanted.length === 0) {
        callback(new AddressRefusedError("address refused by the destination policy"), "", 0);
        return;
      }
      if (typeof options === "object" && options?.all) {
        (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, wanted);
        return;
      }
      callback(null, wanted[0]!.address, wanted[0]!.family);
    });
  };
}

const TLS_CODES = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL|HOSTNAME_MISMATCH)/;

function classify(error: NodeJS.ErrnoException): GuardedFailure {
  const code = error.code ?? "";
  if (code === "EAEOLUS_ADDRESS_REFUSED") return "address-refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA" || code === "ESERVFAIL") return "dns";
  if (code === "ECONNREFUSED") return "connection-refused";
  if (code === "ETIMEDOUT") return "connect-timeout";
  if (TLS_CODES.test(code) || /certificate|self.signed|altnames/i.test(error.message)) return "tls";
  return "network";
}

/** The host as `http.request` wants it: IPv6 brackets removed. */
export function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

type ConnectOptions = https.RequestOptions & { autoSelectFamily: boolean; autoSelectFamilyAttemptTimeout: number };

/** The request options, separated so their security properties can be tested. */
export function guardedRequestOptions(options: GuardedRequestOptions, signal: AbortSignal): ConnectOptions {
  const { url } = options;
  return {
    protocol: url.protocol,
    hostname: bareHost(url),
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    path: `${url.pathname}${url.search}`,
    method: options.method,
    headers: options.headers,
    agent: false,
    lookup: options.unsafeLookupForTests ?? guardedLookup(options.policy, options.resolve),
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: Math.max(10, options.attemptTimeoutMs),
    signal,
  };
}

function decoderFor(encoding: string | undefined): Transform | null | "unsupported" {
  const value = (encoding ?? "").trim().toLowerCase();
  if (value === "" || value === "identity") return null;
  if (value === "gzip" || value === "x-gzip") return createGunzip();
  if (value === "deflate") return createInflate();
  if (value === "br") return createBrotliDecompress();
  return "unsupported";
}

/** Run one guarded request. Never throws. */
export function guardedRequest(options: GuardedRequestOptions): Promise<GuardedResult> {
  return new Promise<GuardedResult>((resolvePromise) => {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let settled = false;
    let failure: GuardedFailure | null = null;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let decoder: Transform | null = null;
    const done = (result: GuardedResult) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      resolvePromise(result);
    };
    if (options.signal?.aborted) {
      done({ kind: "failure", reason: "aborted" });
      return;
    }
    const host = bareHost(options.url);
    const literal = isIP(host) !== 0;
    if (literal && !options.policy.allowLiteral(host)) {
      done({ kind: "failure", reason: "address-refused" });
      return;
    }

    const request = (options.url.protocol === "https:" ? https : http).request({
      ...guardedRequestOptions(options, signal),
      ...(options.ca ? { ca: options.ca } : {}),
    });
    const fail = (reason: GuardedFailure) => {
      failure ??= reason;
      decoder?.destroy();
      request.destroy();
      controller.abort();
      done({ kind: "failure", reason: failure });
    };

    timers.push(setTimeout(() => fail("timeout"), options.requestTimeoutMs));
    // The connection phase (DNS, every address attempt, the TLS handshake) has its own deadline.
    const connectTimer = setTimeout(() => fail("connect-timeout"), options.connectTimeoutMs);
    timers.push(connectTimer);
    request.on("socket", (socket: Socket) => {
      // Defence in depth: the address actually connected to must pass the same policy.
      socket.once("connect", () => {
        const remote = socket.remoteAddress ?? "";
        const allowed = literal ? options.policy.allowLiteral(remote) : options.policy.allowResolved([remote]);
        if (!allowed) fail("address-refused");
      });
      socket.once(options.url.protocol === "https:" ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (options.signal?.aborted) fail("aborted");
      else fail(failure ?? classify(error));
    });
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      const base = { kind: "response" as const, status, statusText: response.statusMessage ?? "", headers: response.headers };
      if (!options.readBody(status)) {
        response.destroy();
        done({ ...base, body: Buffer.alloc(0) });
        return;
      }
      const declared = Number(response.headers["content-length"] ?? Number.NaN);
      if (Number.isFinite(declared) && declared > options.maxResponseBytes) {
        fail("response-too-large");
        return;
      }
      const encoding = response.headers["content-encoding"];
      const chosen = options.decode ? decoderFor(encoding) : encoding && encoding.toLowerCase() !== "identity" ? "unsupported" : null;
      if (chosen === "unsupported") {
        fail("unsupported-encoding");
        return;
      }
      decoder = chosen;
      const chunks: Buffer[] = [];
      let received = 0;
      let decoded = 0;
      const collect = (chunk: Buffer) => {
        decoded += chunk.length;
        if (decoded > options.maxResponseBytes) {
          fail("response-too-large");
          return;
        }
        chunks.push(chunk);
      };
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > options.maxResponseBytes) {
          fail("response-too-large");
          return;
        }
        if (decoder) decoder.write(chunk);
        else collect(chunk);
      });
      const finish = () => done({ ...base, body: Buffer.concat(chunks) });
      if (decoder) {
        decoder.on("data", collect);
        decoder.on("end", finish);
        decoder.on("error", () => fail("network"));
        response.on("end", () => decoder?.end());
      } else {
        response.on("end", finish);
      }
      response.on("aborted", () => fail("network"));
      response.on("error", () => fail(failure ?? "network"));
    });
    if (options.body) request.end(options.body);
    else request.end();
  });
}
