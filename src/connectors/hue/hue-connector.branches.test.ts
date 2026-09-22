// src/connectors/hue/hue-connector.branches.test.ts — the Zigbee search loop and
// the fallbacks around it.
//
// hue-connector.test.ts covers connect, discovery, actions and health. The polling
// loop that `searchForNewLights()` starts was untested end to end: it is the one
// part of this connector that keeps running after the method returns, and it
// decides on its own when to stop, what counts as a new light, and whether a failed
// poll is fatal. Those decisions are what this file pins.
//
// Time is faked rather than waited on: the loop polls every 5s for up to 40s, and
// its stopping conditions are about elapsed time, which is the thing under test.
//
// `fetch` is routed by URL rather than queued response-by-response. The loop issues
// a variable number of requests depending on the branch being taken, so an ordered
// queue would leak unconsumed responses into the next test — which is a property of
// the harness, not of the connector.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HueConnector, hueDeviceId } from "./hue-connector.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const LIGHTS = {
  "1": {
    state: { on: true, bri: 254, hue: 0, sat: 0, ct: 370, colormode: "ct", reachable: true },
    type: "Extended color light",
    name: "Living Room",
    modelid: "LCT016",
    manufacturername: "Signify Netherlands B.V.",
    uniqueid: "00:11:22:33:44:55:66:77-0b",
    swversion: "1.90.1",
  },
  "3": {
    state: { on: true, bri: 200, reachable: true, colormode: "ct" as const },
    type: "On/Off plug-in unit",
    name: "Plug",
    modelid: "LOM001",
    manufacturername: "Signify Netherlands B.V.",
    uniqueid: "00:11:22:33:44:55:66:99-0b",
    swversion: "1.88.1",
  },
};

const COLOR_ID = hueDeviceId(LIGHTS["1"].uniqueid, "1");
const PLUG_ID = hueDeviceId(LIGHTS["3"].uniqueid, "3");

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

interface FetchScript {
  /** Response to the POST that starts a scan. */
  startStatus: number;
  /**
   * Successive answers to `GET /lights/new`. An Error is thrown rather than
   * returned, a number is returned as an HTTP failure, anything else is the JSON
   * body. When exhausted, the bridge keeps claiming the scan is active.
   */
  polls: unknown[];
  /** Whether the post-scan discovery refresh succeeds. */
  refreshFails: boolean;
}

/** Install a URL-routed fetch double and return its script for mutation. */
function routeFetch(): FetchScript {
  const script: FetchScript = { startStatus: 200, polls: [], refreshFails: false };
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
    const target = String(url);

    if (target.endsWith("/lights/new")) {
      const next = script.polls.length > 0 ? script.polls.shift() : { lastscan: "active" };
      if (next instanceof Error) throw next;
      if (typeof next === "number") return { ok: false, status: next, json: async () => ({}) };
      return ok(next);
    }

    if (target.endsWith("/lights") && init?.method === "POST") {
      return script.startStatus === 200
        ? ok({})
        : { ok: false, status: script.startStatus, json: async () => ({}) };
    }

    if (target.endsWith("/lights")) {
      if (script.refreshFails) throw new Error("bridge unreachable");
      return ok(LIGHTS);
    }

    // Per-light state read, action PUT, bridge config, pairing.
    if (init?.method === "PUT") return ok([{ success: {} }]);
    if (/\/lights\/\d+$/.test(target)) return ok(LIGHTS["1"]);
    return ok({ swversion: "1", apiversion: "1.56.0", swupdate2: { state: "noupdates" } });
  });
  return script;
}

describe("hueDeviceId", () => {
  it("falls back to the bridge index when a uniqueid sanitises away to nothing", () => {
    // A uniqueid of only separators yields an empty slug, which would name every
    // such light "hue-". The index is not globally unique either, but it does at
    // least distinguish the lights on one bridge.
    expect(hueDeviceId("!!!", "4")).toBe("hue-light-4");
    expect(hueDeviceId("---", "5")).toBe("hue-light-5");
  });

  it("slugs a real uniqueid rather than using the index", () => {
    expect(hueDeviceId("00:11:22-0b", "4")).toBe("hue-00-11-22-0b");
  });
});

