// Phase 3 proof for Project APIs (ADR-0027): a published GET cannot reach past its
// read-only view of its own automation's state.
//
// One hostile handler tries every escape it can from inside a real isolate and
// reports what it saw. The host side is watched at the same time: spies on the
// classes that change state, publish MQTT or automation events and dispatch device
// commands, on Node's outbound network, process and filesystem entry points, on every
// SQL statement prepared, and a fingerprint of every table. The request goes through
// the same router and the same state reader as src/index.ts. A skip is not a pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import express from "express";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import logger from "../logger.js";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { eventBus } from "../core/event-bus.js";
import { AutomationStateStore } from "../automations/automation-state-store.js";
import { AutomationEngine } from "../automations/automation-engine.js";
import { AutomationEventService } from "../automations/automation-event-service.js";
import { CommandHistoryStore } from "../automations/command-history-store.js";
import { CommandService } from "../automations/command-service.js";
import { ExecutionLog } from "../automations/execution-log.js";
import { Sandbox } from "../automations/sandbox.js";
import { ConnectorRegistry } from "../connectors/connector-registry.js";
import { DeviceRegistry } from "../core/device-registry.js";
import { DataStore } from "../data-store/data-store.js";
import { MqttService } from "../mqtt/mqtt-service.js";
import { SharedStateStore } from "../shared-state/shared-state-store.js";
import { compileProjectApi } from "../project-api/api-compiler.js";
import { createProjectApiStore, type AuditContext } from "../project-api/publication-store.js";
import { createApiAccessStore } from "../project-api/access-store.js";
import { automationStateReader, createExposedApiRouter } from "../project-api/exposed-router.js";
import { createRequestLimiter } from "../project-api/request-limits.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

const ADMIN: AuditContext = { actor: { userId: "u-admin", username: "admin" }, requestId: "req" };

// Names a handler must not find: Automation capabilities, the host references the
// automation sandbox uses, and the Node.js and web globals that reach outside.
const FORBIDDEN = [
  "devices", "mqtt", "http", "events", "shared", "sharedState", "db", "log", "context", "automation", "commands",
  "__stateSetRef", "__stateDeleteRef", "__deviceActionRef", "__mqttPublishRef", "__httpRequestRef", "__emitRef",
  "__sharedSetRef", "__sharedGetRef", "__stateGetRef", "__stateGetAllRef",
  "require", "process", "module", "exports", "Buffer", "global", "__dirname", "__filename",
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "navigator", "importScripts",
  "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "eval", "Function",
];

// esbuild strips the types; the isolate runs plain JavaScript.
const HOSTILE = `
const FORBIDDEN = ${JSON.stringify(FORBIDDEN)};
function attempt(fn) { try { return { ok: true, value: String(fn()) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } }
async function attemptAsync(fn) { try { const v = await fn(); return { ok: true, value: String(v) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } }

export async function probe() {
  const g = globalThis as Record<string, unknown>;
  const F = (function () {}).constructor as (...args: string[]) => () => unknown;
  const report: Record<string, unknown> = {};
  report.globals = FORBIDDEN.filter((name) => typeof g[name] !== "undefined");
  report.viaFunction = attempt(() => F("return [typeof process, typeof require, typeof module, typeof Buffer, typeof fetch, typeof setTimeout].join()")());
  report.viaConstructorChain = attempt(() => (state.get as unknown as { constructor: typeof F }).constructor("return typeof process")());
  report.env = attempt(() => F("return JSON.stringify(process.env)")());
  report.require = attempt(() => F("return require('fs').readFileSync")());
  const fsSpec = ["node", "fs"].join(":");
  report.importFs = await attemptAsync(() => import(fsSpec));
  const urlSpec = "http://127.0.0.1:" + String(9) + "/x.js";
  report.importUrl = await attemptAsync(() => import(urlSpec));

  // State: there is no write, and the read view cannot be replaced or redirected.
  report.stateSet = attempt(() => (state as unknown as { set(k: string, v: unknown): unknown }).set("level", 0));
  report.stateDefine = attempt(() => Object.defineProperty(state, "set", { value: () => true }));
  report.stateAssign = attempt(() => { (state as unknown as Record<string, unknown>).get = () => "forged"; return "assigned"; });
  report.stateOwnNames = Object.getOwnPropertyNames(state).sort();
  const tank = state.get("tank") as { level: number };
  tank.level = -1;
  report.tankAfterMutatingCopy = state.get("tank");
  report.level = state.get("level");

  // Another automation's private state, by every key shape a handler might try.
  report.otherAutomation = ["secret", "../a2/secret", "a2/secret", "a2:secret", "a2.secret", "__proto__", "constructor", "toString"]
    .map((key) => state.get(key) === undefined ? null : key);
  report.ownKeys = Object.keys(state.getAll()).sort();

  // Prototype pollution stays inside this isolate.
  report.pollute = attempt(() => { (Object.prototype as Record<string, unknown>).polluted = "yes"; return "done"; });
  return report;
}
`;

