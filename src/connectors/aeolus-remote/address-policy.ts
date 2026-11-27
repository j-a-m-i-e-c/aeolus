// src/connectors/aeolus-remote/address-policy.ts — which addresses the remote
// connector may dial.
//
// This is the connector's own destination policy. It does not use or relax the
// authored-HTTP policy in src/security/outbound-http.ts (ADR-0020), which allows
// public addresses only. A peer is normally on a LAN or VPN, so private, CGNAT
// (Tailscale) and IPv6 ULA addresses are allowed, but only for the host an admin
// configured; nothing learned from a response is ever dialled.
//
// Always refused: unspecified, link-local (including 169.254.169.254 metadata),
// multicast, broadcast and reserved ranges, deprecated site-local IPv6.
// Loopback is allowed only when the admin typed a loopback IP literal. A DNS name
// that resolves to loopback is refused, as is a name with ANY refused answer, so a
// rebinding answer cannot steer the key to this host or to a metadata service.

import { BlockList, isIP } from "node:net";

const ALWAYS_REFUSED = new BlockList();
ALWAYS_REFUSED.addSubnet("0.0.0.0", 8, "ipv4"); // "this network", unspecified
ALWAYS_REFUSED.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, cloud metadata
ALWAYS_REFUSED.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
ALWAYS_REFUSED.addSubnet("240.0.0.0", 4, "ipv4"); // reserved, broadcast
ALWAYS_REFUSED.addAddress("::", "ipv6"); // unspecified
ALWAYS_REFUSED.addSubnet("fe80::", 10, "ipv6"); // link-local
ALWAYS_REFUSED.addSubnet("fec0::", 10, "ipv6"); // deprecated site-local
ALWAYS_REFUSED.addSubnet("ff00::", 8, "ipv6"); // multicast

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

export type AddressVerdict = "allowed" | "refused" | "loopback";

/** Strip IPv6 brackets and zone, and reduce an IPv4-mapped IPv6 address to IPv4. */
export function normaliseAddress(address: string): { address: string; family: 4 | 6 } | null {
  const bare = address.replace(/^\[|\]$/g, "").split("%", 1)[0]!.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  const candidate = mapped ? mapped[1]! : bare;
  const family = isIP(candidate);
  if (family === 4) return { address: candidate, family: 4 };
  if (family === 6) return { address: candidate, family: 6 };
  return null;
}

/** Classify one address. Anything unparseable is refused. */
export function classifyAddress(address: string): AddressVerdict {
  const parsed = normaliseAddress(address);
  if (!parsed) return "refused";
  const type = parsed.family === 4 ? "ipv4" : "ipv6";
  if (ALWAYS_REFUSED.check(parsed.address, type)) return "refused";
  if (LOOPBACK.check(parsed.address, type)) return "loopback";
  return "allowed";
}

/** May the admin-typed IP literal be dialled? Loopback is allowed only this way. */
export function literalAllowed(address: string): boolean {
  return classifyAddress(address) !== "refused";
}

/** May a DNS answer be dialled? Every answer must pass; loopback never does. */
export function resolvedAllowed(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every((address) => classifyAddress(address) === "allowed");
}
