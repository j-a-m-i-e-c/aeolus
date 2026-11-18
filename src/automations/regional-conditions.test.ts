// src/automations/regional-conditions.test.ts
//
// Regression guard for the Regional Conditions showcase, run against REAL responses.
//
// The first version of this tab was written against the shapes its author expected, and
// two of its three sources were wrong in ways no synthetic fixture would have shown:
//   - the river layer queried an ArcGIS archive whose newest reading was from 2022, and
//   - the RFS parser read `council-area`, `status`, `type` and `alert_level` properties
//     that the feed does not have. They are lines inside `description`.
// So every fixture in __fixtures__/regional-conditions is a verbatim live response,
// trimmed only to whole records (see captured.json). Where a case needs a condition the
// capture did not contain, the test derives it from a real record and says so.
//
// The project is bundled with the PRODUCTION compiler and evaluated with stubbed sandbox
// globals, as bunker-perimeter-projection.test.ts does, so this exercises the code a
// deployment runs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProject } from "../../demo/seed/project-loader.mjs";
import { compileAutomationProject } from "./automation-project.js";

const FIXTURES = join(__dirname, "__fixtures__", "regional-conditions");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const CAPTURED = JSON.parse(fixture("captured.json")) as { hydstraCapturedAt: number };

let bundle: Promise<string> | undefined;
const compiledLogic = () =>
  (bundle ??= compileAutomationProject(loadProject("regional-conditions")).then((c) => c.compiledJs));

type Responder = (url: string, headers: Record<string, string>) => { status: number; body: string };

/** The four live sources, answered from the saved responses. */
function liveFeeds(overrides: Partial<Record<"level" | "rain" | "incidents" | "fdr", Responder>> = {}): Responder {
  return (url, headers) => {
    if (url.includes("realtimedata.waternsw.com.au")) {
      const query = JSON.parse(decodeURIComponent(url.split("?")[1]!.split("&ver=")[0]!));
      const kind = query.params.varfrom === "100" ? "level" : "rain";
      return overrides[kind]?.(url, headers)
        ?? { status: 200, body: fixture(kind === "level" ? "hydstra-level.json" : "hydstra-rain.json") };
    }
    if (url.endsWith("/feeds/majorIncidents.json")) return overrides.incidents?.(url, headers) ?? { status: 200, body: fixture("rfs-incidents.json") };
    if (url.endsWith("/feeds/fdrToban.xml")) return overrides.fdr?.(url, headers) ?? { status: 200, body: fixture("rfs-fdr.xml") };
    return { status: 0, body: "unexpected URL in test: " + url };
  };
}

function makeWorld(respond: Responder) {
  const store = new Map<string, unknown>();
  const requests: { url: string; headers: Record<string, string>; timeoutMs?: number }[] = [];
  const warnings: string[] = [];
  const world = {
    store,
    requests,
    warnings,
    /** Replaceable between runs, so a test can make a source fail after it has worked. */
    respond,
    radarDevice: null as Record<string, unknown> | null,
    devices: { list: () => world.radarDevice ? [{topic: 'aeolus/local/radar/northern-rivers', state: world.radarDevice}] : [] },
    http: {
      get: async (url: string, options?: { headers?: Record<string, string>; timeoutMs?: number }) => {
        const headers = options?.headers ?? {};
        requests.push({ url, headers, timeoutMs: options?.timeoutMs });
        return world.respond(url, headers);
      },
    },
    // Values cross the isolate boundary as copies in production, so they do here too.
    state: {
      get: (key: string) => structuredClone(store.get(key)),
      set: (key: string, value: unknown) => void store.set(key, structuredClone(value)),
    },
    log: { info: () => {}, warn: (m: string) => void warnings.push(m), error: (m: string) => void warnings.push(m) },
  };
  return world;
}

type World = ReturnType<typeof makeWorld>;

