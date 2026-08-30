import { describe, expect, it, vi } from "vitest";
import {
  OutboundHttpPolicyError,
  isPublicIpAddress,
  isPublicIpv4,
  isPublicIpv6,
  requestPublicHttp,
  validatePublicHttpUrl,
} from "./outbound-http.js";

describe("outbound HTTP policy", () => {
  it.each([
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "2::1", "200::1", "fe80::1", "fc00::1",
    "2001::1", "2001:0:53aa:64c:0:0:c000:0201", "2001:db8::1", "2002:c0a8:0101::1", "3fff::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => expect(isPublicIpAddress(address)).toBe(true),
  );

  it("rejects non-HTTP schemes and URL credentials", async () => {
    await expect(validatePublicHttpUrl("file:///etc/passwd")).rejects.toBeInstanceOf(OutboundHttpPolicyError);
    await expect(validatePublicHttpUrl("https://user:secret@example.com")).rejects.toThrow(/Credentials/);
  });

  it("rejects a hostname when any DNS answer is private", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(validatePublicHttpUrl("https://example.com/hook", lookup)).rejects.toThrow(/resolves to/);
  });

  it("disables redirects and bounds request/response bodies", async () => {
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response("12345", { status: 200 });
    }) as unknown as typeof fetch;
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }];

    await expect(requestPublicHttp("https://example.com", {
      body: "12345",
      maxRequestBytes: 4,
      lookup,
      fetchImpl,
    })).rejects.toThrow(/request body exceeds/);

    await expect(requestPublicHttp("https://example.com", {
      maxResponseBytes: 4,
      lookup,
      fetchImpl,
    })).rejects.toThrow(/response exceeds/);
  });
});

// The address classifiers are the load-bearing half of this SSRF boundary, so
// their reserved-range and malformed-input branches are asserted directly
// rather than only through the URL/DNS paths above.
describe("outbound HTTP address classification", () => {
  it.each([
    "1.2.3",           // too few octets
    "1.2.3.4.5",       // too many octets
    "1.2.3.999",       // octet out of range
    "1.2.3.-1",        // negative octet
    "1.2.3.x",         // non-numeric octet
    "1.2.3.4.",        // trailing separator
  ])("treats malformed IPv4 %s as non-public", (address) => {
    expect(isPublicIpv4(address)).toBe(false);
  });

  it.each([
    "192.0.0.1",       // IETF protocol assignments
    "192.0.2.5",       // documentation
    "198.18.0.1",      // benchmarking
    "198.19.0.1",      // benchmarking
    "198.51.100.7",    // documentation
    "203.0.113.7",     // documentation
    "240.0.0.1",       // reserved
    "255.255.255.255", // broadcast
  ])("treats reserved IPv4 %s as non-public", (address) => {
    expect(isPublicIpv4(address)).toBe(false);
  });

  it.each(["203.0.114.1", "198.20.0.1", "192.1.0.1"])(
    "treats neighbouring public IPv4 %s as public",
    (address) => expect(isPublicIpv4(address)).toBe(true),
  );

  it("judges IPv4-mapped IPv6 by the embedded IPv4 address", () => {
    expect(isPublicIpv6("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIpv6("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpv6("::ffff:192.168.1.1")).toBe(false);
  });

  it.each([
    "1::2::3",           // more than one "::" group
    "20000::1",          // hextet out of range
    "2000:1:2:3:4:5:6",  // too few hextets without "::"
    "2000::1.2.3.4",     // dotted tail that is not ::ffff:
    "2000:1:2:3:4:5:6:7:8", // too many hextets
    "2000::zzzz",        // non-hex hextet
  ])("treats malformed IPv6 %s as non-public", (address) => {
    expect(isPublicIpv6(address)).toBe(false);
  });

  it("strips brackets and zone identifiers before classifying", () => {
    expect(isPublicIpv6("[2606:4700:4700::1111]")).toBe(true);
    expect(isPublicIpAddress("[2606:4700:4700::1111]")).toBe(true);
    expect(isPublicIpv6("fe80::1%eth0")).toBe(false);
  });

  it("treats anything that is not an IP literal as non-public", () => {
    expect(isPublicIpAddress("example.com")).toBe(false);
    expect(isPublicIpAddress("")).toBe(false);
  });
});

describe("validatePublicHttpUrl", () => {
  it("rejects an unparseable URL", async () => {
    await expect(validatePublicHttpUrl("not a url")).rejects.toThrow(/Invalid outbound URL/);
  });

  it("accepts a public IP literal without consulting DNS", async () => {
    const lookup = vi.fn();
    const url = await validatePublicHttpUrl("http://1.1.1.1/hook", lookup);
    expect(url.hostname).toBe("1.1.1.1");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a private IP literal without consulting DNS", async () => {
    const lookup = vi.fn();
    await expect(validatePublicHttpUrl("http://127.0.0.1/hook", lookup)).rejects.toThrow(/blocked/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a bracketed private IPv6 literal", async () => {
    await expect(validatePublicHttpUrl("http://[::1]/hook")).rejects.toThrow(/blocked/);
  });

  it("surfaces a DNS failure as a policy error", async () => {
    const lookup = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    await expect(validatePublicHttpUrl("https://example.com", lookup))
      .rejects.toThrow(/DNS lookup failed for outbound host: ENOTFOUND/);
  });

  it("rejects a hostname that resolves to nothing", async () => {
    const lookup = vi.fn(async () => []);
    await expect(validatePublicHttpUrl("https://example.com", lookup)).rejects.toThrow(/did not resolve/);
  });

  it("accepts a hostname whose every answer is public", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    const url = await validatePublicHttpUrl("https://example.com/hook", lookup);
    expect(url.hostname).toBe("example.com");
    expect(lookup).toHaveBeenCalledWith("example.com");
  });
});

describe("requestPublicHttp", () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  it("returns the bounded response and defaults to GET", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello", {
      status: 201,
      statusText: "Created",
      headers: { "x-test": "1" },
    })) as unknown as typeof fetch;

    const result = await requestPublicHttp("https://example.com", { lookup: publicLookup, fetchImpl });

    expect(result.status).toBe(201);
    expect(result.statusText).toBe("Created");
    expect(result.body).toBe("hello");
    expect(result.headers.get("x-test")).toBe("1");
    const init = vi.mocked(fetchImpl).mock.calls[0][1];
    expect(init?.method).toBe("GET");
  });

  it("forwards an explicit method, headers and body", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

    await requestPublicHttp("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      timeoutMs: 500,
      lookup: publicLookup,
      fetchImpl,
    });

    const init = vi.mocked(fetchImpl).mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
  });

  it("returns an empty body for a bodyless response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const result = await requestPublicHttp("https://example.com", { lookup: publicLookup, fetchImpl });
    expect(result.status).toBe(204);
    expect(result.body).toBe("");
  });

  it("never issues the request when the URL fails policy", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(requestPublicHttp("http://169.254.169.254/latest/meta-data", { fetchImpl }))
      .rejects.toBeInstanceOf(OutboundHttpPolicyError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