let db: DatabaseType;
let stateStore: AutomationStateStore;
let shared: SharedStateStore;
let tmp: string;
const FILE_CANARY = `file-canary-${Math.random().toString(36).slice(2)}`;
const ENV_CANARY = `env-canary-${Math.random().toString(36).slice(2)}`;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1)").run();
  for (const id of ["a1", "a2"]) {
    db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
      VALUES (?, ?, 't', 'script', 1, 1, 1, 1)`).run(id, id);
  }
  stateStore = new AutomationStateStore(db);
  stateStore.set("a1", "level", 42);
  stateStore.set("a1", "tank", { level: 10 });
  stateStore.set("a2", "secret", "a2-private-value");
  // Loaded from SQLite the way the server does at startup.
  stateStore = new AutomationStateStore(db);
  stateStore.loadFromDb();
  shared = new SharedStateStore(db, eventBus);
  shared.set("site", "mode", "normal");
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-boundary-"));
  fs.writeFileSync(path.join(tmp, "secret.txt"), FILE_CANARY);
  process.env.AEOLUS_BOUNDARY_CANARY = ENV_CANARY;
  vi.spyOn(logger, "info").mockImplementation((() => undefined) as never);
  vi.spyOn(logger, "warn").mockImplementation((() => undefined) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AEOLUS_BOUNDARY_CANARY;
  fs.rmSync(tmp, { recursive: true, force: true });
  db.close();
});

/** Every table's rows, except the one column authentication is allowed to write. */
function fingerprint(): string {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
  return JSON.stringify(tables.map(({ name }) => {
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Array<Record<string, unknown>>;
    if (name === "api_credentials") for (const row of rows) delete row.last_used_at;
    return [name, rows];
  }));
}

/** Spy on every method a class defines, so any call through any instance is recorded. */
function spyOnEveryMethod(label: string, proto: object, calls: string[], except: string[] = []) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (name === "constructor" || except.includes(name) || typeof descriptor?.value !== "function") continue;
    vi.spyOn(proto as Record<string, () => unknown>, name).mockImplementation(() => {
      calls.push(`${label}.${name}`);
      throw new Error(`${label}.${name} must not be called by a Project API request`);
    });
  }
}

describe("a Project API GET cannot reach past its read-only view", () => {
  realIt("whatever the handler tries, nothing changes, nothing is sent and nothing private is read", async () => {
    const api = (await compileProjectApi([
      { path: "api/routes.json", content: JSON.stringify({ version: 1, routes: [{ id: "probe", method: "GET", path: "/probe", handler: "probe", response: { type: "object" } }] }) },
      { path: "api/handlers.ts", content: HOSTILE },
    ]))!;
    const publications = createProjectApiStore(db);
    const access = createApiAccessStore(db);
    publications.setSlug("a1", "probe-api", ADMIN);
    publications.publish("a1", api, 1, api.contentHash, ADMIN);
    const consumer = access.createClient("Consumer", ADMIN);
    const { key } = access.issueKey(consumer.id, null, ADMIN);
    access.grant(consumer.id, "a1", "probe", ADMIN);

    const app = express();
    app.use("/api/exposed", createExposedApiRouter({
      publications,
      access,
      stateFor: automationStateReader(stateStore),
      limiter: createRequestLimiter({ perMinute: 60, concurrentPerClient: 2 }),
      requireHttps: false,
      logger,
    }));
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    // The test's own client, captured before the network is watched.
    const send = http.request.bind(http);
    const before = fingerprint();

    const forbidden: string[] = [];
    spyOnEveryMethod("CommandService", CommandService.prototype, forbidden);
    spyOnEveryMethod("MqttService", MqttService.prototype, forbidden);
    spyOnEveryMethod("AutomationEventService", AutomationEventService.prototype, forbidden);
    spyOnEveryMethod("AutomationEngine", AutomationEngine.prototype, forbidden);
    spyOnEveryMethod("Sandbox", Sandbox.prototype, forbidden);
    spyOnEveryMethod("ExecutionLog", ExecutionLog.prototype, forbidden);
    spyOnEveryMethod("CommandHistoryStore", CommandHistoryStore.prototype, forbidden);
    spyOnEveryMethod("ConnectorRegistry", ConnectorRegistry.prototype, forbidden);
    spyOnEveryMethod("DeviceRegistry", DeviceRegistry.prototype, forbidden);
    spyOnEveryMethod("DataStore", DataStore.prototype, forbidden);
    spyOnEveryMethod("SharedStateStore", SharedStateStore.prototype, forbidden);
    spyOnEveryMethod("AutomationStateStore", AutomationStateStore.prototype, forbidden, ["get", "getAll"]);
    const stateReads: string[] = [];
    const get = vi.spyOn(AutomationStateStore.prototype, "get");
    const getAll = vi.spyOn(AutomationStateStore.prototype, "getAll");
    const emitted: string[] = [];
    const emit = eventBus.emit.bind(eventBus);
    vi.spyOn(eventBus, "emit").mockImplementation((event, ...args) => { emitted.push(String(event)); return emit(event, ...args); });

    const outbound: string[] = [];
    const watch = <T extends object>(label: string, target: T, names: Array<keyof T & string>) => {
      for (const name of names) {
        const original = target[name] as unknown as (...args: unknown[]) => unknown;
        vi.spyOn(target as Record<string, (...args: unknown[]) => unknown>, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
          outbound.push(`${label}.${name} ${JSON.stringify(args[0] ?? null)?.slice(0, 120)}`);
          return original.apply(this, args);
        });
      }
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(() => { outbound.push("fetch"); return Promise.reject(new Error("no fetch")); });
    watch("http", http, ["request", "get"]);
    watch("https", https, ["request", "get"]);
    watch("net", net, ["connect", "createConnection"]);
    watch("tls", tls, ["connect"]);
    watch("dgram", dgram, ["createSocket"]);
    watch("dns", dns, ["lookup", "resolve"]);
    watch("child_process", childProcess, ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]);
    watch("fs", fs, ["readFile", "readFileSync", "writeFile", "writeFileSync", "open", "openSync", "readdir", "readdirSync", "createReadStream", "createWriteStream"]);

    const statements: string[] = [];
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => { statements.push(sql.replace(/\s+/g, " ").trim()); return prepare(sql); });

    let response: { status: number; text: string };
    try {
      response = await new Promise((resolve, reject) => {
        const req = send({ host: "127.0.0.1", port, path: "/api/exposed/v1/probe-api/probe", headers: { Authorization: `Bearer ${key}` } }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => { text += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        });
        req.on("error", reject);
        req.end();
      });
    } finally {
      for (const call of get.mock.calls) stateReads.push(String(call[0]));
      for (const call of getAll.mock.calls) stateReads.push(String(call[0]));
      vi.restoreAllMocks();
      await new Promise((resolve) => server.close(resolve));
    }

    expect(response.status).toBe(200);
    const report = JSON.parse(response.text) as Record<string, unknown>;

    // Inside: no capability, no Node.js, no network, no way to write state.
    expect(report.globals).toEqual([]);
    expect(report.viaFunction).toEqual({ ok: true, value: "undefined,undefined,undefined,undefined,undefined,undefined" });
    expect(report.viaConstructorChain).toEqual({ ok: true, value: "undefined" });
    expect(report.env).toMatchObject({ ok: false });
    expect(report.require).toMatchObject({ ok: false });
    expect(report.importFs).toMatchObject({ ok: false });
    expect(report.importUrl).toMatchObject({ ok: false });
    expect(report.stateSet).toMatchObject({ ok: false });
    expect(report.stateDefine).toMatchObject({ ok: false });
    expect(report.stateOwnNames).toEqual(["get", "getAll"]);
    expect(report.tankAfterMutatingCopy).toEqual({ level: 10 });
    expect(report.level).toBe(42);
    expect(report.otherAutomation).toEqual([null, null, null, null, null, null, null, null]);
    expect(report.ownKeys).toEqual(["level", "tank"]);
    expect(response.text).not.toContain("a2-private-value");
    expect(response.text).not.toContain(ENV_CANARY);
    expect(response.text).not.toContain(FILE_CANARY);

    // Outside: the host did none of it on the handler's behalf.
    expect(forbidden).toEqual([]);
    expect(emitted).toEqual([]);
    expect(stateReads.length).toBeGreaterThan(0);
    expect(new Set(stateReads)).toEqual(new Set(["a1"]));
    // The test's own connection to 127.0.0.1:port is the only network activity.
    expect(outbound.filter((entry) => !entry.includes(String(port)))).toEqual([]);
    expect(outbound.filter((entry) => /^(fs|child_process|dns|dgram|https|tls)\./.test(entry) || entry === "fetch")).toEqual([]);
    // The only SQL write a request makes is authentication's last-used stamp.
    expect(statements.filter((sql) => !/^SELECT\b/i.test(sql))).toEqual(["UPDATE api_credentials SET last_used_at = ? WHERE id = ?"]);
    expect(fingerprint()).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(stateStore.get("a1", "tank")).toEqual({ level: 10 });
    expect(shared.get("site", "mode")).toBe("normal");
  });
});
