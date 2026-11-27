// src/api/proxy-trust.ts — which peers may set X-Forwarded-* (hardening F5).
//
// Express's numeric `trust proxy` (the old TRUST_PROXY_HOPS behaviour) trusts the N
// hops nearest the server whatever their address. With the backend listening on every
// interface, a client that reaches it directly IS the nearest hop, so its forged
// X-Forwarded-For moved the per-IP login limiter and its forged X-Forwarded-Proto
// satisfied EXPOSED_API_REQUIRE_HTTPS and the Secure-cookie decision.
//
// Trust now needs both: a hop within TRUST_PROXY_HOPS, and an address in
// TRUSTED_PROXY_ADDRESSES (default `loopback`, the documented proxy on the same host).
// Any other peer's forwarded headers are ignored: req.ip is its socket address and
// req.secure is false unless the socket itself is TLS.

import { BlockList, isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";
import logger from "../logger.js";

/** Named ranges accepted in TRUSTED_PROXY_ADDRESSES, as Express names them. */
const NAMED: Record<string, Array<[string, number, "ipv4" | "ipv6"]>> = {
  loopback: [["127.0.0.0", 8, "ipv4"], ["::1", 128, "ipv6"]],
  linklocal: [["169.254.0.0", 16, "ipv4"], ["fe80::", 10, "ipv6"]],
  uniquelocal: [["10.0.0.0", 8, "ipv4"], ["172.16.0.0", 12, "ipv4"], ["192.168.0.0", 16, "ipv4"], ["fc00::", 7, "ipv6"]],
};

export class ProxyTrustConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyTrustConfigError";
  }
}

/** Strip a zone and reduce an IPv4-mapped IPv6 address to IPv4. */
export function normalisePeer(address: string): { address: string; type: "ipv4" | "ipv6" } | null {
  const bare = address.split("%", 1)[0]!.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  const candidate = mapped ? mapped[1]! : bare;
  const family = isIP(candidate);
  return family === 4 ? { address: candidate, type: "ipv4" } : family === 6 ? { address: candidate, type: "ipv6" } : null;
}

/**
 * Parse a comma-separated list of addresses, CIDR ranges and the names `loopback`,
 * `linklocal` and `uniquelocal`. Anything else is a configuration error: an
 * unreadable trust list must stop startup rather than trust nothing, or everything.
 */
export function parseTrustedProxies(raw: string): BlockList {
  const list = new BlockList();
  const entries = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new ProxyTrustConfigError("TRUSTED_PROXY_ADDRESSES is empty");
  for (const entry of entries) {
    const named = NAMED[entry.toLowerCase()];
    if (named) {
      for (const [network, prefix, type] of named) list.addSubnet(network, prefix, type);
      continue;
    }
    const [address, prefixText, extra] = entry.split("/");
    const peer = address ? normalisePeer(address) : null;
    if (!peer || extra !== undefined) throw new ProxyTrustConfigError(`TRUSTED_PROXY_ADDRESSES: "${entry}" is not an address, CIDR range or loopback/linklocal/uniquelocal`);
    if (prefixText === undefined) {
      list.addAddress(peer.address, peer.type);
      continue;
    }
    const prefix = Number(prefixText);
    const max = peer.type === "ipv4" ? 32 : 128;
    if (!/^\d+$/.test(prefixText) || prefix < 0 || prefix > max) throw new ProxyTrustConfigError(`TRUSTED_PROXY_ADDRESSES: "${entry}" has an invalid prefix length`);
    list.addSubnet(peer.address, prefix, peer.type);
  }
  return list;
}

export type TrustProxySetting = false | ((address: string, hop: number) => boolean);

export interface ProxyTrust {
  /** For `app.set("trust proxy", ...)`. */
  setting: TrustProxySetting;
  /** Is this socket peer a trusted proxy? */
  trusts(address: string | undefined): boolean;
  hops: number;
}

/** Trust only peers that are within `hops` of the server AND in the address list. */
export function createProxyTrust(hops: number, addresses: string): ProxyTrust {
  if (!Number.isInteger(hops) || hops <= 0) return { setting: false, trusts: () => false, hops: 0 };
  const list = parseTrustedProxies(addresses);
  const trusts = (address: string | undefined) => {
    const peer = address ? normalisePeer(address) : null;
    return peer !== null && list.check(peer.address, peer.type);
  };
  return { setting: (address, hop) => hop < hops && trusts(address), trusts, hops };
}

const FORWARDED = ["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"];
const MAX_WARNED = 64;

/**
 * Log once per peer address when forwarded headers arrive from a peer that is not a
 * trusted proxy, so a misconfigured proxy is visible rather than silently ignored.
 */
export function untrustedForwardingNotice(trust: ProxyTrust) {
  const warned = new Set<string>();
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (trust.hops > 0 && warned.size < MAX_WARNED) {
      const peer = req.socket.remoteAddress ?? "";
      if (!warned.has(peer) && FORWARDED.some((name) => req.headers[name] !== undefined) && !trust.trusts(peer)) {
        warned.add(peer);
        logger.warn(
          { peer, trustedProxyHops: trust.hops },
          "Forwarded headers from a peer that is not a trusted proxy were ignored; if this is your reverse proxy, add its address to TRUSTED_PROXY_ADDRESSES",
        );
      }
    }
    next();
  };
}
