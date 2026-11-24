#!/usr/bin/env node
// scripts/bench/project-api-bench.ts — measure Project API latency, CPU and memory (ADR-0027, Phase 3).
//
// Runs the real compiler, publication and access stores, /api/exposed router and API
// sandbox against a migrated SQLite file with persisted automation state. The server
// runs in a forked child process, so its CPU and memory figures exclude this load
// generator. Usage and how to read the results: scripts/bench/README.md.
//
//   node --no-node-snapshot --import tsx scripts/bench/project-api-bench.ts [options]
//
//   --cold-runs 5        fresh server processes, each timed on its first request
//   --requests 300       sequential warm requests per route
//   --seconds 10         duration of each concurrency step
//   --concurrency 1,2,4,8  callers in flight at once, one API client each
//   --max-isolates 4     server-wide isolate cap (DEFAULT_API_LIMITS.maxConcurrent)
//   --phase-iterations 100
//   --soak 10000         requests from 4 callers, with idle memory sampled 5 times (0: skip)
//   --db-dir <dir>       where the SQLite file lives (default: the OS temp dir)
//   --out <file>         also write the results as JSON

import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const SLUG = "bench-tanks";
const TANKS = 24;
const CLIENTS = 8;
const ROUTES = { tank: "/tanks/T07", summary: "/summary" } as const;

interface Options {
  coldRuns: number;
  requests: number;
  seconds: number;
  concurrency: number[];
  maxIsolates: number;
  phaseIterations: number;
  soak: number;
  dbDir: string;
  out: string | null;
}

function parseOptions(argv: string[]): Options {
  const named = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--") || arg === "--serve") continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    named.set(arg.slice(2), value);
    i++;
  }
  const int = (name: string, fallback: number, min: number) => {
    const value = Number(named.get(name) ?? fallback);
    if (!Number.isInteger(value) || value < min) throw new Error(`--${name} must be an integer >= ${min}`);
    return value;
  };
  const concurrency = (named.get("concurrency") ?? "1,2,4,8").split(",").map(Number);
  if (concurrency.some((n) => !Number.isInteger(n) || n < 1 || n > CLIENTS)) throw new Error(`--concurrency values must be 1 to ${CLIENTS}`);
  return {
    coldRuns: int("cold-runs", 5, 1),
    requests: int("requests", 300, 10),
    seconds: int("seconds", 10, 1),
    concurrency,
    maxIsolates: int("max-isolates", 4, 1),
    phaseIterations: int("phase-iterations", 100, 5),
    soak: int("soak", 10_000, 0),
    dbDir: named.get("db-dir") ?? os.tmpdir(),
    out: named.get("out") ?? null,
  };
}

// ── statistics ───────────────────────────────────────────────────────────────

interface Summary { n: number; mean: number; p50: number; p95: number; p99: number; max: number }

function summarize(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  return { n: sorted.length, mean: round(mean), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1) ?? 0) };
}

// ── IPC between the load generator and the server process ────────────────────

interface ServerStats {
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  /** CPU time over wall time, as a percentage of one core. */
  cpuPercentOfOneCore: number;
  rssMb: number;
  peakRssMb: number;
  heapUsedMb: number;
  eventLoopDelayP99Ms: number;
  eventLoopDelayMaxMs: number;
  /** The router's own timing of each request, admission to response written (ms resolution). */
  serverDurations: Summary;
  outcomes: Record<string, number>;
}

interface CompileStats { bytes: number; compile: Summary; compileFromCache: Summary; cacheRejected: number }

interface PhaseStats {
  isolateAndContext: Summary;
  runBundle: Summary;
  fullInvocation: Summary;
  /** The benchmark's own bundle. */
  bundle: CompileStats;
  /** The same bundle with about 40 KB of uncalled library code, as a heavier lib/ would add. */
  largeBundle: CompileStats;
}

interface MemoryStats { rssMb: number; heapUsedMb: number; externalMb: number; gc: boolean }

type ToServer = { type: "reset" } | { type: "stats" } | { type: "phases"; iterations: number } | { type: "memory" } | { type: "exit" };
type FromServer =
  | { type: "ready"; port: number; startupMs: number }
  | { type: "reset" }
  | { type: "stats"; stats: ServerStats }
  | { type: "phases"; phases: PhaseStats }
  | { type: "memory"; memory: MemoryStats };

