// src/security/outbound-http.ts — shared policy for user/configured outbound HTTP
//
// This boundary is intentionally stricter than connector networking. Authored
// automations and generic webhook actions may only reach public HTTP(S)
// destinations; connector implementations remain free to talk to explicitly
// configured LAN devices such as Hue bridges.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const OUTBOUND_HTTP_TIMEOUT_MS = 10_000;
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

/**
 * Validate an outbound URL and every DNS answer before a connection is made.
 *
 * This is a preflight policy, not DNS pinning: Node's fetch implementation may
 * perform a second resolution when it opens the connection. That small
 * preflight-to-connect TOCTOU window is documented as a residual limitation.
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

async function readBodyLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("response body limit exceeded");
        throw new OutboundHttpPolicyError(`Outbound response exceeds ${maxBytes} bytes`);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
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
  fetchImpl?: typeof fetch;
}

export interface PublicHttpResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: string;
}

/** Execute one bounded, no-redirect request to a DNS-preflighted public URL. */
export async function requestPublicHttp(
  rawUrl: string,
  options: PublicHttpRequestOptions = {},
): Promise<PublicHttpResponse> {
  const url = await validatePublicHttpUrl(rawUrl, options.lookup ?? defaultLookup);
  const body = options.body;
  const maxRequestBytes = options.maxRequestBytes ?? OUTBOUND_HTTP_MAX_REQUEST_BYTES;
  if (body !== undefined && Buffer.byteLength(body, "utf8") > maxRequestBytes) {
    throw new OutboundHttpPolicyError(`Outbound request body exceeds ${maxRequestBytes} bytes`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? OUTBOUND_HTTP_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    const responseBody = await readBodyLimited(
      response,
      options.maxResponseBytes ?? OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
    );
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: responseBody,
    };
  } finally {
    clearTimeout(timer);
  }
}
