// src/project-api/api-sandbox.ts — run one Project API handler in isolated-vm (ADR-0027).
//
// Deliberately separate from Sandbox.execute() and the AutomationEngine:
//
//   - no execution_history row, no FIRED/COMPLETED events, no ExecutionGate slot or
//     duplicate suppression: a request is not an automation run;
//   - a fresh isolate per request, given ONLY a read-only view of one automation's
//     state, bound to that automation's id on the host. No devices, mqtt, http,
//     events, shared, db, log, context or automation(). Touching any of them is a
//     ReferenceError inside the isolate;
//   - a host wall-clock deadline that disposes the isolate. isolated-vm's `timeout`
//     only bounds synchronous execution; CPU spent after an `await` runs on the
//     isolate's own thread until the isolate is disposed;
//   - values cross the boundary as JSON strings or ExternalCopy copies, never as
//     callable references.
//
// Phase 0 proof of concept: not yet reachable from any HTTP route.

import { API_HANDLER_TABLE } from "./api-compiler.js";

let ivm: typeof import("isolated-vm") | null = null;
try {
  const mod = await import("isolated-vm");
  ivm = (mod.default ?? mod) as typeof import("isolated-vm");
} catch {
  ivm = null;
}

export interface ApiLimits {
  /** Wall clock for the whole invocation, isolate creation included. */
  deadlineMs: number;
  memoryMb: number;
  /** UTF-8 bytes of the serialized response. */
  maxResponseBytes: number;
  /** Isolates allowed to run at once across all requests. */
  maxConcurrent: number;
}

/**
 * Version of what a handler can rely on: the globals in API_BOOTSTRAP, the request
 * shape, the statuses it may choose and the manifest rules. A published snapshot
 * records the version it was reviewed against, and stops being served when this
 * changes, until an admin reviews it again. Bump it with any change to those.
 */
export const API_RUNTIME_CONTRACT = 1;

export const DEFAULT_API_LIMITS: ApiLimits = {
  deadlineMs: 5000,
  memoryMb: 32,
  maxResponseBytes: 64 * 1024,
  maxConcurrent: 4,
};

/** Status codes a handler may choose. Everything else is the host's to decide. */
export const HANDLER_STATUSES = [200, 400, 404] as const;
export type HandlerStatus = (typeof HANDLER_STATUSES)[number];

export interface ApiRequestData {
  routeId: string;
  params: Record<string, string>;
}

export interface ApiStateReader {
  get(key: string): unknown;
  getAll(): Record<string, unknown>;
}

export type ApiFailureReason =
  | "timeout"
  | "memory"
  | "runtime"
  | "missing-handler"
  | "invalid-response"
  | "too-large"
  | "busy"
  | "unavailable";

export type ApiInvocationResult =
  | { ok: true; status: HandlerStatus; body: unknown; durationMs: number }
  | { ok: false; reason: ApiFailureReason; detail: string; durationMs: number };

// Runs before the author's bundle. It captures the two state references in a
// closure, removes them from the global object, and defines `state`, `api` and the
// invoker as non-writable, non-configurable globals the bundle cannot replace.
const API_BOOTSTRAP = `
(function () {
  "use strict";
  var getRef = globalThis.__stateGetRef;
  var getAllRef = globalThis.__stateGetAllRef;
  delete globalThis.__stateGetRef;
  delete globalThis.__stateGetAllRef;
  var responses = new WeakSet();
  var STATUSES = ${JSON.stringify(HANDLER_STATUSES)};

  function deepFreeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }
  function define(name, value) {
    Object.defineProperty(globalThis, name, { value: value, writable: false, configurable: false, enumerable: false });
  }

  define("state", Object.freeze({
    get: function (key) {
      if (typeof key !== "string") throw new TypeError("state.get(key) needs a string key");
      return getRef.applySync(undefined, [key]);
    },
    getAll: function () { return getAllRef.applySync(undefined, []); }
  }));

  define("api", Object.freeze({
    response: function (status, body) {
      if (STATUSES.indexOf(status) === -1) throw new RangeError("api.response status must be one of " + STATUSES.join(", "));
      var response = Object.freeze({ status: status, body: body });
      responses.add(response);
      return response;
    }
  }));

  define("__aeolusInvoke", async function (name, requestJson) {
    var table = globalThis.${API_HANDLER_TABLE};
    var handler = table && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
    if (typeof handler !== "function") return JSON.stringify({ missing: true });
    var request = deepFreeze(JSON.parse(requestJson));
    var result = await handler(request);
    var envelope = result && typeof result === "object" && responses.has(result)
      ? { status: result.status, body: result.body }
      : { status: 200, body: result };
    return JSON.stringify(envelope);
  });
})();
`;

