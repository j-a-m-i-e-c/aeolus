// Phase 0 proof for Project APIs (ADR-0027): a response-bearing handler runs in a
// real isolated-vm isolate with nothing but a read-only view of one automation's
// state, and the host can always end it.
//
// These tests need a real isolate. A skip is NOT a pass for the security claims
// here; CI runs them on Linux where isolated-vm is built.

import { describe, expect, it } from "vitest";
import express from "express";
import { compileAutomationProject, type AutomationProjectFile } from "../automations/automation-project.js";
import { compileProjectApi } from "../project-api/api-compiler.js";
import { matchApiRoute, responseValidator } from "../project-api/manifest.js";
import { DEFAULT_API_LIMITS, invokeApiHandler, type ApiLimits, type ApiStateReader } from "../project-api/api-sandbox.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

const route = (id: string, path: string, handler: string, response: Record<string, unknown> = { type: ["object", "array", "string", "number", "boolean", "null"] }) =>
  ({ id, method: "GET", path, handler, response });

function files(handlers: string, routes = [route("r", "/r", "handle")], extra: Record<string, string> = {}): AutomationProjectFile[] {
  return Object.entries({
    "logic/index.ts": `export default function run() {}`,
    "api/routes.json": JSON.stringify({ version: 1, routes }),
    "api/handlers.ts": handlers,
    ...extra,
  }).map(([path, content]) => ({ path, content }));
}

async function bundleOf(handlers: string, routes?: ReturnType<typeof route>[]): Promise<string> {
  const api = await compileProjectApi(files(handlers, routes));
  return api!.bundle;
}

function reader(values: Record<string, unknown> = {}, calls: string[] = []): ApiStateReader {
  return {
    get: (key) => { calls.push(key); return values[key]; },
    getAll: () => ({ ...values }),
  };
}

const request = { routeId: "r", params: {} };
const limits = (overrides: Partial<ApiLimits>): ApiLimits => ({ ...DEFAULT_API_LIMITS, ...overrides });
const run = async (handlers: string, state = reader(), overrides: Partial<ApiLimits> = {}) =>
  invokeApiHandler(await bundleOf(handlers), "handle", request, state, limits(overrides));