function reply<T extends FromServer["type"]>(child: ChildProcess, type: T): Promise<Extract<FromServer, { type: T }>> {
  return new Promise((resolve, reject) => {
    const onMessage = (msg: FromServer) => {
      if (msg.type !== type) return;
      child.off("message", onMessage);
      child.off("exit", onExit);
      resolve(msg as Extract<FromServer, { type: T }>);
    };
    const onExit = (code: number | null) => reject(new Error(`server exited (${code}) before replying ${type}`));
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

/** Send a message and wait for the server's reply of the same type. */
function ask<T extends ToServer["type"] & FromServer["type"]>(child: ChildProcess, message: ToServer & { type: T }) {
  const answer = reply(child, message.type);
  child.send(message);
  return answer;
}

// ── the server process ───────────────────────────────────────────────────────

async function ivmModule(): Promise<typeof import("isolated-vm")> {
  const mod = await import("isolated-vm");
  return (mod.default ?? mod) as typeof import("isolated-vm");
}

async function serve(dbFile: string, maxIsolates: number): Promise<void> {
  const started = performance.now();
  const { default: Database } = await import("better-sqlite3");
  const { default: express } = await import("express");
  const { AutomationStateStore } = await import("../../src/automations/automation-state-store.js");
  const { createProjectApiStore } = await import("../../src/project-api/publication-store.js");
  const { createApiAccessStore } = await import("../../src/project-api/access-store.js");
  const { automationStateReader, createExposedApiRouter } = await import("../../src/project-api/exposed-router.js");
  const { createRequestLimiter } = await import("../../src/project-api/request-limits.js");
  const { DEFAULT_API_LIMITS, invokeApiHandler } = await import("../../src/project-api/api-sandbox.js");

  // Opened the way src/db/database.ts opens it, and state loaded as at startup.
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const stateStore = new AutomationStateStore(db);
  stateStore.loadFromDb();
  const publications = createProjectApiStore(db);
  const limits = { ...DEFAULT_API_LIMITS, maxConcurrent: maxIsolates };

  let durations: number[] = [];
  let outcomes: Record<string, number> = {};
  const logger = {
    info(obj: object) {
      const fields = obj as { durationMs?: number; status?: number; reason?: string };
      if (typeof fields.durationMs === "number") durations.push(fields.durationMs);
      const outcome = fields.status !== undefined ? String(fields.status) + (fields.reason ? ` ${fields.reason}` : "") : String(fields.reason);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    },
    warn() { /* failures are counted through info */ },
  };

  const app = express();
  app.use("/api/exposed", createExposedApiRouter({
    publications,
    access: createApiAccessStore(db),
    stateFor: automationStateReader(stateStore),
    // The rate limit is lifted so the benchmark measures the sandbox, not the limiter.
    limiter: createRequestLimiter({ perMinute: 1_000_000, concurrentPerClient: 2 }),
    requireHttps: false,
    sandboxLimits: limits,
    logger,
  }));

  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  let wall = performance.now();
  let cpu = process.cpuUsage();
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
  const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

  const server = app.listen(0, "127.0.0.1", () => {
    process.send?.({ type: "ready", port: (server.address() as { port: number }).port, startupMs: performance.now() - started } satisfies FromServer);
  });

  process.on("message", (message: ToServer) => {
    void (async () => {
      if (message.type === "reset") {
        durations = [];
        outcomes = {};
        eventLoop.reset();
        wall = performance.now();
        cpu = process.cpuUsage();
        peakRss = process.memoryUsage().rss;
        process.send?.({ type: "reset" } satisfies FromServer);
      } else if (message.type === "stats") {
        const used = process.cpuUsage(cpu);
        const wallMs = performance.now() - wall;
        const memory = process.memoryUsage();
        process.send?.({ type: "stats", stats: {
          wallMs: Math.round(wallMs),
          cpuUserMs: Math.round(used.user / 1000),
          cpuSystemMs: Math.round(used.system / 1000),
          cpuPercentOfOneCore: Math.round(((used.user + used.system) / 1000 / wallMs) * 1000) / 10,
          rssMb: mb(memory.rss),
          peakRssMb: mb(Math.max(peakRss, memory.rss)),
          heapUsedMb: mb(memory.heapUsed),
          eventLoopDelayP99Ms: Math.round(eventLoop.percentile(99) / 1e4) / 100,
          eventLoopDelayMaxMs: Math.round(eventLoop.max / 1e4) / 100,
          serverDurations: summarize(durations),
          outcomes,
        } } satisfies FromServer);
      } else if (message.type === "memory") {
        // Idle memory after a collection, so growth that survives load shows as a leak.
        const gc = (globalThis as { gc?: () => void }).gc;
        gc?.();
        await new Promise((resolve) => setTimeout(resolve, 500));
        gc?.();
        const memory = process.memoryUsage();
        process.send?.({ type: "memory", memory: { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), externalMb: mb(memory.external), gc: Boolean(gc) } } satisfies FromServer);
      } else if (message.type === "phases") {
        const resolution = publications.resolve(SLUG);
        if (!resolution.ok) throw new Error(`benchmark API is not servable: ${resolution.reason}`);
        process.send?.({ type: "phases", phases: await phases(resolution.snapshot.bundle, message.iterations, limits, stateStore, invokeApiHandler) } satisfies FromServer);
      } else {
        clearInterval(sampler);
        server.closeAllConnections();
        server.close(() => { db.close(); process.exit(0); });
      }
    })().catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
  });
}

/**
 * What a request's isolate costs, piece by piece, and what V8's code cache would
 * save. This is the evidence for or against per-snapshot script caching: the cache
 * can only remove compile time, never isolate creation or execution.
 */
async function phases(
  bundle: string,
  iterations: number,
  limits: import("../../src/project-api/api-sandbox.js").ApiLimits,
  stateStore: import("../../src/automations/automation-state-store.js").AutomationStateStore,
  invoke: typeof import("../../src/project-api/api-sandbox.js").invokeApiHandler,
): Promise<PhaseStats> {
  const ivm = await ivmModule();
  // compileScript returns these at runtime; the published typings leave them off Script.
  type WithCache = import("isolated-vm").CachedDataResult & { cachedDataRejected?: boolean };

  async function compileCost(source: string): Promise<CompileStats> {
    const producer = new ivm.Isolate({ memoryLimit: limits.memoryMb });
    const cachedData = ((await producer.compileScript(source, { produceCachedData: true })) as unknown as WithCache).cachedData;
    producer.dispose();
    if (!cachedData) throw new Error("V8 produced no code cache for the bundle");
    const plain: number[] = [];
    const cached: number[] = [];
    let rejected = 0;
    for (let i = 0; i < iterations; i++) {
      for (const useCache of [false, true]) {
        const isolate = new ivm.Isolate({ memoryLimit: limits.memoryMb });
        const t = performance.now();
        const script = await isolate.compileScript(source, useCache ? { cachedData } : {});
        (useCache ? cached : plain).push(performance.now() - t);
        if (useCache && (script as unknown as WithCache).cachedDataRejected) rejected++;
        isolate.dispose();
      }
    }
    return { bytes: Buffer.byteLength(source, "utf8"), compile: summarize(plain), compileFromCache: summarize(cached), cacheRejected: rejected };
  }

  const create: number[] = [];
  const run: number[] = [];
  const full: number[] = [];
  const state = { get: (key: string) => stateStore.get("a1", key), getAll: () => stateStore.getAll("a1") };
  for (let i = 0; i < iterations; i++) {
    let t = performance.now();
    const isolate = new ivm.Isolate({ memoryLimit: limits.memoryMb });
    const context = await isolate.createContext();
    create.push(performance.now() - t);
    const script = await isolate.compileScript(bundle);
    t = performance.now();
    await script.run(context);
    run.push(performance.now() - t);
    isolate.dispose();

    t = performance.now();
    const result = await invoke(bundle, "getTank", { routeId: "tank", params: { id: "T07" } }, state, limits);
    full.push(performance.now() - t);
    if (!result.ok) throw new Error(`handler failed during the phase benchmark: ${result.reason}`);
  }
  const padding = Array.from({ length: 400 }, (_, i) =>
    `function pad${i}(a) { return a.map(function (x) { return x * ${i} + Math.sqrt(x); }).filter(Boolean).length; }`).join("\n");
  return {
    isolateAndContext: summarize(create),
    runBundle: summarize(run),
    fullInvocation: summarize(full),
    bundle: await compileCost(bundle),
    largeBundle: await compileCost(`${bundle}\n${padding}`),
  };
}

// ── the load generator ───────────────────────────────────────────────────────

const LIB = `export interface Tank { level: number; capacity: number; pumpRunning: boolean; updatedAt: number }
export const percent = (tank: Tank) => Math.round((tank.level / tank.capacity) * 1000) / 10;
export const isTank = (key: string) => key.startsWith("tank:");
`;
const HANDLERS = `import { isTank, percent, type Tank } from "../lib/tanks";

export function getTank(req: { params: { id: string } }) {
  const tank = state.get("tank:" + req.params.id) as Tank | undefined;
  if (!tank) return api.response(404, { error: "Tank not found" });
  return { id: req.params.id, levelPercent: percent(tank), pumpRunning: tank.pumpRunning, updatedAt: tank.updatedAt };
}

export function getSummary() {
  const all = state.getAll();
  const tanks = Object.keys(all).filter(isTank).map((key) => all[key] as Tank);
  const average = tanks.reduce((sum, tank) => sum + percent(tank), 0) / Math.max(1, tanks.length);
  return { tanks: tanks.length, averagePercent: Math.round(average * 10) / 10, pumpsRunning: tanks.filter((t) => t.pumpRunning).length };
}
`;
const MANIFEST = {
  version: 1,
  routes: [
    {
      id: "tank", method: "GET", path: "/tanks/:id", handler: "getTank",
      response: {
        type: "object",
        properties: { id: { type: "string" }, levelPercent: { type: "number" }, pumpRunning: { type: "boolean" }, updatedAt: { type: "number" } },
        required: ["id", "levelPercent", "pumpRunning", "updatedAt"], additionalProperties: false,
      },
    },
    {
      id: "summary", method: "GET", path: "/summary", handler: "getSummary",
      response: {
        type: "object",
        properties: { tanks: { type: "integer" }, averagePercent: { type: "number" }, pumpsRunning: { type: "integer" } },
        required: ["tanks", "averagePercent", "pumpsRunning"], additionalProperties: false,
      },
    },
  ],
};

/** Build the database once: an automation with persisted state, a published API and granted clients. */
async function seed(dbFile: string): Promise<string[]> {
  const { default: Database } = await import("better-sqlite3");
  const { runMigrations } = await import("../../src/db/migration-runner.js");
  const { migrations } = await import("../../src/db/migrations/index.js");
  const { AutomationStateStore } = await import("../../src/automations/automation-state-store.js");
  const { compileProjectApi } = await import("../../src/project-api/api-compiler.js");
  const { createProjectApiStore } = await import("../../src/project-api/publication-store.js");
  const { createApiAccessStore } = await import("../../src/project-api/access-store.js");
  const ADMIN = { actor: { userId: "u-admin", username: "admin" }, requestId: "bench" };

  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1)").run();
  db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES ('a1', 'Tank farm', 'bench/#', 'script', 1, 1, 1, 1)`).run();

  // What a tank-farm automation's Logic would have written: one key per tank, a
  // site summary and a rolling history, about 9 KB of state in all.
  const stateStore = new AutomationStateStore(db);
  for (let i = 1; i <= TANKS; i++) {
    const id = `T${String(i).padStart(2, "0")}`;
    stateStore.set("a1", `tank:${id}`, { level: 1000 + i * 37, capacity: 5000, pumpRunning: i % 3 === 0, updatedAt: Date.now() });
  }
  stateStore.set("a1", "site", { name: "Bench site", mode: "normal", alarms: [] });
  stateStore.set("a1", "history", Array.from({ length: 1000 }, (_, i) => Math.round(Math.sin(i / 20) * 1000) / 10));

  const api = await compileProjectApi([
    { path: "api/routes.json", content: JSON.stringify(MANIFEST) },
    { path: "api/handlers.ts", content: HANDLERS },
    { path: "lib/tanks.ts", content: LIB },
  ]);
  if (!api) throw new Error("benchmark project declares no API");
  const publications = createProjectApiStore(db);
  publications.setSlug("a1", SLUG, ADMIN);
  publications.publish("a1", api, 1, api.contentHash, ADMIN);

  const access = createApiAccessStore(db);
  const keys: string[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    const client = access.createClient(`Bench client ${i + 1}`, ADMIN);
    keys.push(access.issueKey(client.id, null, ADMIN).key);
    for (const route of MANIFEST.routes) access.grant(client.id, "a1", route.id, ADMIN);
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  return keys;
}

function startServer(dbFile: string, options: Options): Promise<{ child: ChildProcess; port: number; startupMs: number }> {
  const child = fork(SELF, ["--serve", "--db", dbFile, "--max-isolates", String(options.maxIsolates)], {
    execArgv: [...process.execArgv, "--expose-gc"],
    env: { ...process.env, LOG_LEVEL: "warn" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  return reply(child, "ready").then((ready) => ({ child, port: ready.port, startupMs: ready.startupMs }));
}

async function stopServer(child: ChildProcess): Promise<void> {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.send({ type: "exit" } satisfies ToServer);
  await exited;
}

function request(port: number, route: string, key: string, agent: http.Agent | false): Promise<{ status: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.get({ host: "127.0.0.1", port, path: `/api/exposed/v1/${SLUG}${route}`, agent, headers: { Authorization: `Bearer ${key}` } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, ms: performance.now() - started }));
    });
    req.on("error", reject);
  });
}

function hardware(dbFile: string) {
  const read = (file: string) => { try { return fs.readFileSync(file, "utf8").replace(/\0/g, "").trim(); } catch { return null; } };
  const cpuinfo = read("/proc/cpuinfo");
  const cpus = os.cpus();
  let isolatedVm = "unknown";
  try {
    isolatedVm = (JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), "../../node_modules/isolated-vm/package.json"), "utf8")) as { version: string }).version;
  } catch { /* reported as unknown */ }
  return {
    board: read("/proc/device-tree/model") ?? /^Model\s*:\s*(.+)$/m.exec(cpuinfo ?? "")?.[1] ?? null,
    cpuModel: cpus[0]?.model || /^model name\s*:\s*(.+)$/m.exec(cpuinfo ?? "")?.[1] || null,
    cores: cpus.length,
    cpuMHz: cpus[0]?.speed ?? null,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    node: process.version,
    isolatedVm,
    database: dbFile,
  };
}

async function drive(options: Options): Promise<void> {
  fs.mkdirSync(options.dbDir, { recursive: true });
  const dbFile = path.join(options.dbDir, `project-api-bench-${process.pid}.db`);
  const results: Record<string, unknown> = { startedAt: new Date().toISOString(), options, hardware: hardware(dbFile) };
  const print = (label: string, value: unknown) => console.log(`\n## ${label}\n${JSON.stringify(value, null, 2)}`);
  print("Hardware", results.hardware);

  try {
    const keys = await seed(dbFile);
    const key = keys[0]!;

    // Cold: the first request a freshly started server answers, over a new connection.
    // It pays for the first isolate, the first SQLite statements and the first
    // response-schema compile. Repeated across fresh processes for a distribution.
    const cold: number[] = [];
    const coldServer: number[] = [];
    const startup: number[] = [];
    const secondRequest: number[] = [];
    for (let i = 0; i < options.coldRuns; i++) {
      const { child, port, startupMs } = await startServer(dbFile, options);
      startup.push(startupMs);
      const first = await request(port, ROUTES.tank, key, false);
      if (first.status !== 200) throw new Error(`cold request answered ${first.status}`);
      cold.push(first.ms);
      secondRequest.push((await request(port, ROUTES.tank, key, false)).ms);
      coldServer.push((await ask(child, { type: "stats" })).stats.serverDurations.max);
      await stopServer(child);
    }
    results.cold = {
      firstRequestClientMs: summarize(cold),
      firstRequestServerMs: summarize(coldServer),
      secondRequestClientMs: summarize(secondRequest),
      serverStartupMs: summarize(startup),
    };
    print("Cold start (ms)", results.cold);

    const { child, port } = await startServer(dbFile, options);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
    try {
      for (let i = 0; i < 20; i++) await request(port, ROUTES.tank, key, agent);
      const idleBefore = (await ask(child, { type: "memory" })).memory;

      // Warm: one caller, one request at a time, on a kept-alive connection.
      const warm: Record<string, unknown> = {};
      for (const [name, route] of Object.entries(ROUTES)) {
        await ask(child, { type: "reset" });
        const latencies: number[] = [];
        for (let i = 0; i < options.requests; i++) {
          const res = await request(port, route, key, agent);
          if (res.status !== 200) throw new Error(`warm ${name} answered ${res.status}`);
          latencies.push(res.ms);
        }
        warm[name] = { clientMs: summarize(latencies), server: (await ask(child, { type: "stats" })).stats };
      }
      results.warm = warm;
      print("Warm, sequential", warm);

      // Concurrency: N callers, each its own API client so the per-client cap of 2
      // does not apply, each sending its next request as soon as the last returns.
      const concurrency: Record<string, unknown> = {};
      for (const callers of options.concurrency) {
        await ask(child, { type: "reset" });
        const until = performance.now() + options.seconds * 1000;
        const latencies: number[] = [];
        const statuses: Record<string, number> = {};
        await Promise.all(keys.slice(0, callers).map(async (callerKey) => {
          while (performance.now() < until) {
            const res = await request(port, ROUTES.tank, callerKey, agent);
            statuses[res.status] = (statuses[res.status] ?? 0) + 1;
            if (res.status === 200) latencies.push(res.ms);
          }
        }));
        const { stats } = await ask(child, { type: "stats" });
        concurrency[`${callers} caller${callers === 1 ? "" : "s"}`] = {
          answeredPerSecond: Math.round((Object.values(statuses).reduce((a, b) => a + b, 0) / options.seconds) * 10) / 10,
          okPerSecond: Math.round(((statuses["200"] ?? 0) / options.seconds) * 10) / 10,
          statuses,
          okClientMs: summarize(latencies),
          server: stats,
        };
      }
      results.concurrency = concurrency;
      print(`Concurrency, ${options.seconds} s per step, server-wide isolate cap ${options.maxIsolates}`, concurrency);

      results.idleMemory = { beforeLoad: idleBefore, afterLoad: (await ask(child, { type: "memory" })).memory };
      print("Idle server memory after GC (MB)", results.idleMemory);

      results.phases = (await ask(child, { type: "phases", iterations: options.phaseIterations })).phases;
      print(`Isolate phases (ms), ${options.phaseIterations} iterations`, results.phases);

      // Soak: does idle memory keep rising with the number of requests served?
      if (options.soak > 0) {
        const callers = keys.slice(0, Math.min(4, options.maxIsolates));
        const perSample = Math.ceil(options.soak / 5 / callers.length);
        const samples: Array<{ requests: number; rssMb: number; heapUsedMb: number }> = [];
        let served = 0;
        for (let sample = 0; sample < 5; sample++) {
          await Promise.all(callers.map(async (callerKey) => {
            for (let i = 0; i < perSample; i++) { await request(port, ROUTES.tank, callerKey, agent); served++; }
          }));
          const { memory } = await ask(child, { type: "memory" });
          samples.push({ requests: served, rssMb: memory.rssMb, heapUsedMb: memory.heapUsedMb });
        }
        results.soak = samples;
        print(`Soak, ${callers.length} callers, idle memory after GC`, samples);
      }
    } finally {
      agent.destroy();
      await stopServer(child);
    }
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
  }
  if (options.out) {
    fs.writeFileSync(options.out, JSON.stringify(results, null, 2) + "\n");
    console.log(`\nWrote ${options.out}`);
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--serve")) {
  const db = argv[argv.indexOf("--db") + 1];
  if (!db) throw new Error("--serve needs --db");
  await serve(db, parseOptions(argv).maxIsolates);
} else {
  process.env.LOG_LEVEL = "warn";
  await drive(parseOptions(argv));
}
