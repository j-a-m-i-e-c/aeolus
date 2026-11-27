// src/connectors/aeolus-remote/transport.ts — one GET to the configured peer.
//
// Built on the shared guarded request (src/security/guarded-request.ts) with this
// connector's own destination policy (address-policy.ts): the configured LAN or VPN
// peer may be private, loopback only as a typed literal. Authored HTTP uses the same
// core with a public-only policy; neither can reach the other's policy.
//
// - only the configured origin; a redirect is never followed and any 3xx is reported
//   as an error without reading Location, so the key cannot follow one;
// - every DNS answer is checked inside the connection's own lookup, and the connected
//   address is checked again;
// - TLS verification is Node's default against the configured host name, never off;
// - per-request dual-stack attempts of 2.5 s (Node's 250 ms default can miss a distant
//   dual-stack peer, see e3a8db9); nothing process-wide changes;
// - separate connection and request deadlines; a byte cap; no compression.
//
// Failures are reported as categories. Nothing here logs, and no error carries the key.

import type { LookupFunction } from "node:net";
import { guardedLookup, guardedRequest, guardedRequestOptions, type AddressPolicy, type GuardedRequestOptions, type Resolver } from "../../security/guarded-request.js";
import { literalAllowed, resolvedAllowed } from "./address-policy.js";
import type { RemoteConfig } from "./config.js";

export type { Resolver } from "../../security/guarded-request.js";

/** Per-address connection attempt, for dual-stack hosts. */
export const CONNECT_ATTEMPT_MS = 2_500;
/** Whole connection phase: DNS, every address attempt and the TLS handshake. */
export const CONNECT_DEADLINE_MS = 5_000;
/** The whole request, from DNS to the last body byte. */
export const REQUEST_DEADLINE_MS = 10_000;
export const USER_AGENT = "aeolus-remote/1";

/** The configured-peer policy: private and VPN addresses allowed, loopback only as a literal. */
export const CONFIGURED_PEER_POLICY: AddressPolicy = {
  allowLiteral: literalAllowed,
  allowResolved: resolvedAllowed,
};

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

/** A `net.connect` lookup that dials only answers the configured-peer policy allows. */
export function policyLookup(resolve?: Resolver): LookupFunction {
  return guardedLookup(CONFIGURED_PEER_POLICY, resolve);
}

export interface FetchDeps {
  resolve?: Resolver;
  /** Test hook for the deadlines. */
  deadlines?: { connectMs?: number; requestMs?: number };
  /** Test-only trust anchor; never reachable from connector config. */
  ca?: string;
}

function guardedOptions(config: RemoteConfig, signal: AbortSignal, deps: FetchDeps = {}): GuardedRequestOptions {
  return {
    url: new URL(config.endpointPath, config.origin),
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "User-Agent": USER_AGENT,
    },
    policy: CONFIGURED_PEER_POLICY,
    maxResponseBytes: config.maxResponseBytes,
    connectTimeoutMs: deps.deadlines?.connectMs ?? CONNECT_DEADLINE_MS,
    requestTimeoutMs: deps.deadlines?.requestMs ?? REQUEST_DEADLINE_MS,
    attemptTimeoutMs: CONNECT_ATTEMPT_MS,
    // Redirects and refusals carry nothing the connector uses.
    readBody: (status) => status >= 200 && status < 300,
    decode: false,
    signal,
    resolve: deps.resolve,
    ca: deps.ca,
  };
}

/** The request options, separated so their security properties can be tested. */
export function requestOptions(config: RemoteConfig, signal: AbortSignal, resolve?: Resolver) {
  return guardedRequestOptions(guardedOptions(config, signal, { resolve }), signal);
}

function header(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** GET the configured endpoint once. Never throws. */
export async function fetchRemote(config: RemoteConfig, signal: AbortSignal, deps: FetchDeps = {}): Promise<TransportResult> {
  const result = await guardedRequest(guardedOptions(config, signal, deps));
  if (result.kind === "failure") {
    return { kind: "failure", reason: result.reason === "unsupported-encoding" ? "invalid-response" : result.reason };
  }
  return {
    kind: "response",
    status: result.status,
    body: result.body,
    contentType: header(result.headers["content-type"]),
    date: header(result.headers.date),
    retryAfter: header(result.headers["retry-after"]),
  };
}
