// src/security/outbound-http.ts — shared policy for user/configured outbound HTTP
//
// This boundary is intentionally stricter than connector networking. Authored
// automations and generic webhook actions may only reach public HTTP(S)
// destinations; connector implementations remain free to talk to explicitly
// configured LAN devices such as Hue bridges.
//
// The connection goes through src/security/guarded-request.ts with the public-only
// policy below. The destination is enforced where the connection is made: every DNS
// answer is checked inside the connection's own lookup and the connected address is
// checked again, so a rebinding DNS answer cannot reach a private address between a
// check and the connection.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { guardedRequest, type AddressPolicy, type GuardedFailure, type Resolver } from "./guarded-request.js";

/** Default timeout for one outbound request. */
export const OUTBOUND_HTTP_TIMEOUT_MS = 10_000;
/**
 * Shortest and longest timeout authored code may ask for (`http.get(url, { timeoutMs })`).
 *
 * The ceiling is set by the run, not by the network: an automation run gets a 30 s
 * completion budget (ACTION_DRAIN_BUDGET_MS in automations/sandbox.ts), and a request
 * still in flight when it expires is abandoned with the run. 25 s lets one slow request
 * finish inside that budget with room for the work around it. Some public services
 * take longer than 10 s to answer even a small query, which is what this is for.
 */
export const OUTBOUND_HTTP_MIN_TIMEOUT_MS = 1_000;
export const OUTBOUND_HTTP_MAX_TIMEOUT_MS = 25_000;
export const OUTBOUND_HTTP_MAX_REQUEST_BYTES = 256 * 1024;
export const OUTBOUND_HTTP_MAX_RESPONSE_BYTES = 1024 * 1024;

export class OutboundHttpPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundHttpPolicyError";
  }
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers;
}

/** True only for globally routable IPv4 addresses suitable for authored HTTP. */
export function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // documentation
  if (a === 192 && b === 88 && c === 99) return false; // deprecated 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmark networks
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast/reserved/broadcast
  return true;
}

function parseIpv6BigInt(address: string): bigint | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0];
  if (normalized.includes(".")) return null; // dotted forms are handled separately
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = halves.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (parts.length !== 8) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(part, 16));
  }
  return value;
}

function ipv6InCidr(value: bigint, base: bigint, prefixBits: number): boolean {
  const shift = BigInt(128 - prefixBits);
  return (value >> shift) === (base >> shift);
}

/** True only for globally routable IPv6 addresses suitable for authored HTTP. */
export function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0];

  // IPv4-mapped IPv6 forms are judged by their embedded IPv4 address.
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);

  const value = parseIpv6BigInt(normalized);
  if (value === null) return false;

  // Public global-unicast space is 2000::/3, but it contains several IANA
  // special-use ranges that should not be treated as arbitrary public targets.
  const globalBase = 0x20000000000000000000000000000000n;
  if (!ipv6InCidr(value, globalBase, 3)) return false;

  const blocked: Array<[bigint, number]> = [
    [0x20010000000000000000000000000000n, 23], // IETF protocol assignments (includes Teredo/ORCHID blocks)
    [0x20010db8000000000000000000000000n, 32], // documentation
    [0x20020000000000000000000000000000n, 16], // deprecated 6to4 transition space
    [0x3fff0000000000000000000000000000n, 20], // documentation
  ];
  return !blocked.some(([base, prefix]) => ipv6InCidr(value, base, prefix));
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type OutboundLookup = (hostname: string) => Promise<ResolvedAddress[]>;

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

/** Authored HTTP and webhooks: public addresses only, every DNS answer. */
export const PUBLIC_ONLY_POLICY: AddressPolicy = {
  allowLiteral: (address) => isPublicIpAddress(address),
  allowResolved: (addresses) => addresses.length > 0 && addresses.every((address) => isPublicIpAddress(address)),
};

/** Per-address connection attempt for dual-stack hosts (Node's default is 250 ms). */
export const OUTBOUND_HTTP_ATTEMPT_MS = 2_500;
/** Longest connection phase: DNS, every address attempt and TLS. Never longer than the request timeout. */
export const OUTBOUND_HTTP_CONNECT_MS = 5_000;