describe("HueConnector — light search loop", () => {
  let connector: HueConnector;
  let script: FetchScript;

  beforeEach(() => {
    vi.useFakeTimers();
    script = routeFetch();
    connector = new HueConnector({ bridgeIp: "192.168.1.100", apiKey: "test-api-key" }, { localFetch: mockFetch });
  });

  afterEach(async () => {
    await connector.dispose();
    vi.useRealTimers();
  });

  it("reports the scan as active once the bridge accepts it", async () => {
    const state = await connector.searchForNewLights();
    expect(state.active).toBe(true);
    expect(state.error).toBeNull();
    expect(connector.getSearchStatus().active).toBe(true);
  });

  it("reports a bridge that refuses to start a scan", async () => {
    script.startStatus = 403;
    const state = await connector.searchForNewLights();
    expect(state.active).toBe(false);
    expect(state.error).toContain("403");
  });

  it("does not start a second scan while one is running", async () => {
    await connector.searchForNewLights();
    const callsAfterStart = mockFetch.mock.calls.length;

    const again = await connector.searchForNewLights();
    expect(again.active).toBe(true);
    expect(mockFetch.mock.calls.length).toBe(callsAfterStart);
  });

  it("collects newly found lights while the bridge reports the scan still active", async () => {
    script.polls = [{ lastscan: "active", "7": { name: "Hallway" }, "8": {} }];
    await connector.searchForNewLights();
    await vi.advanceTimersByTimeAsync(5000);

    const state = connector.getSearchStatus();
    // Still polling: an active scan inside the time budget is not a result yet.
    expect(state.active).toBe(true);
    expect(state.newLights).toEqual([
      { id: "7", name: "Hallway" },
      // A light the bridge has not named yet is still a light it found.
      { id: "8", name: "Light 8" },
    ]);
  });

  it("skips the lastscan marker and any non-object entry when reading results", async () => {
    script.polls = [{ lastscan: "active", noise: "not an object", nothing: null, "9": { name: "Study" } }];
    await connector.searchForNewLights();
    await vi.advanceTimersByTimeAsync(5000);

    expect(connector.getSearchStatus().newLights).toEqual([{ id: "9", name: "Study" }]);
  });

  it("finishes the search and refreshes devices once the bridge stops scanning", async () => {
    // lastscan carries a timestamp rather than "active" — the scan is over.
    script.polls = [{ lastscan: "2026-09-21T10:00:00", "7": { name: "Hallway" } }];
    await connector.searchForNewLights();
    await vi.advanceTimersByTimeAsync(5000);

    const state = connector.getSearchStatus();
    expect(state.active).toBe(false);
    expect(state.newLights).toEqual([{ id: "7", name: "Hallway" }]);

    // Polling has stopped: further time produces no further requests.
    const settled = mockFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockFetch.mock.calls.length).toBe(settled);
  });

  it("ends the search when a poll fails outright", async () => {
    // A poll that answers with an HTTP error carries no scan status, so the loop
    // cannot tell whether the scan is still running and settles instead.
    script.polls = [503];
    await connector.searchForNewLights();
    await vi.advanceTimersByTimeAsync(5000);
    expect(connector.getSearchStatus().active).toBe(false);
  });

  it("tolerates a poll that throws while the budget remains", async () => {
    script.polls = [new Error("bridge unreachable"), { lastscan: "active" }];
    await connector.searchForNewLights();

    await vi.advanceTimersByTimeAsync(5000);
    // Inside the budget, a thrown poll leaves the search running.
    expect(connector.getSearchStatus().active).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(connector.getSearchStatus().active).toBe(true);
  });

  it("stops after the time limit even while the bridge still claims to be scanning", async () => {
    // The default poll answer is a still-active scan, so this only ends because
    // the 40s budget runs out.
    await connector.searchForNewLights();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(connector.getSearchStatus().active).toBe(false);
  });

  it("gives up when polls keep throwing past the time limit", async () => {
    script.polls = Array.from({ length: 10 }, () => new Error("bridge unreachable"));
    await connector.searchForNewLights();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(connector.getSearchStatus().active).toBe(false);
  });

  it("still ends the search when the post-scan device refresh fails", async () => {
    script.polls = [{ lastscan: "2026-09-21T10:00:00" }];
    script.refreshFails = true;
    await connector.searchForNewLights();
    await vi.advanceTimersByTimeAsync(5000);

    expect(connector.getSearchStatus().active).toBe(false);
  });

  it("abandons a running search when the connector disconnects", async () => {
    await connector.searchForNewLights();
    await connector.disconnect();

    const settled = mockFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockFetch.mock.calls.length).toBe(settled);
  });
});