describe("Project API sandbox (real isolated-vm)", () => {
  realIt("returns a handler's JSON value as a 200", async () => {
    const result = await run(`export function handle() { return { status: "ok", values: [1, 2, 3] }; }`);
    expect(result).toMatchObject({ ok: true, status: 200, body: { status: "ok", values: [1, 2, 3] } });
  });

  realIt("awaits an async handler and passes it the matched request", async () => {
    const bundle = await bundleOf(
      `export async function handle(req: { routeId: string; params: { id: string } }) {\n  await Promise.resolve();\n  return { route: req.routeId, id: req.params.id };\n}`,
    );
    const result = await invokeApiHandler(bundle, "handle", { routeId: "tank", params: { id: "main" } }, reader());
    expect(result).toMatchObject({ ok: true, body: { route: "tank", id: "main" } });
  });

  realIt("reads the automation state the host binds, and nothing else", async () => {
    const calls: string[] = [];
    const result = await run(
      `export function handle() { return { level: state.get("level"), all: Object.keys(state.getAll()) }; }`,
      reader({ level: 42, pump: true }, calls),
    );
    expect(result).toMatchObject({ ok: true, body: { level: 42, all: ["level", "pump"] } });
    expect(calls).toEqual(["level"]);
  });

  realIt("lets a handler choose 404 or 400, and nothing else", async () => {
    expect(await run(`export function handle() { return api.response(404, { error: "Tank not found" }); }`))
      .toMatchObject({ ok: true, status: 404, body: { error: "Tank not found" } });
    expect(await run(`export function handle() { return api.response(400, { error: "Bad id" }); }`))
      .toMatchObject({ ok: true, status: 400 });
    for (const status of [201, 301, 401, 403, 500]) {
      const result = await run(`export function handle() { return api.response(${status}, {}); }`);
      expect(result).toMatchObject({ ok: false, reason: "runtime" });
    }
  });

  realIt("does not treat a plain object with a status field as a response", async () => {
    const result = await run(`export function handle() { return { status: 500, body: "x" }; }`);
    expect(result).toMatchObject({ ok: true, status: 200, body: { status: 500, body: "x" } });
  });

  realIt("exposes no automation, device, network, storage or host capability", async () => {
    const names = ["devices", "mqtt", "http", "events", "shared", "db", "log", "context", "automation",
      "require", "process", "fs", "child_process", "eval", "Function", "global",
      "__stateGetRef", "__stateGetAllRef", "__stateSetRef", "__deviceActionRef", "__mqttPublishRef", "__httpRequestRef"];
    const result = await run(`export function handle() {\n  const g = globalThis as Record<string, unknown>;\n  return ${JSON.stringify(names)}.filter((name) => typeof g[name] !== "undefined");\n}`);
    expect(result).toMatchObject({ ok: true, body: [] });
  });

  realIt("offers state reads only: there is no set or delete, and the view is frozen", async () => {
    const result = await run(`export function handle() {\n  const s = state as unknown as Record<string, unknown>;\n  return { set: typeof s.set, delete: typeof s.delete, frozen: Object.isFrozen(state), apiFrozen: Object.isFrozen(api) };\n}`);
    expect(result).toMatchObject({ ok: true, body: { set: "undefined", delete: "undefined", frozen: true, apiFrozen: true } });
  });

  realIt("cannot replace the state view or the invoker from author code", async () => {
    const result = await run(`
      (globalThis as Record<string, unknown>).state = { get: () => "forged" };
      export function handle() { return state.get("level"); }`, reader({ level: 7 }));
    // The bundle is strict, so assigning a non-writable global throws as it loads.
    expect(result).toMatchObject({ ok: false, reason: "runtime" });
    expect((result as { detail: string }).detail).toMatch(/read.only|Cannot assign/i);

    const overwrite = await run(`
      try { Object.defineProperty(globalThis, "__aeolusInvoke", { value: () => "{}" }); } catch {}
      export function handle() { return "still mine"; }`);
    expect(overwrite).toMatchObject({ ok: true, body: "still mine" });
  });

  realIt("copies state into the isolate, so a handler cannot change the host's value", async () => {
    const stored = { tank: { level: 10 } };
    const result = await run(`export function handle() {\n  const value = state.get("tank") as { level: number };\n  value.level = 99;\n  return value;\n}`, reader(stored));
    expect(result).toMatchObject({ ok: true, body: { level: 99 } });
    expect(stored.tank.level).toBe(10);
  });

  realIt("freezes the request it hands the handler", async () => {
    const result = await run(`export function handle(req: { params: Record<string, string> }) {\n  try { req.params.id = "admin"; return "mutated"; } catch { return Object.isFrozen(req.params); }\n}`);
    expect(result).toMatchObject({ ok: true, body: true });
  });

  realIt("returns __proto__ keys as plain data and never pollutes the host", async () => {
    const result = await run(`export function handle() { return JSON.parse('{"__proto__":{"isAdmin":true},"ok":1}'); }`);
    expect(result.ok).toBe(true);
    const body = (result as { body: Record<string, unknown> }).body;
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(body, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  realIt("classifies a thrown error, keeping the detail short", async () => {
    const result = await run(`export function handle() { throw new Error("boom " + "x".repeat(1000)); }`);
    expect(result).toMatchObject({ ok: false, reason: "runtime" });
    expect((result as { detail: string }).detail.length).toBeLessThanOrEqual(301);
  });

  realIt("reports a handler the bundle does not export", async () => {
    const bundle = await bundleOf(`export function handle() { return 1; }`);
    expect(await invokeApiHandler(bundle, "other", request, reader())).toMatchObject({ ok: false, reason: "missing-handler" });
    expect(await invokeApiHandler(bundle, "hasOwnProperty", request, reader())).toMatchObject({ ok: false, reason: "missing-handler" });
  });

  realIt("refuses a body that is undefined, unserializable or cyclic", async () => {
    expect(await run(`export function handle() { return undefined; }`)).toMatchObject({ ok: false, reason: "invalid-response" });
    expect(await run(`export function handle() { return { n: 10n }; }`)).toMatchObject({ ok: false, reason: "runtime" });
    expect(await run(`export function handle() { const a: Record<string, unknown> = {}; a.self = a; return a; }`)).toMatchObject({ ok: false, reason: "runtime" });
  });

  realIt("refuses an error response with no body", async () => {
    expect(await run(`export function handle() { return api.response(404, undefined); }`)).toMatchObject({ ok: false, reason: "invalid-response" });
  });

  realIt("refuses a response whose body alone is over the limit", async () => {
    // Just under the envelope check, over the body check: the cap applies to the body.
    const result = await run(`export function handle() { return "x".repeat(64 * 1024); }`);
    expect(result).toMatchObject({ ok: false, reason: "too-large" });
  });

  realIt("refuses a response larger than the limit", async () => {
    const result = await run(`export function handle() { return "x".repeat(70 * 1024); }`);
    expect(result).toMatchObject({ ok: false, reason: "too-large" });
  });

  realIt("fails a state read the host refuses, without crashing the host", async () => {
    const failing: ApiStateReader = { get: () => { throw new Error("database is locked"); }, getAll: () => ({}) };
    expect(await run(`export function handle() { return state.get("x"); }`, failing)).toMatchObject({ ok: false, reason: "runtime" });
  });

  describe("termination", () => {
    const deadlineMs = 400;

    realIt("ends a synchronous loop in the bundle's top-level code", async () => {
      const result = await run(`while (true) {}\nexport function handle() { return 1; }`, reader(), { deadlineMs });
      expect(result).toMatchObject({ ok: false, reason: "timeout" });
      expect(result.durationMs).toBeLessThan(deadlineMs + 300);
    });

    realIt("ends a synchronous loop in the handler", async () => {
      const result = await run(`export function handle() { while (true) {} }`, reader(), { deadlineMs });
      expect(result).toMatchObject({ ok: false, reason: "timeout" });
    });

    realIt("ends a CPU loop after an await, which isolated-vm's own timeout does not bound", async () => {
      const started = Date.now();
      let ticks = 0;
      const heartbeat = setInterval(() => ticks++, 20);
      const result = await run(`export async function handle() { await Promise.resolve(); while (true) {} }`, reader(), { deadlineMs });
      clearInterval(heartbeat);
      expect(result).toMatchObject({ ok: false, reason: "timeout" });
      expect(Date.now() - started).toBeLessThan(deadlineMs + 300);
      // The host event loop kept running while the isolate spun.
      expect(ticks).toBeGreaterThan(5);
    });

    realIt("ends a promise that never settles", async () => {
      const result = await run(`export function handle() { return new Promise(() => {}); }`, reader(), { deadlineMs });
      expect(result).toMatchObject({ ok: false, reason: "timeout" });
    });

    realIt("ends a handler that exhausts isolate memory", async () => {
      const result = await run(`export function handle() { const a: string[] = []; for (;;) a.push("x".repeat(1024 * 1024)); }`, reader(), { memoryMb: 16, deadlineMs: 5000 });
      expect(result).toMatchObject({ ok: false, reason: "memory" });
    });

    realIt("caps how many isolates run at once, and frees the slot afterwards", async () => {
      const bundle = await bundleOf(`export function handle() { return new Promise(() => {}); }`);
      const slow = invokeApiHandler(bundle, "handle", request, reader(), limits({ maxConcurrent: 1, deadlineMs: 300 }));
      const second = await invokeApiHandler(bundle, "handle", request, reader(), limits({ maxConcurrent: 1, deadlineMs: 300 }));
      expect(second).toMatchObject({ ok: false, reason: "busy" });
      expect(await slow).toMatchObject({ ok: false, reason: "timeout" });
      const quick = await invokeApiHandler(await bundleOf(`export function handle() { return 1; }`), "handle", request, reader(), limits({ maxConcurrent: 1 }));
      expect(quick).toMatchObject({ ok: true, body: 1 });
    });

    realIt("starts every request from a fresh isolate, so nothing leaks between requests", async () => {
      const bundle = await bundleOf(`let count = 0;\nexport function handle() { count += 1; (globalThis as Record<string, unknown>).leak = count; return count; }`);
      const first = await invokeApiHandler(bundle, "handle", request, reader());
      const second = await invokeApiHandler(bundle, "handle", request, reader());
      expect(first).toMatchObject({ ok: true, body: 1 });
      expect(second).toMatchObject({ ok: true, body: 1 });
    });
  });

  realIt("serves a complete local GET end to end, without running the project's Logic", async () => {
    // The whole path a Phase 2 router will take, assembled by hand: compile the
    // project as a save does, match the path, run the handler, validate the body.
    const project = files(
      `import { percent } from "../lib/units";\nexport function getTank(req: { params: { id: string } }) {\n  if (req.params.id !== "main") return api.response(404, { error: "Tank not found" });\n  return { levelPercent: percent(state.get("mainTankLevel")), pumpRunning: state.get("mainPumpRunning") === true };\n}`,
      [route("tank-status", "/tanks/:id", "getTank", {
        type: "object",
        properties: { levelPercent: { type: "number", minimum: 0, maximum: 100 }, pumpRunning: { type: "boolean" } },
        required: ["levelPercent", "pumpRunning"],
        additionalProperties: false,
      })],
      {
        "lib/units.ts": `export const percent = (value: unknown) => Math.round(Number(value));`,
        "logic/index.ts": `import { percent } from "../lib/units";\nexport default function run() { state.set("mainTankLevel", percent(1)); }`,
      },
    );
    await compileAutomationProject({ files: project });
    const api = (await compileProjectApi(project))!;
    expect(api.bundle).not.toContain("state.set");

    const writes: string[] = [];
    const state: ApiStateReader = {
      get: (key) => ({ mainTankLevel: 61.6, mainPumpRunning: true } as Record<string, unknown>)[key],
      getAll: () => { writes.push("getAll"); return {}; },
    };

    const app = express();
    app.get(/^\/api\/exposed\/v1\/demo(\/.*)$/, async (req, res) => {
      const match = matchApiRoute(api.routes, (req.params as Record<string, string>)[0] ?? "");
      if (!match) { res.status(404).json({ error: "Not found" }); return; }
      const result = await invokeApiHandler(api.bundle, match.route.handler, { routeId: match.route.id, params: match.params }, state);
      if (!result.ok) { res.status(result.reason === "timeout" ? 504 : 500).json({ error: "Handler failed" }); return; }
      if (result.status === 200 && !responseValidator(match.route)(result.body)) { res.status(500).json({ error: "Invalid response" }); return; }
      res.status(result.status).json(result.body);
    });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const get = async (path: string) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/exposed/v1/demo${path}`);
        return { status: res.status, body: await res.json() as unknown };
      };
      expect(await get("/tanks/main")).toEqual({ status: 200, body: { levelPercent: 62, pumpRunning: true } });
      expect(await get("/tanks/spare")).toEqual({ status: 404, body: { error: "Tank not found" } });
      expect(await get("/tanks/a%2Fb")).toEqual({ status: 404, body: { error: "Not found" } });
      expect(await get("/pumps/main")).toEqual({ status: 404, body: { error: "Not found" } });
    } finally {
      server.close();
    }
    expect(writes).toEqual([]);
  });
});
