// src/connectors/aeolus-remote/config.test.ts — what an admin may configure.
import { describe, expect, it } from "vitest";
import { parseRemoteConfig } from "./config.js";
import { classifyAddress, literalAllowed, normaliseAddress, resolvedAllowed } from "./address-policy.js";

const KEY = "aeo_0123456789abcdef_" + "S".repeat(43);
const base = { baseUrl: "https://aeolus-a.lan:3001", endpointPath: "/api/exposed/v1/site-a/conditions/summary", apiKey: KEY };

function problems(over: Record<string, unknown>): string[] {
  const parsed = parseRemoteConfig({ ...base, ...over });
  return parsed.ok ? [] : parsed.problems;
}

describe("parseRemoteConfig", () => {
  it("accepts a minimal HTTPS config with documented defaults", () => {
    const parsed = parseRemoteConfig(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config).toMatchObject({
      origin: "https://aeolus-a.lan:3001", protocol: "https:", hostname: "aeolus-a.lan", port: 3001, literalHost: false, slug: "site-a",
      pollIntervalMs: 60_000, staleAfterMs: 300_000, maxResponseBytes: 256 * 1024, sourceTimeField: null, displayName: "Remote site-a",
    });
  });

  it("refuses plain HTTP unless the trusted-LAN flag is on", () => {
    expect(problems({ baseUrl: "http://192.168.1.20:3001" }).join()).toMatch(/plain HTTP/);
    expect(problems({ baseUrl: "http://192.168.1.20:3001", allowPlaintextHttp: true })).toEqual([]);
    expect(problems({ baseUrl: "http://192.168.1.20:3001", allowPlaintextHttp: "true" })).toEqual([]);
  });

  it.each([
    ["not a url", /absolute URL/],
    ["ftp://a.lan", /https or http/],
    ["https://user:pw@a.lan", /credentials/],
    ["https://a.lan/api", /origin only/],
    ["https://a.lan/?x=1", /origin only/],
    ["https://a.lan/#x", /origin only/],
    ["https://localhost:3001", /localhost/],
    ["https://169.254.169.254", /never allowed/],
    ["https://0.0.0.0", /never allowed/],
    ["https://[ff02::1]", /never allowed/],
  ])("refuses the base URL %s", (baseUrl, message) => {
    expect(problems({ baseUrl }).join()).toMatch(message);
  });

  it("allows a loopback literal, private, CGNAT, ULA and public addresses", () => {
    for (const baseUrl of ["https://127.0.0.1:3101", "https://[::1]:3101", "https://10.0.0.5", "https://100.101.1.2", "https://[fd12:3456::1]", "https://203.0.113.9"]) {
      expect(problems({ baseUrl }), baseUrl).toEqual([]);
    }
    const parsed = parseRemoteConfig({ ...base, baseUrl: "https://[fd12:3456::1]:8443" });
    expect(parsed.ok && parsed.config).toMatchObject({ hostname: "fd12:3456::1", literalHost: true, port: 8443 });
  });

  it.each([
    "/api/exposed/v1/site-a",
    "/api/other/v1/site-a/x",
    "/api/exposed/v1/site-a/x?y=1",
    "/api/exposed/v1/site-a/../x",
    "/api/exposed/v1/Site_A/x",
    "api/exposed/v1/site-a/x",
    "",
  ])("refuses the endpoint path %j", (endpointPath) => {
    expect(problems({ endpointPath }).join()).toMatch(/endpointPath/);
  });

  it("refuses a malformed key without echoing it", () => {
    const secret = "aeo_not-really-a-key-but-secret";
    const found = problems({ apiKey: secret });
    expect(found.join()).toMatch(/apiKey is not an Aeolus Project API key/);
    expect(found.join()).not.toContain(secret);
    expect(problems({ apiKey: "" }).join()).toMatch(/apiKey/);
  });

  it("bounds the numbers and relates stale-after to the interval", () => {
    expect(problems({ pollIntervalSeconds: 4 }).join()).toMatch(/pollIntervalSeconds/);
    expect(problems({ pollIntervalSeconds: 3601 }).join()).toMatch(/pollIntervalSeconds/);
    expect(problems({ pollIntervalSeconds: 2.5 }).join()).toMatch(/pollIntervalSeconds/);
    expect(problems({ pollIntervalSeconds: "x" }).join()).toMatch(/pollIntervalSeconds/);
    expect(problems({ pollIntervalSeconds: "30", staleAfterSeconds: 60 })).toEqual([]);
    expect(problems({ pollIntervalSeconds: 120, staleAfterSeconds: 60 }).join()).toMatch(/at least pollIntervalSeconds/);
    expect(problems({ maxResponseKiB: 2048 }).join()).toMatch(/maxResponseKiB/);
  });

  it("checks the source time field and its requirement", () => {
    expect(problems({ sourceTimeField: "reading.time" })).toEqual([]);
    expect(problems({ sourceTimeField: "a.b.c.d.e" }).join()).toMatch(/sourceTimeField/);
    expect(problems({ sourceTimeField: "bad-name" }).join()).toMatch(/sourceTimeField/);
    expect(problems({ requireSourceTime: true }).join()).toMatch(/requireSourceTime needs/);
  });
});

describe("address policy", () => {
  it("refuses unspecified, link-local, metadata, multicast, reserved and broadcast", () => {
    for (const address of ["0.0.0.0", "169.254.169.254", "224.0.0.1", "255.255.255.255", "240.0.0.1", "::", "fe80::1", "fec0::1", "ff02::1", "::ffff:169.254.169.254", "not-an-ip"]) {
      expect(classifyAddress(address), address).toBe("refused");
    }
  });

  it("separates loopback, which only a literal may use", () => {
    expect(classifyAddress("127.0.0.1")).toBe("loopback");
    expect(classifyAddress("::ffff:127.0.0.1")).toBe("loopback");
    expect(literalAllowed("::1")).toBe(true);
    expect(resolvedAllowed(["::1"])).toBe(false);
  });

  it("requires every DNS answer to be allowed", () => {
    expect(resolvedAllowed(["192.168.1.20", "fd00::20"])).toBe(true);
    expect(resolvedAllowed(["192.168.1.20", "127.0.0.1"])).toBe(false);
    expect(resolvedAllowed(["192.168.1.20", "169.254.169.254"])).toBe(false);
    expect(resolvedAllowed([])).toBe(false);
  });

  it("normalises brackets, zones and mapped addresses", () => {
    expect(normaliseAddress("[fe80::1%eth0]")).toEqual({ address: "fe80::1", family: 6 });
    expect(normaliseAddress("::ffff:10.0.0.1")).toEqual({ address: "10.0.0.1", family: 4 });
    expect(normaliseAddress("host.lan")).toBeNull();
  });
});