async function run(world: World, topic = "cron", deviceState: Record<string, unknown> = {}) {
  let actions: Array<(ctx: unknown) => unknown> = [];
  const automation = (config: { actions: Array<(ctx: unknown) => unknown> }) => { actions = config.actions; };
  const load = new Function("automation", "http", "state", "log", "devices", `${await compiledLogic()}\nreturn null;`);
  load(automation, world.http, world.state, world.log, world.devices);
  expect(actions).toHaveLength(1);
  await actions[0]({ topic, state: deviceState, deviceId: "test", timestamp: Date.now() });
}

const get = (world: World, key: string) => world.store.get(key) as any;
const history = (world: World, key: string) => Object.assign({}, ...Array.from({length: 8}, (_, i) => get(world, `${key}:${i}`) || {}));
const gauge = (world: World, id: string) => (get(world, "riverGauges") as any[]).find((g) => g.id === id);

describe("Regional Conditions against real feed responses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(CAPTURED.hydstraCapturedAt);
  });
  afterEach(() => vi.useRealTimers());

  it("refreshes all four sources and records each one as current", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);

    for (const source of ["river", "rain", "fireDanger", "incidents"]) {
      expect(get(world, `${source}Updated`), source).toBe(CAPTURED.hydstraCapturedAt);
      expect(get(world, `${source}Error`), source).toBe("");
    }
    expect(world.warnings).toEqual([]);
  });

  it("asks WaterNSW the way the service requires", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const hydstra = world.requests.filter((r) => r.url.includes("waternsw"));
    expect(hydstra).toHaveLength(2);
    // WaterNSW regularly takes longer than the 10 s default; the RFS feeds do not.
    for (const request of hydstra) expect(request.timeoutMs).toBe(22000);
    for (const request of world.requests.filter((r) => r.url.includes("rfs.nsw"))) expect(request.timeoutMs).toBeUndefined();
    for (const request of hydstra) {
      // `.pl` answers 301 and automations do not follow redirects.
      expect(request.url).toMatch(/^https:\/\/realtimedata\.waternsw\.com\.au\/cgi\/webservice\.exe\?/);
      // Without a User-Agent the service answers 502.
      expect(request.headers["User-Agent"]).toBeTruthy();
    }
    const rain = hydstra.map((r) => JSON.parse(decodeURIComponent(r.url.split("?")[1]!.split("&ver=")[0]!)))
      .find((q) => q.params.varfrom === "10")!;
    // Hourly totals are bucketed from the start time, so it must sit on the hour.
    expect(rain.params.start_time).toMatch(/0000$/);
    expect(rain.params.data_type).toBe("tot");
  });

  it("reads fire danger for the Far North Coast district", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const danger = get(world, "fireDanger");
    expect(danger.district).toBe("Far North Coast");
    // Values exactly as the RFS published them when captured.
    expect(danger).toMatchObject({ today: "MODERATE", tomorrow: "NONE", fireBanToday: false, fireBanTomorrow: false });
  });

  it("projects river heights from AEST timestamps with their quality", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const raw = JSON.parse(fixture("hydstra-level.json")).return.traces;
    const casinoRaw = raw.find((t: any) => t.site === "203004");
    const latest = casinoRaw.trace.filter((p: any) => p.q !== 255).at(-1);

    const casino = gauge(world, "203004");
    expect(casino.name).toBe("Richmond River at Casino");
    expect(casino.level).toBeCloseTo(Number(latest.v), 3);
    // Hydstra times are AEST (UTC+10) with no daylight saving.
    const t = String(latest.t);
    expect(casino.observedAt).toBe(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10) - 10, +t.slice(10, 12), +t.slice(12, 14)));
    // Real readings appear one to two hours behind, never in the future.
    expect(casino.observedAt).toBeLessThanOrEqual(CAPTURED.hydstraCapturedAt);
  });

  it("keeps a flagged reading on the map and marks it suspect, with no trend", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const raw = JSON.parse(fixture("hydstra-level.json")).return.traces;
    const flagged = raw.find((t: any) => [55, 59].includes(t.trace.filter((p: any) => p.q !== 255).at(-1)?.q));
    const g = gauge(world, flagged.site);
    expect(g.level).not.toBeNull();
    expect(g.quality).toBe("suspect");
    expect(g.qualityNote).toBe(flagged.quality_codes[String(flagged.trace.at(-1).q)]);
    expect(g.change1h).toBeNull();
  });

  it("reports not-yet-quality-coded readings as unchecked rather than good", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    expect(gauge(world, "203470").quality).toBe("unchecked");
    expect(gauge(world, "201001").quality).toBe("checked");
  });

  it("gives a gauge with no reading neither a height nor a trend", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    // Every other known gauge was absent from the trimmed capture.
    const missing = (get(world, "riverGauges") as any[]).filter((g) => !["201001", "203002", "203470", "203004"].includes(g.id));
    expect(missing.length).toBeGreaterThan(0);
    for (const g of missing) expect(g).toMatchObject({ level: null, observedAt: null, change1h: null });
  });

  it("retains river history across runs at most every 30 minutes, without duplicates", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const first = history(world, "riverHistory")["203004"] as { t: number }[];
    expect(first.length).toBeGreaterThan(1);
    for (let i = 1; i < first.length; i++) expect(Math.floor(first[i]!.t / (30 * 60 * 1000))).toBeGreaterThan(Math.floor(first[i - 1]!.t / (30 * 60 * 1000)));

    // Ten minutes later the same readings come back: nothing is added twice.
    vi.setSystemTime(CAPTURED.hydstraCapturedAt + 10 * 60 * 1000);
    await run(world);
    expect(history(world, "riverHistory")["203004"]).toEqual(first);
  });

  it("projects rainfall from complete hours only, observed at the end of the hour", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const raw = JSON.parse(fixture("hydstra-rain.json")).return.traces as any[];
    const withHours = raw.find((t) => t.trace?.some((p: any) => p.q === 130));
    const complete = withHours.trace.filter((p: any) => p.q !== 255);
    const station = (get(world, "rainGauges") as any[]).find((s) => s.id === withHours.site);

    expect(station.lastHourMm).toBeCloseTo(Number(complete.at(-1).v), 2);
    expect(station.hoursCovered).toBe(complete.length);
    expect(station.total24h).toBeCloseTo(complete.reduce((s: number, p: any) => s + Number(p.v), 0), 1);
    // The hour stamped 15:00 covers 15:00 to 16:00, so it is observed at 16:00.
    const t = String(complete.at(-1).t);
    expect(station.observedAt).toBe(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10) - 10 + 1, 0, 0));
  });

  it("parses incident details out of the RFS description, not missing properties", async () => {
    // The capture held no Northern Rivers incident. This derives one from a real feature:
    // the same record, with its point and council moved into the district.
    const feed = JSON.parse(fixture("rfs-incidents.json"));
    const real = feed.features.find((f: any) => f.geometry.type === "Point");
    const moved = structuredClone(real);
    moved.geometry.coordinates = [153.28, -28.81];
    moved.properties.description = real.properties.description.replace(/COUNCIL AREA: [^<]+/, "COUNCIL AREA: Lismore ");
    feed.features.push(moved);

    const world = makeWorld(liveFeeds({ incidents: () => ({ status: 200, body: JSON.stringify(feed) }) }));
    await run(world);
    const incidents = get(world, "incidents") as any[];

    // The real features are all outside the region and are not listed.
    expect(incidents).toHaveLength(1);
    const [incident] = incidents;
    const field = (name: string) => new RegExp(`${name}: ([^<]+)`).exec(real.properties.description)?.[1]?.trim();
    expect(incident).toMatchObject({
      title: real.properties.title,
      alert: field("ALERT LEVEL"),
      status: field("STATUS"),
      type: field("TYPE"),
      council: "Lismore",
      lon: 153.28,
      lat: -28.81,
    });
  });

  it("lists a district incident without a usable point instead of pinning it somewhere", async () => {
    const feed = JSON.parse(fixture("rfs-incidents.json"));
    const real = feed.features.find((f: any) => f.geometry.type === "GeometryCollection");
    const unplaced = structuredClone(real);
    unplaced.geometry = { type: "GeometryCollection", geometries: [] };
    unplaced.properties.description = real.properties.description.replace(/COUNCIL AREA: [^<]+/, "COUNCIL AREA: Clarence Valley ");
    feed.features.push(unplaced);

    const world = makeWorld(liveFeeds({ incidents: () => ({ status: 200, body: JSON.stringify(feed) }) }));
    await run(world);
    expect(get(world, "incidents")).toEqual([expect.objectContaining({ council: "Clarence Valley", lon: null, lat: null })]);
  });

  it("isolates a failing source: the others refresh and its last data is kept", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const goodGauges = get(world, "riverGauges");

    // Past the five-minute refresh floor, WaterNSW times out for levels and is busy for
    // rain, both exactly as http.get reports them.
    vi.setSystemTime(CAPTURED.hydstraCapturedAt + 11 * 60 * 1000);
    world.respond = liveFeeds({
      level: () => ({ status: 0, body: "Outbound request timed out after 22000 ms" }),
      rain: () => ({ status: 408, body: '{"error_num":218,"error_msg":"Request timeout"}' }),
    });
    await run(world);

    // The reason http.get reports for an outbound timeout, reworded for the pane.
    expect(get(world, "riverError")).toBe("No answer within 22 s");
    expect(get(world, "rainError")).toBe("Source did not answer in time (HTTP 408)");
    expect(get(world, "riverGauges")).toEqual(goodGauges);
    expect(get(world, "riverUpdated")).toBe(CAPTURED.hydstraCapturedAt);
    expect(get(world, "incidentsUpdated")).toBe(CAPTURED.hydstraCapturedAt + 11 * 60 * 1000);
    expect(get(world, "fireDangerError")).toBe("");
  });

  it("retries a fast 408 from WaterNSW once, with a shorter limit that fits the run", async () => {
    let levelCalls = 0;
    const world = makeWorld(liveFeeds({
      level: () => (++levelCalls === 1
        ? { status: 408, body: '{"error_num":218}' }
        : { status: 200, body: fixture("hydstra-level.json") }),
    }));
    await run(world);
    expect(levelCalls).toBe(2);
    expect(get(world, "riverError")).toBe("");
    const levelRequests = world.requests.filter((r) => r.url.includes("waternsw") && r.url.includes("%22varfrom%22%3A%22100%22"));
    expect(levelRequests.map((r) => r.timeoutMs)).toEqual([22000, 20000]);
  });

  it("reports an error page or a changed schema as a source error, never as data", async () => {
    const world = makeWorld(liveFeeds({
      level: () => ({ status: 200, body: "<html>Service maintenance</html>" }),
      rain: () => ({ status: 200, body: '{"error_num":124,"error_msg":"Filter-condition seen in context"}' }),
      fdr: () => ({ status: 503, body: "" }),
    }));
    await run(world);
    expect(get(world, "riverError")).toBe("WaterNSW sent something other than JSON");
    expect(get(world, "rainError")).toMatch(/^WaterNSW error 124: Filter-condition/);
    expect(get(world, "fireDangerError")).toBe("Source answered HTTP 503");
    expect(world.store.has("riverGauges")).toBe(false);
    expect(world.store.has("fireDanger")).toBe(false);
  });

  it("does not refetch within five minutes, whether asked by cron or the Refresh button", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const before = world.requests.length;
    vi.setSystemTime(CAPTURED.hydstraCapturedAt + 4 * 60 * 1000);
    await run(world, "ui/rule/refresh");
    expect(world.requests.length).toBe(before);
  });
  it("migrates a full 24-hour history into bounded state shards without dropping observations", async () => {
    const world = makeWorld(liveFeeds());
    const now = CAPTURED.hydstraCapturedAt;
    const old: Record<string, Array<{t: number; v: number; suspect: boolean}>> = {};
    // Deliberately larger than 64 KiB as one JSON value.
    for (let station = 0; station < 52; station++) {
      const id = String(203000 + station);
      old[id] = Array.from({length: 48}, (_, i) => ({t: now - (48 - i) * 30 * 60000, v: station / 10, suspect: false}));
    }
    expect(JSON.stringify(old).length).toBeGreaterThan(64 * 1024);
    world.store.set('riverHistory', old); // Upgrade from unsharded Build 68 state.
    await run(world);
    expect(world.store.get('riverHistory')).toBeNull();
    for (let i = 0; i < 8; i++) {
      const part = get(world, `riverHistory:${i}`);
      expect(JSON.stringify(part).length).toBeLessThan(64 * 1024);
    }
    expect(history(world, 'riverHistory')['203010']).toHaveLength(48);
  });

  it("ingests four validated RainViewer frames from the MQTT snapshot", async () => {
    const world = makeWorld(liveFeeds());
    const frame = { capturedAt: CAPTURED.hydstraCapturedAt, size: 80,
      palette: ['0b60ff'], grid: Buffer.alloc(6400, 1).toString('base64'),
      bounds: [152, -30.2, 154.2, -27.7] };
    const bundle = { product: 'RAINVIEWER', frames: Array.from({ length: 4 }, (_, i) =>
      ({ ...frame, capturedAt: frame.capturedAt - (3 - i) * 10 * 60000 })) };
    world.radarDevice = bundle;
    await run(world);
    expect(world.requests).toHaveLength(4);
    expect(get(world, 'radarFrames')).toHaveLength(4);
    expect(get(world, 'radarFrames')[3].capturedAt).toBe(frame.capturedAt);
    const receivedAt = get(world, 'radarReceivedAt');

    // Identical retained MQTT snapshot must not rewrite Automation State.
    vi.setSystemTime(CAPTURED.hydstraCapturedAt + 2 * 60000);
    await run(world);
    expect(world.requests).toHaveLength(4);
    expect(get(world, 'radarReceivedAt')).toBe(receivedAt);

    // One invalid frame must not replace the previous known-good animation.
    world.radarDevice = { ...bundle, frames: [...bundle.frames.slice(0, 3),
      { ...frame, grid: 'invalid' }] };
    await run(world);
    expect(get(world, 'radarFrames')).toHaveLength(4);
    expect(get(world, 'radarReceivedAt')).toBe(receivedAt);

    world.radarDevice = { ...bundle, frames: [{ ...frame, bounds: [0, 0, 1, 1] }] };
    await run(world);
    expect(get(world, 'radarReceivedAt')).toBe(receivedAt);
    world.radarDevice = { ...bundle, frames: [...bundle.frames, frame] };
    await run(world);
    expect(get(world, 'radarReceivedAt')).toBe(receivedAt);
  });

  it("replaces a previously reported hourly rainfall value and its quality flag", async () => {
    const world = makeWorld(liveFeeds());
    await run(world);
    const rain = structuredClone(JSON.parse(fixture('hydstra-rain.json')));
    const trace = rain.return.traces.find((t: any) => t.trace?.some((p: any) => p.q !== 255));
    const sample = trace.trace.find((p: any) => p.q !== 255);
    const original = history(world, 'rainHistory')[trace.site].find((h: any) => h.t === Date.UTC(
      +String(sample.t).slice(0,4), +String(sample.t).slice(4,6)-1, +String(sample.t).slice(6,8),
      +String(sample.t).slice(8,10)-10, 0, 0));
    expect(original).toBeDefined();
    sample.v = String(Number(sample.v) + 2);
    sample.q = 59;
    vi.setSystemTime(CAPTURED.hydstraCapturedAt + 11 * 60000);
    world.respond = liveFeeds({rain: () => ({status: 200, body: JSON.stringify(rain)})});
    await run(world);
    const revised = history(world, 'rainHistory')[trace.site].find((h: any) => h.t === original.t);
    expect(revised.mm).toBeCloseTo(Number(sample.v));
    expect(revised.suspect).toBe(true);
  });
});