const FORBIDDEN_GLOBALS = ["require", "process", "fs", "child_process", "eval", "Function", "global"];

let active = 0;

const truncate = (text: string) => (text.length > 300 ? text.slice(0, 300) + "…" : text);

function classify(error: unknown, timedOut: boolean, disposed: boolean): ApiFailureReason {
  if (timedOut) return "timeout";
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) return "timeout";
  if (disposed || /memory|allocation/i.test(message)) return "memory";
  return "runtime";
}

/**
 * Run `handler` from a compiled API bundle against one automation's state.
 * Resolves for every outcome and never rejects.
 */
export async function invokeApiHandler(
  bundle: string,
  handler: string,
  request: ApiRequestData,
  state: ApiStateReader,
  limits: ApiLimits = DEFAULT_API_LIMITS,
): Promise<ApiInvocationResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  if (!ivm) return { ok: false, reason: "unavailable", detail: "isolated-vm is not available", durationMs: 0 };
  if (active >= limits.maxConcurrent) return { ok: false, reason: "busy", detail: "API sandbox is at its concurrency limit", durationMs: 0 };

  active++;
  const runtime = ivm;
  const isolate = new runtime.Isolate({ memoryLimit: limits.memoryMb });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<ApiInvocationResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try { isolate.dispose(); } catch { /* already disposed */ }
      resolve({ ok: false, reason: "timeout", detail: `Handler did not finish within ${limits.deadlineMs} ms`, durationMs: elapsed() });
    }, limits.deadlineMs);
  });

  const work = (async (): Promise<ApiInvocationResult> => {
    const context = await isolate.createContext();
    const jail = context.global;
    for (const name of FORBIDDEN_GLOBALS) await jail.set(name, undefined);
    await jail.set("__stateGetRef", new runtime.Reference((key: string) => {
      const value = state.get(key);
      return value === undefined ? undefined : new runtime.ExternalCopy(value).copyInto();
    }));
    await jail.set("__stateGetAllRef", new runtime.Reference(() => new runtime.ExternalCopy(state.getAll()).copyInto()));

    const remaining = () => Math.max(1, limits.deadlineMs - elapsed());
    await (await isolate.compileScript(API_BOOTSTRAP)).run(context);
    await (await isolate.compileScript(bundle)).run(context, { timeout: remaining() });

    const invoke = await jail.get("__aeolusInvoke", { reference: true });
    const raw: unknown = await invoke.apply(undefined, [handler, JSON.stringify(request)], {
      timeout: remaining(),
      result: { promise: true, copy: true },
    });
    if (typeof raw !== "string") return { ok: false, reason: "invalid-response", detail: "Handler result could not be serialized", durationMs: elapsed() };
    if (Buffer.byteLength(raw, "utf8") > limits.maxResponseBytes + 64) {
      return { ok: false, reason: "too-large", detail: `Response exceeds ${limits.maxResponseBytes} bytes`, durationMs: elapsed() };
    }

    const envelope: unknown = JSON.parse(raw);
    if (envelope && typeof envelope === "object" && "missing" in envelope) {
      return { ok: false, reason: "missing-handler", detail: `No exported handler named ${handler}`, durationMs: elapsed() };
    }
    const { status, body } = envelope as { status: unknown; body?: unknown };
    if (!HANDLER_STATUSES.includes(status as HandlerStatus) || body === undefined) {
      return { ok: false, reason: "invalid-response", detail: "Handler returned no JSON body", durationMs: elapsed() };
    }
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > limits.maxResponseBytes) {
      return { ok: false, reason: "too-large", detail: `Response exceeds ${limits.maxResponseBytes} bytes`, durationMs: elapsed() };
    }
    return { ok: true, status: status as HandlerStatus, body, durationMs: elapsed() };
  })().catch((error: unknown): ApiInvocationResult => ({
    ok: false,
    reason: classify(error, timedOut, isolate.isDisposed),
    detail: truncate(error instanceof Error ? error.message : String(error)),
    durationMs: elapsed(),
  }));

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    try { if (!isolate.isDisposed) isolate.dispose(); } catch { /* already disposed */ }
    active--;
  }
}
