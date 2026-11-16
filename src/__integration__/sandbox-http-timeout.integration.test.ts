// Linux/native proof that authored `timeoutMs` crosses the isolate boundary.
//
// The part that can only fail here is the bridge: the bootstrap passes the value as an
// extra primitive argument to the host reference, and isolated-vm transfers only what
// it is handed. A pure test cannot show the number arrives. The outbound module is
// spied, so no network is touched and the host-side clamp is what is observed.

import { afterEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ url: string; timeoutMs: unknown; method: unknown }> = [];
vi.mock("../security/outbound-http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../security/outbound-http.js")>();
  return {
    ...actual,
    requestPublicHttp: async (url: string, options: { timeoutMs?: unknown; method?: unknown }) => {
      calls.push({ url, timeoutMs: options.timeoutMs, method: options.method });
      return { status: 200, statusText: "OK", headers: new Headers(), body: "ok" };
    },
  };
});

const { Sandbox } = await import("../automations/sandbox.js");

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

const context = { topic: "manual/test", deviceId: "", state: {}, timestamp: Date.now() };
const makeSandbox = () => new Sandbox({
  commandService: { execute: async () => ({ success: true }) } as never,
  deviceRegistry: { getAll: () => [] } as never,
});

describe("real isolated-vm http timeout", () => {
  afterEach(() => { calls.length = 0; });

  realIt("passes a requested timeout through, defaults an absent one, and clamps an excessive one", async () => {
    const result = await makeSandbox().execute(`
      automation({ actions: [async function run() {
        const a = await http.get("https://example.com/a", { timeoutMs: 20000 });
        const b = await http.get("https://example.com/b");
        const c = await http.post("https://example.com/c", { body: "{}", timeoutMs: 90000 });
        if (a.status !== 200 || b.status !== 200 || c.status !== 200) throw new Error("bridge result lost");
      }] });
    `, context, "rule-http-timeout");

    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      { url: "https://example.com/a", timeoutMs: 20_000, method: "GET" },
      { url: "https://example.com/b", timeoutMs: 10_000, method: "GET" },
      { url: "https://example.com/c", timeoutMs: 25_000, method: "POST" },
    ]);
  });
});