/**
 * Check an outbound URL and every DNS answer, without connecting.
 *
 * A diagnostic check only: `requestPublicHttp` does not rely on it. A connection
 * resolves the name again, so only the connection-time check in the guarded request
 * decides what is dialled.
 */
export async function validatePublicHttpUrl(
  rawUrl: string,
  lookup: OutboundLookup = defaultLookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundHttpPolicyError("Invalid outbound URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundHttpPolicyError("Only public HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new OutboundHttpPolicyError("Credentials in outbound URLs are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new OutboundHttpPolicyError("Outbound URL has no hostname");

  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new OutboundHttpPolicyError("Private, local, link-local, or reserved destinations are blocked");
    }
    return url;
  }

  let answers: ResolvedAddress[];
  try {
    answers = await lookup(hostname);
  } catch (error) {
    throw new OutboundHttpPolicyError(`DNS lookup failed for outbound host: ${(error as Error).message}`);
  }
  if (answers.length === 0) {
    throw new OutboundHttpPolicyError("Outbound hostname did not resolve");
  }
  if (answers.some((answer) => !isPublicIpAddress(answer.address))) {
    throw new OutboundHttpPolicyError("Outbound hostname resolves to a private, local, link-local, or reserved address");
  }

  return url;
}

/** The URL checks that need no DNS: scheme, credentials, host, and an IP literal's address. */
function parseOutboundUrl(rawUrl: string, policy: AddressPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundHttpPolicyError("Invalid outbound URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundHttpPolicyError("Only public HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new OutboundHttpPolicyError("Credentials in outbound URLs are not allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new OutboundHttpPolicyError("Outbound URL has no hostname");
  if (isIP(hostname) && !policy.allowLiteral(hostname)) {
    throw new OutboundHttpPolicyError("Private, local, link-local, or reserved destinations are blocked");
  }
  return url;
}

/**
 * Headers the transport owns. An author's value would change framing, the connection,
 * the destination's virtual host or the size accounting, so they are dropped.
 */
const TRANSPORT_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer",
  "accept-encoding", "expect", "proxy-authorization", "proxy-connection",
]);

/** Author headers minus transport-owned ones, with fetch's defaults where the author set none. */
export function outboundHeaders(headers: Record<string, string> | undefined, hasBody: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (TRANSPORT_HEADERS.has(lower) || lower.startsWith("proxy-")) continue;
    if (typeof value !== "string") continue;
    out[name] = value;
  }
  const has = (name: string) => Object.keys(out).some((key) => key.toLowerCase() === name);
  // The defaults fetch() sent, so existing authored requests are received the same way.
  if (!has("accept")) out.Accept = "*/*";
  if (!has("accept-language")) out["Accept-Language"] = "*";
  if (!has("user-agent")) out["User-Agent"] = "node";
  if (hasBody && !has("content-type")) out["Content-Type"] = "text/plain;charset=UTF-8";
  out["Accept-Encoding"] = "identity";
  return out;
}

function toHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      try { headers.append(name, item); } catch { /* a header fetch's Headers refuses is dropped */ }
    }
  }
  return headers;
}

/** Adapt an `OutboundLookup` (promise of every answer) to the guarded request's resolver. */
function resolverFrom(lookup: OutboundLookup): Resolver {
  return (hostname, callback) => {
    lookup(hostname).then(
      (answers) => {
        if (answers.length === 0) callback(Object.assign(new Error("no answers"), { code: "ENOTFOUND" }), []);
        else callback(null, answers.map((answer) => ({ address: answer.address, family: answer.family })));
      },
      (error: unknown) => callback(Object.assign(new Error("lookup failed"), { code: (error as NodeJS.ErrnoException)?.code ?? "ENOTFOUND" }), []),
    );
  };
}

