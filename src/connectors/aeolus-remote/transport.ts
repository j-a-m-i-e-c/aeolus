// src/connectors/aeolus-remote/transport.ts — one GET to the configured peer.
//
// Its own transport (node:http / node:https), not authored HTTP (ADR-0020):
// - only the configured origin; the request is never redirected, and any 3xx is
//   reported as an error without reading Location, so the key cannot follow one;
// - DNS answers are checked at connection time by the `lookup` hook, which is what
//   net.connect dials, so the checked addresses are the dialled ones (no gap for a
//   rebinding answer between check and connect);
// - TLS verification is Node's default and is never turned off; the certificate is
//   checked against the configured host name (SNI);
// - per-request connection options: `autoSelectFamily` with a 2.5 s attempt per
//   address instead of Node's 250 ms default, which a distant dual-stack peer can
//   miss (see e3a8db9). Nothing process-wide is changed;
// - separate deadlines for connecting (including the TLS handshake) and for the whole
//   request; a byte cap on Content-Length and on the streamed body; no compression.
//
// Failures are reported as categories. Nothing here logs, and no error carries the key.

import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { resolvedAllowed } from "./address-policy.js";
import type { RemoteConfig } from "./config.js";

/** Per-address connection attempt, for dual-stack hosts. */
export const CONNECT_ATTEMPT_MS = 2_500;
/** Whole connection phase: DNS, every address attempt and the TLS handshake. */
export const CONNECT_DEADLINE_MS = 5_000;
/** The whole request, from DNS to the last body byte. */
export const REQUEST_DEADLINE_MS = 10_000;
export const USER_AGENT = "aeolus-remote/1";

export type TransportFailure =
  | "dns"
  | "address-refused"
  | "connection-refused"
  | "connect-timeout"
  | "timeout"
  | "tls"
  | "network"
  | "response-too-large"
  | "invalid-response"
  | "aborted";

export type TransportResult =
  | {
      kind: "response";
      status: number;
      /** Only read for 2xx; empty otherwise. */
      body: Buffer;
      contentType: string | null;
      date: string | null;
      retryAfter: string | null;
    }
  | { kind: "failure"; reason: TransportFailure };

/** Raw DNS, replaceable in tests. Must return every answer. */
export type Resolver = (hostname: string, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const systemResolver: Resolver = (hostname, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, callback);
};

class AddressRefusedError extends Error {
  readonly code = "EAEOLUS_ADDRESS_REFUSED";
}

/**
 * A `net.connect` lookup that dials only policy-approved answers. Every answer must
 * pass, so one refused answer refuses the whole name.
 */
export function policyLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (error, answers) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const family = typeof options === "object" && options ? options.family : undefined;
      const wanted = family === 4 || family === 6 ? answers.filter((answer) => answer.family === family) : answers;
      if (!resolvedAllowed(answers.map((answer) => answer.address)) || wanted.length === 0) {
        callback(new AddressRefusedError("address refused by the remote connector policy"), "", 0);
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

type ConnectOptions = https.RequestOptions & {
  autoSelectFamily: boolean;
  autoSelectFamilyAttemptTimeout: number;
};

/** The request options, separated so their security properties can be tested. */
export function requestOptions(config: RemoteConfig, signal: AbortSignal, resolve?: Resolver): ConnectOptions {
  return {
    protocol: config.protocol,
    hostname: config.hostname,
    port: config.port,
    path: config.endpointPath,
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "User-Agent": USER_AGENT,
    },
    // A fresh socket per poll: no pooled connection outlives a config change.
    agent: false,
    // IP literals are checked in config.ts; net.connect skips lookup for them.
    lookup: policyLookup(resolve),
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_MS,
    signal,
  };
}

const TLS_CODES = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL|HOSTNAME_MISMATCH)/;

function classify(error: NodeJS.ErrnoException): TransportFailure {
  const code = error.code ?? "";
  if (code === "EAEOLUS_ADDRESS_REFUSED") return "address-refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA" || code === "ESERVFAIL") return "dns";
  if (code === "ECONNREFUSED") return "connection-refused";
  if (code === "ETIMEDOUT") return "connect-timeout";
  if (TLS_CODES.test(code) || /certificate|self.signed|altnames/i.test(error.message)) return "tls";
  return "network";
}

export interface FetchDeps {
  resolve?: Resolver;
  /** Test hook for the deadlines. */
  deadlines?: { connectMs?: number; requestMs?: number };
  /** Test-only trust anchor; never reachable from connector config. */
  ca?: string;
}

/** GET the configured endpoint once. Never throws. */
export function fetchRemote(config: RemoteConfig, signal: AbortSignal, deps: FetchDeps = {}): Promise<TransportResult> {
  const connectMs = deps.deadlines?.connectMs ?? CONNECT_DEADLINE_MS;
  const requestMs = deps.deadlines?.requestMs ?? REQUEST_DEADLINE_MS;
  return new Promise<TransportResult>((resolvePromise) => {
    let settled = false;
    let failure: TransportFailure | null = null;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const done = (result: TransportResult) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      resolvePromise(result);
    };
    if (signal.aborted) {
      done({ kind: "failure", reason: "aborted" });
      return;
    }
    const options = requestOptions(config, signal, deps.resolve);
    if (deps.ca) options.ca = deps.ca;
    const request = (config.protocol === "https:" ? https : http).request(options);
    const fail = (reason: TransportFailure) => {
      failure ??= reason;
      request.destroy();
      done({ kind: "failure", reason: failure });
    };

    timers.push(setTimeout(() => fail("timeout"), requestMs));
    // The connection phase (DNS, every address attempt, the TLS handshake) has its
    // own deadline, started now and cleared once the socket is connected or secured.
    const connectTimer = setTimeout(() => fail("connect-timeout"), connectMs);
    timers.push(connectTimer);
    request.on("socket", (socket) => {
      socket.once(config.protocol === "https:" ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (signal.aborted) fail("aborted");
      else fail(failure ?? classify(error));
    });
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      const header = (name: string) => {
        const value = response.headers[name];
        return typeof value === "string" ? value : null;
      };
      const meta = { status, contentType: header("content-type"), date: header("date"), retryAfter: header("retry-after") };
      if (status < 200 || status >= 300) {
        // Redirects and refusals carry nothing we use; Location is never read.
        response.destroy();
        done({ kind: "response", ...meta, body: Buffer.alloc(0) });
        return;
      }
      const encoding = header("content-encoding");
      if (encoding && encoding.toLowerCase() !== "identity") {
        fail("invalid-response");
        return;
      }
      const declared = Number(header("content-length") ?? Number.NaN);
      if (Number.isFinite(declared) && declared > config.maxResponseBytes) {
        fail("response-too-large");
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > config.maxResponseBytes) {
          fail("response-too-large");
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => done({ kind: "response", ...meta, body: Buffer.concat(chunks) }));
      response.on("aborted", () => fail("network"));
      response.on("error", () => fail(failure ?? "network"));
    });
    request.end();
  });
}
