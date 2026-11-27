// src/connectors/aeolus-remote/config.ts — parse and validate one remote instance's
// configuration. Problems are described without ever echoing the API key.

import { isIP } from "node:net";
import { literalAllowed, normaliseAddress } from "./address-policy.js";

/** Bounds, also stated in the config form's help text and in the connector docs. */
export const POLL_SECONDS = { min: 5, max: 3600, default: 60 } as const;
export const STALE_AFTER_SECONDS = { min: 10, max: 7 * 24 * 3600, default: 300 } as const;
export const MAX_RESPONSE_KIB = { min: 1, max: 1024, default: 256 } as const;

const API_KEY = /^aeo_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/;
/** `/api/exposed/v1/<slug>/<route path>`: plain path segments, no query or fragment. */
const ENDPOINT_PATH = /^\/api\/exposed\/v1\/[a-z0-9](?:[a-z0-9-]{0,62})(?:\/[A-Za-z0-9._~-]+)+$/;
const FIELD_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*){0,3}$/;

export interface RemoteConfig {
  /** Canonical origin, e.g. `https://pi.lan:3001`. */
  origin: string;
  protocol: "https:" | "http:";
  /** Host as `http.request` wants it: brackets removed for IPv6 literals. */
  hostname: string;
  /** True when the host is an IP literal, which is checked here, not by DNS. */
  literalHost: boolean;
  port: number;
  endpointPath: string;
  slug: string;
  apiKey: string;
  pollIntervalMs: number;
  staleAfterMs: number;
  maxResponseBytes: number;
  sourceTimeField: string | null;
  requireSourceTime: boolean;
  displayName: string;
}

export type ParseResult = { ok: true; config: RemoteConfig } | { ok: false; problems: string[] };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function flag(value: unknown): boolean {
  return value === true || value === "true";
}

function bounded(value: unknown, name: string, range: { min: number; max: number; default: number }, problems: string[]): number {
  if (value === undefined || value === null || value === "") return range.default;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < range.min || number > range.max) {
    problems.push(`${name} must be a whole number from ${range.min} to ${range.max}`);
    return range.default;
  }
  return number;
}

/** Parse a stored or posted config. Never includes the key in a problem. */
export function parseRemoteConfig(raw: Record<string, unknown>): ParseResult {
  const problems: string[] = [];
  const allowPlaintext = flag(raw.allowPlaintextHttp);

  let url: URL | null = null;
  const base = text(raw.baseUrl);
  try {
    url = new URL(base);
  } catch {
    problems.push("baseUrl must be an absolute URL such as https://aeolus-a.lan:3001");
  }
  if (url) {
    if (url.protocol !== "https:" && url.protocol !== "http:") problems.push("baseUrl must use https or http");
    if (url.username || url.password) problems.push("baseUrl must not contain credentials");
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || /[?#]/.test(base)) {
      problems.push("baseUrl must be an origin only (scheme, host and port), with the path in endpointPath");
    }
    if (url.protocol === "http:" && !allowPlaintext) {
      problems.push("baseUrl uses plain HTTP: turn on \"Allow plaintext HTTP on a trusted LAN\" only for a trusted LAN or VPN, or use https");
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host) problems.push("baseUrl must name a host");
    if (host === "localhost" || host.endsWith(".localhost")) {
      problems.push("baseUrl must not use the name localhost; use 127.0.0.1 or ::1 for a peer on this host");
    }
    if (isIP(host) && !literalAllowed(host)) {
      problems.push("baseUrl names an address that is never allowed (unspecified, link-local, multicast or reserved)");
    }
  }

  const endpointPath = text(raw.endpointPath);
  if (!ENDPOINT_PATH.test(endpointPath) || endpointPath.length > 512 || endpointPath.split("/").some((part) => part === "." || part === "..")) {
    problems.push("endpointPath must be a published route path such as /api/exposed/v1/site-a/conditions/summary, with no query string");
  }

  const apiKey = text(raw.apiKey);
  if (!API_KEY.test(apiKey)) problems.push("apiKey is not an Aeolus Project API key (aeo_…); paste the key issued on the remote installation");

  const pollSeconds = bounded(raw.pollIntervalSeconds, "pollIntervalSeconds", POLL_SECONDS, problems);
  const staleSeconds = bounded(raw.staleAfterSeconds, "staleAfterSeconds", STALE_AFTER_SECONDS, problems);
  if (staleSeconds < pollSeconds) problems.push("staleAfterSeconds must be at least pollIntervalSeconds");
  const maxKiB = bounded(raw.maxResponseKiB, "maxResponseKiB", MAX_RESPONSE_KIB, problems);

  const sourceTimeField = text(raw.sourceTimeField);
  if (sourceTimeField && !FIELD_PATH.test(sourceTimeField)) {
    problems.push("sourceTimeField must be a field name or a dotted path of up to four names, such as observedAt or reading.time");
  }
  const requireSourceTime = flag(raw.requireSourceTime);
  if (requireSourceTime && !sourceTimeField) problems.push("requireSourceTime needs sourceTimeField");

  const displayName = text(raw.displayName).slice(0, 80);

  if (problems.length > 0 || !url) return { ok: false, problems };
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literal = normaliseAddress(hostname);
  const slug = endpointPath.split("/")[4]!;
  return {
    ok: true,
    config: {
      origin: url.origin,
      protocol: url.protocol as "https:" | "http:",
      hostname,
      literalHost: literal !== null && isIP(hostname) !== 0,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      endpointPath,
      slug,
      apiKey,
      pollIntervalMs: pollSeconds * 1000,
      staleAfterMs: staleSeconds * 1000,
      maxResponseBytes: maxKiB * 1024,
      sourceTimeField: sourceTimeField || null,
      requireSourceTime,
      displayName: displayName || `Remote ${slug}`,
    },
  };
}