function failureError(reason: GuardedFailure, timeoutMs: number, connectMs: number, maxResponseBytes: number): Error {
  switch (reason) {
    case "address-refused":
      return new OutboundHttpPolicyError("Outbound hostname resolves to a private, local, link-local, or reserved address");
    case "dns":
      return new OutboundHttpPolicyError("DNS lookup failed for outbound host");
    case "timeout":
      return new OutboundHttpPolicyError(`Outbound request timed out after ${timeoutMs} ms`);
    case "connect-timeout":
      return new OutboundHttpPolicyError(`Outbound request timed out after ${connectMs} ms while connecting`);
    case "response-too-large":
      return new OutboundHttpPolicyError(`Outbound response exceeds ${maxResponseBytes} bytes`);
    case "unsupported-encoding":
      return new Error("Outbound response uses an unsupported content encoding");
    case "tls":
      return new Error("Outbound request failed: the TLS certificate could not be verified for this host");
    case "connection-refused":
      return new Error("Outbound request failed: connection refused");
    case "aborted":
      return new Error("Outbound request was cancelled");
    default:
      return new Error("Outbound request failed: network error");
  }
}

export interface PublicHttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  lookup?: OutboundLookup;
}

export interface PublicHttpResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: string;
}

/**
 * Resolve a timeout requested by authored code.
 *
 * Absent, non-numeric, non-finite or non-positive values mean "use the default". Any
 * other value is clamped into [OUTBOUND_HTTP_MIN_TIMEOUT_MS, OUTBOUND_HTTP_MAX_TIMEOUT_MS]
 * rather than refused, so a script asking for 60 s gets the longest wait the platform
 * allows instead of a request that never runs.
 */
export function resolveOutboundTimeoutMs(requested: unknown): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return OUTBOUND_HTTP_TIMEOUT_MS;
  }
  return Math.min(OUTBOUND_HTTP_MAX_TIMEOUT_MS, Math.max(OUTBOUND_HTTP_MIN_TIMEOUT_MS, Math.round(requested)));
}

/**
 * One bounded, no-redirect request to a public destination. The public-only policy is
 * enforced at connection time (src/security/guarded-request.ts).
 */
export async function requestPublicHttp(
  rawUrl: string,
  options: PublicHttpRequestOptions = {},
): Promise<PublicHttpResponse> {
  return requestHttpWithPolicy(rawUrl, options, PUBLIC_ONLY_POLICY);
}

/**
 * Internal: `requestPublicHttp` with an explicit policy, so tests can reach local
 * servers. Authored code and webhooks must call `requestPublicHttp`; a static test
 * enforces that.
 */
export async function requestHttpWithPolicy(
  rawUrl: string,
  options: PublicHttpRequestOptions,
  policy: AddressPolicy,
): Promise<PublicHttpResponse> {
  const url = parseOutboundUrl(rawUrl, policy);
  const body = options.body;
  const maxRequestBytes = options.maxRequestBytes ?? OUTBOUND_HTTP_MAX_REQUEST_BYTES;
  if (body !== undefined && Buffer.byteLength(body, "utf8") > maxRequestBytes) {
    throw new OutboundHttpPolicyError(`Outbound request body exceeds ${maxRequestBytes} bytes`);
  }
  const timeoutMs = options.timeoutMs ?? OUTBOUND_HTTP_TIMEOUT_MS;
  const connectMs = Math.min(OUTBOUND_HTTP_CONNECT_MS, timeoutMs);
  const maxResponseBytes = options.maxResponseBytes ?? OUTBOUND_HTTP_MAX_RESPONSE_BYTES;
  const result = await guardedRequest({
    url,
    method: (options.method ?? "GET").toUpperCase(),
    headers: outboundHeaders(options.headers, body !== undefined),
    body: body !== undefined ? Buffer.from(body, "utf8") : undefined,
    policy,
    maxResponseBytes,
    connectTimeoutMs: connectMs,
    requestTimeoutMs: timeoutMs,
    attemptTimeoutMs: Math.min(OUTBOUND_HTTP_ATTEMPT_MS, connectMs),
    readBody: () => true,
    // Identity is requested; a server that compresses anyway is decoded under the cap.
    decode: true,
    resolve: resolverFrom(options.lookup ?? defaultLookup),
  });
  if (result.kind === "failure") throw failureError(result.reason, timeoutMs, connectMs, maxResponseBytes);
  return {
    status: result.status,
    statusText: result.statusText,
    headers: toHeaders(result.headers),
    body: new TextDecoder().decode(result.body),
  };
}