describe("HueConnector — action parameter defaults", () => {
  let connector: HueConnector;

  beforeEach(async () => {
    routeFetch();
    connector = new HueConnector({ bridgeIp: "192.168.1.100", apiKey: "test-api-key" }, { localFetch: mockFetch });
    await connector.connect();
    await connector.discoverDevices();
    mockFetch.mockClear();
  });

  /** Body of the PUT the connector issued for the action under test. */
  function putBody(): Record<string, unknown> {
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(put, "no PUT was issued").toBeDefined();
    return JSON.parse(put![1].body);
  }

  it("treats a color action with no hue or saturation as the zero colour", async () => {
    await connector.execute({ type: "color", deviceId: COLOR_ID, params: {} });
    expect(putBody()).toEqual({ hue: 0, sat: 0 });
  });

  it("defaults a colour-temperature action to the coolest value the light accepts", async () => {
    await connector.execute({ type: "color-temp", deviceId: COLOR_ID, params: {} });
    // No ct given and no ctMin discovered for this light, so the Hue-wide minimum
    // stands in rather than 0, which the bridge would reject.
    expect(putBody()).toEqual({ ct: 153 });
  });

  it("clamps a colour temperature above the supported range", async () => {
    await connector.execute({ type: "color-temp", deviceId: COLOR_ID, params: { ct: 99_999 } });
    expect(putBody()).toEqual({ ct: 500 });
  });

  it("refuses a rename with no name rather than clearing the light's name", async () => {
    await expect(
      connector.execute({ type: "rename", deviceId: COLOR_ID, params: {} }),
    ).rejects.toThrow("non-empty 'name'");
  });

  it("refuses a rename whose name is only whitespace", async () => {
    await expect(
      connector.execute({ type: "rename", deviceId: COLOR_ID, params: { name: "   " } }),
    ).rejects.toThrow("non-empty 'name'");
  });

  it("names the light's type when refusing an unsupported colour action", async () => {
    await expect(
      connector.execute({ type: "color", deviceId: PLUG_ID, params: { hue: 100 } }),
    ).rejects.toThrow(/does not support color/);
  });
});

describe("HueConnector — configuration updates", () => {
  let connector: HueConnector;

  beforeEach(() => {
    routeFetch();
    connector = new HueConnector({ bridgeIp: "192.168.1.100", apiKey: "test-api-key" }, { localFetch: mockFetch });
  });

  it("rotates the API key without being told the bridge address again", async () => {
    connector.onConfigUpdate({ apiKey: "rotated-key" });
    await connector.discoverDevices();
    expect(String(mockFetch.mock.calls.at(-1)?.[0])).toContain("/rotated-key/");
  });

  it("moves to a new bridge address without being told the key again", async () => {
    connector.onConfigUpdate({ bridgeIp: "192.168.1.200" });
    await connector.discoverDevices();
    const url = String(mockFetch.mock.calls.at(-1)?.[0]);
    expect(url).toContain("192.168.1.200");
    expect(url).toContain("test-api-key");
  });
});
