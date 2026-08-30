// src/automations/sandbox.ts — Secure isolated-vm sandbox for user-authored automation scripts

import type { CommandService, ActionDescriptor } from "./command-service.js";
import type { AutomationScopeResolver, AuthorizationScope } from "./automation-scope-resolver.js";
import type { ConfirmationTier } from "./command-lifecycle.js";
import { isConfirmationTier } from "./completion-tier.js";
import type { CommandResultCollector } from "./command-result-collector.js";
import type { AutomationEventService } from "./automation-event-service.js";
import {
  currentExecutionContext,
  runInExecutionContext,
  type ActiveExecutionContext,
} from "./execution-context.js";
import type { AutomationStateStore } from "./automation-state-store.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { DataStore } from "../data-store/data-store.js";
import type { Device, ActionResult, BulkActionResult, ConfirmOptions, EventMetadata } from "../core/types.js";
import logger from "../logger.js";
import { requestPublicHttp } from "../security/outbound-http.js";

// isolated-vm is a native addon that requires C++ compilation.
// On Windows dev machines it may not compile — graceful fallback logs a warning.
// The actual build happens in Docker on the Raspberry Pi (ARM64).
let ivm: typeof import("isolated-vm") | null = null;
try {
  const mod = await import("isolated-vm");
  // Handle CJS/ESM interop — the module may expose Isolate on .default or directly
  ivm = (mod.default ?? mod) as typeof import("isolated-vm");
} catch {
  logger.warn("isolated-vm not available — sandbox execution disabled (expected on Windows dev)");
}

/** Categorized cause of a sandbox execution failure. */
export type SandboxFailureReason = "runtime" | "timeout" | "memory" | "unavailable";

/**
 * Discriminated result of a single sandbox execution.
 *
 * `Sandbox.execute()` resolves this for every outcome and never rejects, so the
 * AutomationEngine can act on the true outcome rather than assuming success.
 */
export type SandboxExecutionResult =
  | { success: true }
  | { success: false; error: string; reason: SandboxFailureReason };

/**
 * Classify a thrown isolate error into a failure reason, honoring chronological
 * precedence (Req 1.8 — report the first-detected condition):
 *   1. timeout — the error message carries the isolated-vm timeout signature
 *   2. memory  — the isolate was torn down (wasDisposed) or the message carries
 *                a memory/allocation/disposed signature
 *   3. runtime — any other thrown error (user throw, TypeError, etc.)
 *
 * The returned `error` is always the underlying `err.message` (Req 1.5).
 * Exported for property/unit testing without a live isolate.
 */
export function classifySandboxError(
  err: Error,
  isolateWasDisposed: boolean,
): { reason: Exclude<SandboxFailureReason, "unavailable">; error: string } {
  const message = err.message;
  if (/timed out/i.test(message)) {
    return { reason: "timeout", error: message };
  }
  if (isolateWasDisposed || /memory limit|array buffer allocation failed|disposed/i.test(message)) {
    return { reason: "memory", error: message };
  }
  return { reason: "runtime", error: message };
}

/**
 * Numeric comparison operators supported in a {@link ConditionSpec}.
 */
const CONDITION_COMPARATORS: Record<string, (a: number, b: number) => boolean> = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

/**
 * Declarative confirmation condition passed from a sandboxed automation to the
 * host. It is deliberately PLAIN DATA — a `{ field, op, value }` numeric
 * comparison, or an `{ all: [...] }` / `{ any: [...] }` combinator — because
 * isolated-vm does not transfer a live predicate FUNCTION across the isolate
 * boundary (a raw function argument throws "A non-transferable value was
 * passed"). The host reconstructs a native predicate from the spec via
 * {@link evaluateConditionSpec}, so the observed-tier condition is evaluated
 * entirely host-side with nothing but data crossing the boundary.
 *
 * `value` may be a boolean as well as a number. Most real actuators report their
 * commanded field as a boolean (`{ on: true }`, `{ sealed: false }`,
 * `{ active: true }`), so `{ field: "on", op: "eq", value: true }` is the most
 * natural way to express "confirm the switch actually reached ON".
 * {@link evaluateConditionSpec} compares numerically after coercion, and a
 * boolean coerces to 1/0 on BOTH sides, so the comparison is exact.
 */
export interface ConditionComparison {
  field: string;
  op: keyof typeof CONDITION_COMPARATORS;
  value: number | boolean;
}

/** True when `spec` is a structurally valid condition spec (recursively). */
export function isConditionSpec(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as Record<string, unknown>;
  if (Array.isArray(s.all)) return s.all.length > 0 && s.all.every(isConditionSpec);
  if (Array.isArray(s.any)) return s.any.length > 0 && s.any.every(isConditionSpec);
  return (
    typeof s.field === "string" &&
    typeof s.op === "string" &&
    Object.prototype.hasOwnProperty.call(CONDITION_COMPARATORS, s.op) &&
    // Booleans are accepted alongside numbers: rejecting them here made every
    // `value: <boolean>` spec malformed, which silently dropped the caller's
    // Confirmation_Options and clamped an author's `tier: "observed"` down to a
    // fire-and-forget dispatch. Coercion happens in evaluateConditionSpec().
    (typeof s.value === "number" || typeof s.value === "boolean")
  );
}

/**
 * Evaluate a {@link ConditionSpec} against an observed device state. A missing
 * or non-numeric observed field yields `false` (the condition is simply not yet
 * satisfied), never a throw. Exported for unit testing without a live isolate.
 *
 * Both sides are coerced with `Number`, so a boolean observed field and/or a
 * boolean `value` compare as 1/0 — `{ field: "on", op: "eq", value: true }` is
 * satisfied by an observed `{ on: true }` and not by `{ on: false }`.
 */
export function evaluateConditionSpec(spec: unknown, state: Record<string, unknown>): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as Record<string, unknown>;
  if (Array.isArray(s.all)) return s.all.every((sub) => evaluateConditionSpec(sub, state));
  if (Array.isArray(s.any)) return s.any.some((sub) => evaluateConditionSpec(sub, state));
  if (
    typeof s.field !== "string" ||
    typeof s.op !== "string" ||
    !Object.prototype.hasOwnProperty.call(CONDITION_COMPARATORS, s.op)
  ) {
    return false;
  }
  const actual = Number(state[s.field]);
  const expected = Number(s.value);
  if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
  return CONDITION_COMPARATORS[s.op](actual, expected);
}

/**
 * Build a host-side {@link ConfirmOptions} from the pieces threaded across the
 * isolate boundary by the `devices.action` / `devices.actionAll` wrappers.
 *
 * The confirmation predicate arrives as a declarative {@link ConditionSpec}
 * (plain data), NOT a function: isolated-vm cannot transfer a live function as
 * a call argument. The host reconstructs a native predicate that evaluates the
 * spec against the observed device state (see {@link evaluateConditionSpec}).
 * An absent or malformed spec yields `undefined` (no confirmation), so the
 * command falls back to the highest tier it can otherwise prove.
 */
function buildConfirmOptions(
  conditionSpec: unknown,
  confirmDeviceId?: string,
  confirmTimeoutMs?: number,
): ConfirmOptions | undefined {
  if (!isConditionSpec(conditionSpec)) return undefined;

  const predicate = (state: Record<string, unknown>): boolean =>
    evaluateConditionSpec(conditionSpec, state);

  return {
    condition: predicate,
    ...(typeof confirmDeviceId === "string" ? { deviceId: confirmDeviceId } : {}),
    ...(typeof confirmTimeoutMs === "number" ? { timeoutMs: confirmTimeoutMs } : {}),
  };
}

/**
 * Outcome of the script-path completion-tier gate for a single command, computed
 * before any dispatch. Exported so the gate can be property-tested without a
 * native isolated-vm build (Windows dev has no isolate).
 */
export type ScriptTierResolution =
  | { ok: true; chosen: ConfirmationTier | undefined }
  | { ok: false; error: string };

/**
 * Safely render an arbitrary (possibly malformed) tier value for an error
 * message. Plain `String(value)` throws for objects whose `toString`/`valueOf`
 * do not yield a primitive, so fall back to the object tag in that case.
 */
export function describeTierValue(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Apply the completion-tier gate for one script-issued command (Req 5.1–5.5):
 *
 * - a per-call tier that is defined but not a valid `ConfirmationTier` fails
 *   validation, so the command is never dispatched (Req 5.5);
 * - `undefined` means "omit `requiredTier`", so the boundary selects the highest
 *   tier the TARGET DEVICE can actually prove (Req 5.3).
 *
 * The per-call tier is the only place an automation states a tier. There is no
 * rule-level default: one automation may command many devices with different
 * acknowledgement capabilities, so a single value spanning the whole rule could
 * only ever be an aspiration that the boundary silently clamped per device.
 *
 * No ceiling is consulted here. The `CommandService` boundary clamps the supplied
 * tier against the device's live capability and never reports a tier it did not
 * reach, so this gate only hard-fails on a *malformed* value.
 */
export function resolveScriptTier(perCallTier: unknown): ScriptTierResolution {
  if (perCallTier !== undefined && !isConfirmationTier(perCallTier)) {
    return { ok: false, error: `Invalid completion tier '${describeTierValue(perCallTier)}'` };
  }
  // Already proven to be a valid tier or absent by the guard above.
  return { ok: true, chosen: perCallTier as ConfirmationTier | undefined };
}

/**
 * Reduce a host value to structured-clone-safe plain JSON.
 *
 * Needed because a host callback's return value must be TRANSFERABLE. A bare
 * object is not: `Reference.apply()` defaults to `FallbackReference` semantics
 * (see isolated-vm's own typings — `Options extends FallbackReference ?
 * Reference<Result>`), so the isolate receives a `Reference` to the value rather
 * than the value. A `Reference` is truthy and has none of the expected
 * properties, so `result.success` reads as `undefined` and every
 * `if (result.success)` in user Logic silently takes the failure branch while
 * `result.error` and `result.lifecycleState` report nothing at all.
 *
 * An `ActionResult`'s `data` comes from a device handler and may carry values
 * `ExternalCopy` cannot clone, which would reject the transfer and throw inside
 * the script. JSON round-tripping drops exactly those (functions, symbols) and
 * keeps the plain report fields the contract promises.
 */
export function toPlainJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as T;
  } catch {
    return null as unknown as T;
  }
}

/**
 * Body of the `devices.action()` host callback, extracted so the completion-tier
 * gate can be property-tested without a live isolate. Validates the tier and,
 * on an invalid value, returns a failing {@link ActionResult} WITHOUT calling
 * `execute` (Req 5.5); otherwise dispatches through the {@link CommandService}
 * with the per-call tier (`undefined` ⇒ highest-available for that device).
 */
export async function dispatchScriptAction(
  commandService: Pick<CommandService, "execute">,
  descriptor: ActionDescriptor,
  ruleId: string,
  confirm: ConfirmOptions | undefined,
  perCallTier: unknown,
): Promise<ActionResult> {
  const tier = resolveScriptTier(perCallTier);
  if (!tier.ok) {
    return { success: false, error: tier.error, lifecycleState: "FAILED" };
  }
  return commandService.execute(descriptor, ruleId, confirm, tier.chosen);
}

/** The plan produced by {@link planAutomationBody}: which action indices the
 *  in-isolate `automation()` loop invokes, and the aggregate success. */
export interface AutomationBodyPlan {
  /** Indices of the actions the runner invokes, in invocation order. */
  invokedIndices: number[];
  /** `true` iff every invoked action succeeded. */
  aggregateSuccess: boolean;
}

/**
 * Pure fail-fast predicate mirrored by the in-isolate `automation()` loop
 * (Req 11.3): after awaiting an action, stop invoking further actions when that
 * action failed and the automation did not opt into continue-on-failure.
 *
 * Exported so Property 16 can be tested without a live isolate.
 */
export function shouldStopAfter(
  outcome: { success: boolean },
  continueOnFailure: boolean,
): boolean {
  return !continueOnFailure && !outcome.success;
}

/**
 * Pure model of the in-isolate `automation()` action loop (Req 11.3, 11.5).
 *
 * Given the ordered per-action outcomes and the `continueOnFailure` flag, it
 * returns which action indices the runner invokes (in order) and the aggregate
 * success. Actions are always invoked in order; when `continueOnFailure` is
 * `false` the loop stops immediately after the first failing action; when
 * `true` every action is invoked regardless of individual failures.
 *
 * The in-isolate loop in {@link BOOTSTRAP_SCRIPT} is written to match this
 * function exactly, so this host-side helper is the testable unit for Property
 * 16 (isolated-vm is unavailable on the Windows dev box).
 */
export function planAutomationBody(
  outcomes: ReadonlyArray<{ success: boolean }>,
  continueOnFailure: boolean,
): AutomationBodyPlan {
  const invokedIndices: number[] = [];
  let aggregateSuccess = true;
  let index = 0;
  for (const outcome of outcomes) {
    invokedIndices.push(index);
    if (!outcome.success) {
      aggregateSuccess = false;
    }
    if (shouldStopAfter(outcome, continueOnFailure)) {
      break;
    }
    index += 1;
  }
  return { invokedIndices, aggregateSuccess };
}

/** Dependencies injected into the Sandbox. */
export interface SandboxDeps {
  commandService: CommandService;
  deviceRegistry: DeviceRegistry;
  stateStore?: AutomationStateStore;
  dataStore?: DataStore;
  collector?: CommandResultCollector;
  onStateChange?: (ruleId: string, key: string, value: unknown) => void;
  /**
   * Safe automation-to-automation event emitter (phase-1 Req 6). Backs the
   * `events.emit()` sandbox global. Available to scoped automations (it never
   * grants arbitrary MQTT publish). When absent, `events.emit()` is not exposed.
   */
  automationEventService?: AutomationEventService;
  /**
   * Resolves the executing automation's authorization scope by rule id. When a
   * scoped scope is returned, the sandbox injects only the owning tab's devices
   * and confines Data Store access to that tab's collections (refusing shared
   * buckets). When absent, or when the scope is unrestricted, the full inventory
   * and Data Store surface are exposed as before.
   */
  scopeResolver?: AutomationScopeResolver;
}

/** Context describing the event that triggered the automation. */
export interface SandboxContext {
  topic: string;
  deviceId: string;
  state: Record<string, unknown>;
  timestamp: number;
  /** Optional additive provenance/causation envelope (phase-1 Req 5). */
  meta?: EventMetadata;
}

/** Memory limit in MB for each V8 isolate. */
const ISOLATE_MEMORY_MB = 32;

/** Execution timeout in milliseconds — guards synchronous CPU work in the isolate. */
const EXECUTION_TIMEOUT_MS = 5000;

/**
 * Completion budget (ms) for draining in-flight device-action promises after the
 * script body returns (Req 11.7). This is deliberately SEPARATE from
 * {@link EXECUTION_TIMEOUT_MS} — that timeout bounds synchronous CPU work inside
 * the isolate, whereas this budget bounds the asynchronous settling of dispatched
 * commands (which wait on connectors/MQTT and, when confirmation is requested,
 * on device acknowledgement/observation).
 *
 * Sized at 6× the per-action confirmation default (DEFAULT_CONFIRM_TIMEOUT_MS =
 * 5000 ms) so a script that dispatches several sequentially-awaited confirmed
 * actions can complete, while still guaranteeing that an action which never
 * settles cannot make `execute()` hang indefinitely.
 */
const ACTION_DRAIN_BUDGET_MS = 30_000;

/**
 * Await the settling of every in-flight device-action promise, bounded by
 * `budgetMs` (Req 11.1, 11.2, 11.7).
 *
 * The set is drained in a loop rather than a single `Promise.allSettled`
 * snapshot because the async `automation()` body registers further action
 * promises as it progresses (each awaited action can dispatch the next); every
 * settled promise removes itself from the set, so the loop terminates once the
 * body has issued and settled all of its actions. On budget expiry the drain
 * returns without throwing — the still-pending actions' results are simply not
 * counted (they were not yet confirmed).
 */
async function drainInFlight(
  inFlight: Set<Promise<unknown>>,
  budgetMs: number,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (inFlight.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, remaining);
    });
    await Promise.race([Promise.allSettled([...inFlight]), budget]);
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Await `promise`, but give up once the shared completion `deadline`
 * (a `Date.now()`-relative timestamp) passes. Used for the first stage of the
 * two-stage completion wait in {@link Sandbox.execute} — deterministically
 * awaiting the `automation()` body promise bridged out of the isolate.
 *
 * `promise` is expected to never reject (the caller attaches a `.catch`), so this
 * never rejects either; on deadline expiry it simply returns while the underlying
 * work may still be settling (mirrors {@link drainInFlight}'s truthful, non-throwing
 * budget-expiry behaviour, Req 11.7).
 */
async function awaitUntilDeadline(promise: Promise<unknown>, deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, remaining);
  });
  try {
    await Promise.race([promise.then(() => undefined), budget]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Register an in-flight action promise so {@link drainInFlight} can await it,
 * removing it from the set once it settles. The promise bodies (see
 * {@link Sandbox.setDevicesRefs}) never reject, so no rejection handling is
 * required here.
 */
function registerInFlight(inFlight: Set<Promise<unknown>>, promise: Promise<unknown>): void {
  inFlight.add(promise);
  void promise.finally(() => {
    inFlight.delete(promise);
  });
}

/**
 * Bootstrap script that runs inside the isolate to wire up the sandbox API
 * from the raw references and data injected on the global scope.
 *
 * After execution, all `__` prefixed temporaries are deleted — the user
 * script sees the documented `devices`, `mqtt`, `log`, `context`, `http`, `state` and optional capability globals.
 */
const BOOTSTRAP_SCRIPT = `
(function() {
  var data = __devicesData;
  var map = __devicesMap;
  var actionRef = __actionRef;
  var actionAllRef = __actionAllRef;
  var mqttRef = __mqttPublishRef;
  var logInfoRef = __logInfoRef;
  var logWarnRef = __logWarnRef;
  var logErrorRef = __logErrorRef;
  var ctx = __contextData;
  var httpGetRef = __httpGetRef;
  var httpPostRef = __httpPostRef;
  var stateGetRef = __stateGetRef;
  var stateSetRef = __stateSetRef;
  var stateGetAllRef = __stateGetAllRef;
  var stateDeleteRef = __stateDeleteRef;
  var dbWriteRef = typeof __dbWriteRef !== "undefined" ? __dbWriteRef : undefined;
  var dbQueryRef = typeof __dbQueryRef !== "undefined" ? __dbQueryRef : undefined;
  var dbGetRef = typeof __dbGetRef !== "undefined" ? __dbGetRef : undefined;
  var dbSetRef = typeof __dbSetRef !== "undefined" ? __dbSetRef : undefined;
  var dbDeleteRef = typeof __dbDeleteRef !== "undefined" ? __dbDeleteRef : undefined;
  var dbCollectionsRef = typeof __dbCollectionsRef !== "undefined" ? __dbCollectionsRef : undefined;
  var eventsEmitRef = typeof __eventsEmitRef !== "undefined" ? __eventsEmitRef : undefined;
  // Closure-local logical command failure state. User-authored code must not be
  // able to clear it between actions and bypass the automation fail-fast rule.
  var commandFailed = false;

  globalThis.devices = {
    list: function() { return data; },
    get: function(id) { return map[id]; },
    filter: function(predicate) { return data.filter(predicate); },
    action: function(deviceId, actionType, params, opts) {
      // isolated-vm only transfers PRIMITIVES as call arguments — a plain object
      // (or a function) throws "A non-transferable value was passed". So, exactly
      // like state.set/db.*, object-shaped arguments are JSON-serialised here and
      // parsed back host-side. The 4th options bag may carry a DECLARATIVE confirm
      // condition (plain-data spec, never a function), the observed
      // deviceId/timeoutMs, and an optional per-call completion tier.
      var tier = opts ? opts.tier : undefined;
      var condition = (opts && opts.condition != null) ? opts.condition : undefined;
      var confirmDeviceId = opts ? opts.deviceId : undefined;
      var confirmTimeoutMs = opts ? opts.timeoutMs : undefined;
      var paramsJson = params === undefined ? undefined : JSON.stringify(params);
      var conditionJson = condition === undefined ? undefined : JSON.stringify(condition);
      var p = actionRef.apply(undefined,
        [deviceId, actionType, paramsJson, conditionJson, confirmDeviceId, confirmTimeoutMs, tier],
        { result: { promise: true } });
      // Record a logical (non-throwing) command failure on an isolate-global flag
      // so automation() can fail-fast without depending on the user action
      // callback returning the ActionResult (Req 11.3, 11.4).
      return p.then(function(result) {
        if (result && result.success === false) { commandFailed = true; }
        return result;
      });
    },
    actionAll: function(filter, actionType, params, opts) {
      // The predicate is deliberately evaluated INSIDE the isolate against the
      // already-scoped device snapshot. isolated-vm cannot transfer live
      // functions or object graphs to the host, and the host must not re-read a
      // broader registry. Only primitive/JSON data crosses this boundary.
      var matchedIds;
      var paramsJson;
      var conditionJson;
      try {
        matchedIds = data.filter(filter).map(function(device) { return device.id; });
        paramsJson = params === undefined ? undefined : JSON.stringify(params);
        conditionJson = (opts && opts.condition != null) ? JSON.stringify(opts.condition) : undefined;
      } catch (err) {
        // Report isolate-side predicate/serialization failures back through the
        // host callback as a real failed command result. Returning only a bulk
        // error-only bulk object would make an otherwise-successful execution look
        // successful to the AutomationEngine because no CommandResult reached
        // its collector.
        var preflightError = String(err && err.message ? err.message : err);
        commandFailed = true;
        return actionAllRef.apply(undefined,
          ["[]", actionType, undefined, undefined,
           opts ? opts.deviceId : undefined, opts ? opts.timeoutMs : undefined,
           opts ? opts.tier : undefined, preflightError],
          { result: { promise: true } });
      }
      var tier = opts ? opts.tier : undefined;
      var p = actionAllRef.apply(undefined,
        [JSON.stringify(matchedIds), actionType, paramsJson, conditionJson,
         opts ? opts.deviceId : undefined, opts ? opts.timeoutMs : undefined, tier, undefined],
        { result: { promise: true } });
      // A bulk action is a logical failure when any per-device command failed or
      // when the whole call failed validation before dispatch.
      return p.then(function(result) {
        if (result && (result.failed > 0 || result.error)) { commandFailed = true; }
        return result;
      });
    }
  };

  globalThis.mqtt = {
    publish: function(topic, payload) {
      mqttRef.applySync(undefined, [topic, payload]);
    }
  };

  if (eventsEmitRef) {
    globalThis.events = {
      emit: function(name, payload) {
        // Returns { published, eventId?, topic?, error? }. Never throws into the
        // script; the source rule and causal metadata are host-derived. The
        // payload is JSON-serialised because isolated-vm cannot transfer a plain
        // object as a call argument (only primitives cross); the host parses it.
        var payloadJson = payload === undefined ? undefined : JSON.stringify(payload);
        return eventsEmitRef.applySync(undefined, [name, payloadJson], { result: { copy: true } });
      }
    };
  }

  globalThis.log = {
    info: function(message) { logInfoRef.applySync(undefined, [message]); },
    warn: function(message) { logWarnRef.applySync(undefined, [message]); },
    error: function(message) { logErrorRef.applySync(undefined, [message]); }
  };

  globalThis.context = Object.freeze(ctx);

  globalThis.http = {
    get: function(url, options) {
      var headers = (options && options.headers) ? JSON.stringify(options.headers) : '{}';
      return httpGetRef.apply(undefined, [url, headers], { result: { promise: true } });
    },
    post: function(url, options) {
      var headers = (options && options.headers) ? JSON.stringify(options.headers) : '{}';
      var body = (options && options.body) ? options.body : '';
      return httpPostRef.apply(undefined, [url, headers, body], { result: { promise: true } });
    }
  };

  globalThis.state = {
    get: function(key) { return stateGetRef.applySync(undefined, [key]); },
    set: function(key, value) { stateSetRef.applySync(undefined, [key, JSON.stringify(value)]); },
    getAll: function() { return stateGetAllRef.applySync(undefined, []); },
    delete: function(key) { stateDeleteRef.applySync(undefined, [key]); }
  };

  if (dbWriteRef) {
    globalThis.db = {
      write: function(collection, payload, options) {
        dbWriteRef.applySync(undefined, [collection, JSON.stringify(payload), JSON.stringify(options || {})]);
      },
      query: function(collection, options) {
        var result = dbQueryRef.applySync(undefined, [collection, JSON.stringify(options || {})]);
        return JSON.parse(result);
      },
      get: function(bucket, key) {
        var result = dbGetRef.applySync(undefined, [bucket, key]);
        return result === undefined ? undefined : JSON.parse(result);
      },
      set: function(bucket, key, value) {
        dbSetRef.applySync(undefined, [bucket, key, JSON.stringify(value)]);
      },
      delete: function(bucket, key) {
        dbDeleteRef.applySync(undefined, [bucket, key]);
      },
      collections: function() {
        var result = dbCollectionsRef.applySync(undefined, []);
        return JSON.parse(result);
      }
    };
  }

  // Collector for every automation() invocation's completion promise. Kept in the
  // bootstrap closure (NOT a user-visible global) so user code cannot tamper with
  // it. Sandbox.execute() awaits these deterministically via __awaitAutomations
  // once the synchronous script body has returned (see the two-stage completion
  // wait in Sandbox.execute()). This closes a scheduling race that the size-based
  // in-flight drain cannot: between two SEQUENTIAL actions the in-flight set is
  // momentarily empty (action N settles and leaves the set before the awaited
  // continuation resumes the loop and registers action N+1), so a size-based loop
  // can exit early. Awaiting the body promise itself is race-free.
  var __automationRuns = [];

  // The real async automation body — unchanged fail-fast semantics (Req 11.3–11.5).
  var __runAutomation = async function(config) {
    // Reset the per-invocation logical-failure flag (Req 11.3).
    commandFailed = false;
    // Normalize conditions: accept single function, array, or undefined
    var conditions = config.conditions || config.condition;
    if (conditions) {
      var condArr = Array.isArray(conditions) ? conditions : [conditions];
      for (var i = 0; i < condArr.length; i++) {
        if (!condArr[i](globalThis.context)) {
          return;
        }
      }
    }
    // Normalize actions: accept single function or array
    var actions = Array.isArray(config.actions) ? config.actions : [config.actions];
    // continueOnFailure opts every action in regardless of failures (Req 11.5).
    var continueOnFailure = config.continueOnFailure === true;
    // Await each action in order so a dispatched command settles before the next
    // action runs, then fail-fast unless continue-on-failure is set (Req 11.3–11.5).
    // This mirrors the host-side pure helper planAutomationBody/shouldStopAfter.
    for (var j = 0; j < actions.length; j++) {
      await actions[j](globalThis.context);
      if (!continueOnFailure && commandFailed) {
        break;
      }
    }
  };

  // User-visible entry point. Invokes the async body, records its completion
  // promise so the host can await the WHOLE body (all sequential actions), and
  // returns that promise so user code that does \`await automation(...)\` still works.
  globalThis.automation = function(config) {
    var run = __runAutomation(config);
    __automationRuns.push(run);
    return run;
  };

  // Host-callable entry that resolves once every automation() body has fully
  // completed (all sequential actions awaited, each collector.pushCurrent() done).
  // Resolves immediately when no automation() call was made. This global is
  // intentionally NOT deleted in the cleanup block below — Sandbox.execute() reads
  // it AFTER the user script has run. It only awaits the user's own automation
  // promises and exposes no host references or security-sensitive surface.
  globalThis.__awaitAutomations = function() {
    return Promise.all(__automationRuns);
  };

  // Clean up temporary globals
  delete globalThis.__devicesData;
  delete globalThis.__devicesMap;
  delete globalThis.__actionRef;
  delete globalThis.__actionAllRef;
  delete globalThis.__mqttPublishRef;
  delete globalThis.__logInfoRef;
  delete globalThis.__logWarnRef;
  delete globalThis.__logErrorRef;
  delete globalThis.__contextData;
  delete globalThis.__httpGetRef;
  delete globalThis.__httpPostRef;
  delete globalThis.__stateGetRef;
  delete globalThis.__stateSetRef;
  delete globalThis.__stateGetAllRef;
  delete globalThis.__stateDeleteRef;
  delete globalThis.__dbWriteRef;
  delete globalThis.__dbQueryRef;
  delete globalThis.__dbGetRef;
  delete globalThis.__dbSetRef;
  delete globalThis.__dbDeleteRef;
  delete globalThis.__dbCollectionsRef;
  delete globalThis.__eventsEmitRef;
})();
`;

/**
 * Executes compiled JavaScript in a secure V8 isolate via `isolated-vm`.
 *
 * Each execution creates a fresh isolate with a 32 MB memory limit and
 * 5-second timeout. The sandbox exposes `devices`, `mqtt`, `log`, and
 * `context`, bounded HTTP/state helpers and any configured optional capabilities as globals — Node.js APIs remain inaccessible.
 *
 * Errors are always caught, logged with the rule ID, and never propagated.
 */
export class Sandbox {
  private commandService: CommandService;
  private deviceRegistry: DeviceRegistry;
  private stateStore?: AutomationStateStore;
  private dataStore?: DataStore;
  private collector?: CommandResultCollector;
  private onStateChange?: (ruleId: string, key: string, value: unknown) => void;
  private scopeResolver?: AutomationScopeResolver;
  private automationEventService?: AutomationEventService;

  constructor(deps: SandboxDeps) {
    this.commandService = deps.commandService;
    this.deviceRegistry = deps.deviceRegistry;
    this.stateStore = deps.stateStore;
    this.dataStore = deps.dataStore;
    this.collector = deps.collector;
    this.onStateChange = deps.onStateChange;
    this.scopeResolver = deps.scopeResolver;
    this.automationEventService = deps.automationEventService;
  }

  /**
   * Execute compiled JS in an isolated V8 context.
   *
   * Resolves a {@link SandboxExecutionResult} for every outcome and never
   * rejects (Req 1.7). Success maps to `{ success: true }`; runtime throws,
   * the 5 s timeout, and the 32 MB memory limit map to a classified failure;
   * an unavailable isolated-vm runtime maps to `reason: "unavailable"`.
   *
   * After the synchronous script body returns, a TWO-STAGE, budget-bounded
   * completion wait closes the await gap (Req 11.1, 11.2, 11.7): stage 1 awaits
   * the `automation()` body promise deterministically (bridged via
   * `__awaitAutomations`), then stage 2 drains any imperative device-action
   * stragglers. A single shared deadline bounds the total async wait to
   * {@link ACTION_DRAIN_BUDGET_MS}. The deterministic body await is necessary
   * because the size-based in-flight drain alone can exit early: between two
   * sequential automation actions the in-flight set is momentarily empty (the
   * action-N+1 registration race).
   */
  async execute(
    compiledJs: string,
    context: SandboxContext,
    ruleId: string,
  ): Promise<SandboxExecutionResult> {
    if (!ivm) {
      logger.error({ ruleId }, "Sandbox execution skipped — isolated-vm not available");
      return {
        success: false,
        reason: "unavailable",
        error: "Sandbox execution unavailable — isolated-vm is not installed",
      };
    }

    let isolate: InstanceType<(typeof ivm)["Isolate"]> | null = null;

    // Tracks every device-action promise dispatched during this execution so the
    // await gap can be closed before resolving (Req 11.1, 11.2). Held locally so
    // it is scoped to this single execution/isolate.
    const inFlight = new Set<Promise<unknown>>();

    try {
      isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_MB });
      const ivmContext = await isolate.createContext();
      const jail = ivmContext.global;

      // Block forbidden globals
      await this.blockForbiddenGlobals(jail);

      // Resolve the automation's authorization scope once for this execution.
      // Unrestricted (or no resolver wired) exposes the full inventory and Data
      // Store surface; scoped confines device injection and Data Store access to
      // the owning tab. Device-action dispatch is independently re-checked in the
      // CommandService, so this injection filtering is defense in depth.
      const scope: AuthorizationScope = this.scopeResolver
        ? this.scopeResolver.resolve(ruleId)
        : { kind: "unrestricted" };

      // Capture the active execution context HERE, on the host stack, where the
      // AsyncLocalStorage set by AutomationEngine.executeScriptRule() is still
      // in scope. The context does NOT survive a synchronous host callback
      // invoked from inside the isolate (isolated-vm crosses a native boundary
      // that async_hooks does not track), so events.emit — which runs during
      // script.run() and reads the source rule id from this context — would
      // otherwise see `undefined` and refuse. We re-establish it in the emit
      // callback below. (devices.action is unaffected: its rule id is passed in
      // directly, and its command results settle on the host's own async stack.)
      const executionContext = currentExecutionContext();

      // Set raw data and references on the global scope
      await this.setDevicesRefs(jail, ruleId, inFlight, scope);
      await this.setMqttRefs(jail, ruleId);
      await this.setEventsRefs(jail, executionContext);
      await this.setLogRefs(jail, ruleId);
      await this.setContextData(jail, context);
      await this.setHttpRefs(jail, ruleId);
      await this.setStateRefs(jail, ruleId);
      await this.setDataStoreRefs(jail, ruleId, scope);

      // Run bootstrap to wire up the clean API from the raw refs
      const bootstrap = await isolate.compileScript(BOOTSTRAP_SCRIPT);
      await bootstrap.run(ivmContext);

      // Compile and run user script with timeout
      const script = await isolate.compileScript(compiledJs);
      await script.run(ivmContext, { timeout: EXECUTION_TIMEOUT_MS });

      // Close the await gap with a TWO-STAGE, budget-bounded completion wait
      // (Req 11.1, 11.2, 11.7). isolated-vm runs a classic script with no top-level
      // await, so `script.run()` resolves as soon as the synchronous body returns —
      // before the async work it kicked off has settled. Both stages run inside the
      // collector's AsyncLocalStorage context established by
      // AutomationEngine.executeScriptRule(), so every collector.pushCurrent() lands
      // before the engine closes the collector.
      //
      // Stage 1 — automation() bodies: await the bridged `__awaitAutomations`
      // promise, which resolves only once every automation() body has run to
      // completion (all SEQUENTIAL actions awaited in order). This is deterministic,
      // unlike the size-based `drainInFlight` loop: between two sequential actions
      // the in-flight set is momentarily empty — action N settles and removes itself
      // before isolated-vm bridges the awaited continuation back into the isolate and
      // the automation() loop resumes to register action N+1 — so a size-based loop
      // alone can exit early and re-introduce the await gap for multi-action scripts.
      //
      // Stage 2 — imperative stragglers: `drainInFlight` then covers scripts that call
      // devices.action()/devices.actionAll() directly WITHOUT automation() (and any
      // promises still settling). registerInFlight tracks those.
      //
      // Both stages share ONE budget: a single deadline bounds the total async
      // completion wait to ACTION_DRAIN_BUDGET_MS, so a never-settling action cannot
      // make execute() hang. On budget expiry each stage returns truthfully without
      // throwing (execute() never rejects — Req 1.7/11.6).
      const completionDeadline = Date.now() + ACTION_DRAIN_BUDGET_MS;

      // Stage 1: deterministic automation()-body completion.
      const awaitAutomationsRef = await ivmContext.global.get("__awaitAutomations", {
        reference: true,
      });
      // The bridged promise may reject if a user action callback throws (rather than
      // returning success:false); swallow it here so execute() preserves its
      // never-reject contract (Req 11.6) — logical command failures are already
      // surfaced by the closure-local fail-fast state and CommandResults pushed
      // into the collector.
      const automationBodies = (
        awaitAutomationsRef.apply(undefined, [], { result: { promise: true } }) as Promise<unknown>
      ).catch((err: unknown) => {
        logger.debug(
          { ruleId, error: (err as Error)?.message },
          "automation() body rejected during completion wait",
        );
      });
      await awaitUntilDeadline(automationBodies, completionDeadline);
      awaitAutomationsRef.release();

      // Stage 2: imperative straggler drain with the REMAINING shared budget.
      const remainingBudget = Math.max(0, completionDeadline - Date.now());
      await drainInFlight(inFlight, remainingBudget);
      return { success: true };
    } catch (err) {
      const wasDisposed = isolate?.isDisposed ?? false;
      const { reason, error } = classifySandboxError(err as Error, wasDisposed);
      logger.error(
        { ruleId, reason, error },
        `Sandbox execution error for rule ${ruleId}`,
      );
      return { success: false, reason, error };
    } finally {
      if (isolate) {
        try {
          isolate.dispose();
        } catch {
          // Isolate may already be disposed after OOM
        }
      }
    }
  }

  /**
   * Block access to dangerous Node.js globals by setting them to undefined.
   * `require`, `process`, `fs`, `child_process`, `eval`, `Function`, `global`
   */
  private async blockForbiddenGlobals(jail: IvmGlobal): Promise<void> {
    const forbidden = [
      "require", "process", "fs", "child_process",
      "eval", "Function", "global",
    ];
    for (const name of forbidden) {
      await jail.set(name, undefined);
    }
  }

  /**
   * Set device data and action reference on the jail for the bootstrap script.
   */
  private async setDevicesRefs(
    jail: IvmGlobal,
    ruleId: string,
    inFlight: Set<Promise<unknown>>,
    scope: AuthorizationScope = { kind: "unrestricted" },
  ): Promise<void> {
    if (!ivm) return;

    // A scoped automation sees only the devices its owning tab exposes; an
    // unrestricted one sees the full inventory. A scoped automation whose owning
    // tab is gone has an empty device set (fail-closed).
    const allDevices =
      scope.kind === "scoped"
        ? this.deviceRegistry.getAll().filter((d) => scope.deviceIds.has(d.id))
        : this.deviceRegistry.getAll();
    const serialized = JSON.parse(JSON.stringify(allDevices)) as Device[];

    // Copy device list into isolate
    await jail.set("__devicesData", new ivm.ExternalCopy(serialized).copyInto());

    // Copy device map for get() lookups
    const devicesMap: Record<string, Device> = {};
    for (const d of serialized) {
      devicesMap[d.id] = d;
    }
    await jail.set("__devicesMap", new ivm.ExternalCopy(devicesMap).copyInto());

    // Host-side callback for devices.action() — returns ActionResult
    // Requirements: 1.5, 1.6, 9.1
    const commandService = this.commandService;
    const collector = this.collector;
    await jail.set(
      "__actionRef",
      new ivm.Reference(function (
        deviceId: string,
        actionType: string,
        paramsJson?: string,
        conditionJson?: string,
        confirmDeviceId?: string,
        confirmTimeoutMs?: number,
        perCallTier?: unknown,
      ): Promise<ActionResult> {
        // Resolve with a TRANSFERABLE copy, exactly as http.get/state.get do.
        // Returning the bare ActionResult made the isolate receive a Reference to
        // it (Reference.apply falls back to reference semantics), so the script
        // saw `success`/`error`/`lifecycleState` as undefined and could never act
        // on a command outcome. See toPlainJson().
        // copyInto() yields a `Copy<ActionResult>` transferable, which isolated-vm
        // internalises into the isolate AS an ActionResult — so the declared return
        // type is what the SCRIPT sees, and the cast bridges host and isolate views.
        const copyOut = (result: ActionResult): ActionResult =>
          (ivm
            ? (new ivm.ExternalCopy(toPlainJson(result)).copyInto() as unknown as ActionResult)
            : result);
        const run = (async (): Promise<ActionResult> => {
          try {
            // params and the confirm condition cross the isolate boundary as JSON
            // strings (isolated-vm transfers only primitives as call arguments);
            // parse them back to their object forms here.
            const params =
              typeof paramsJson === "string"
                ? (JSON.parse(paramsJson) as Record<string, unknown>)
                : undefined;
            const conditionSpec = typeof conditionJson === "string" ? JSON.parse(conditionJson) : undefined;
            const confirm = buildConfirmOptions(conditionSpec, confirmDeviceId, confirmTimeoutMs);
            // Completion-tier gate (Req 5.1–5.5): fail-on-invalid before dispatch,
            // otherwise dispatch with this call's tier (undefined ⇒ the highest
            // tier this device can prove).
            const result = await dispatchScriptAction(
              commandService,
              { type: "device_action", target: deviceId, params: { actionType, ...(params ?? {}) } },
              ruleId,
              confirm,
              perCallTier,
            );
            // Push the UNCOPIED Command_Result into the collector for the running
            // executionId (Req 2.4, 4.3, 5.3 — script-path commands aggregated via
            // AsyncLocalStorage). Host bookkeeping keeps the real object; only the
            // value handed back to the isolate is copied.
            collector?.pushCurrent(result);
            return copyOut(result);
          } catch (err) {
            // CommandService is specified never to throw, but preserve execution
            // truth even if an unexpected host error violates that contract.
            const failure: ActionResult = {
              success: false,
              error: `Unexpected error in devices.action(): ${(err as Error).message}`,
              failureKind: "execution",
            };
            collector?.pushCurrent(failure);
            return copyOut(failure);
          }
        })();
        // Track the promise so Sandbox.execute() can drain it before resolving,
        // closing the await gap (Req 11.1, 11.2).
        registerInFlight(inFlight, run);
        return run;
      }),
    );

    // Host-side callback for devices.actionAll() — returns BulkActionResult.
    // The isolate evaluates the author predicate over its scope-filtered snapshot
    // and transfers only matched IDs + JSON data. The host re-validates every ID
    // against the same scoped inventory before dispatching.
    const scopedInventory: Device[] = allDevices;  // already scope-filtered above
    const scopedById = new Map(scopedInventory.map((device) => [device.id, device]));
    await jail.set(
      "__actionAllRef",
      new ivm.Reference(function (
        matchedIdsJson: string,
        actionType: string,
        paramsJson?: string,
        conditionJson?: string,
        confirmDeviceId?: string,
        confirmTimeoutMs?: number,
        perCallTier?: unknown,
        preflightError?: string,
      ): Promise<BulkActionResult> {
        const copyOut = (bulk: BulkActionResult): BulkActionResult =>
          (ivm
            ? (new ivm.ExternalCopy(toPlainJson(bulk)).copyInto() as unknown as BulkActionResult)
            : bulk);
        const fail = (
          error: string,
          failureKind: ActionResult["failureKind"] = "invalid_params",
        ): BulkActionResult => {
          // A whole-call actionAll failure has no per-device result array, but it
          // is still a genuine command failure for the Automation execution.
          // Push one synthetic CommandResult so assembleExecutionResult() cannot
          // accidentally report success merely because dispatch never began.
          collector?.pushCurrent({ success: false, error, failureKind });
          return copyOut({ total: 0, succeeded: 0, failed: 0, results: [], error });
        };

        const run = (async (): Promise<BulkActionResult> => {
          if (preflightError) return fail(preflightError, "execution");
          const tier = resolveScriptTier(perCallTier);
          if (!tier.ok) return fail(tier.error);

          let matchedIds: string[];
          let params: Record<string, unknown> | undefined;
          let conditionSpec: unknown;
          try {
            const parsedIds = JSON.parse(matchedIdsJson);
            if (!Array.isArray(parsedIds) || !parsedIds.every((id) => typeof id === "string")) {
              return fail("Invalid devices.actionAll() matched device list");
            }
            matchedIds = [...new Set(parsedIds)];
            params = typeof paramsJson === "string" ? JSON.parse(paramsJson) as Record<string, unknown> : undefined;
            conditionSpec = typeof conditionJson === "string" ? JSON.parse(conditionJson) : undefined;
          } catch (err) {
            return fail(`Invalid devices.actionAll() arguments: ${(err as Error).message}`);
          }

          const matched: Device[] = [];
          for (const id of matchedIds) {
            const device = scopedById.get(id);
            if (!device) return fail(`Device '${id}' is outside this automation's scope`, "unauthorized");
            matched.push(device);
          }
          if (matched.length === 0) return copyOut({ total: 0, succeeded: 0, failed: 0, results: [] });

          const confirm = buildConfirmOptions(conditionSpec, confirmDeviceId, confirmTimeoutMs);
          const settled = await Promise.allSettled(
            matched.map((device) =>
              commandService.execute(
                { type: "device_action", target: device.id, params: { actionType, ...(params ?? {}) } },
                ruleId,
                confirm,
                tier.chosen,
              ).then((result): { deviceId: string } & ActionResult => {
                collector?.pushCurrent(result);
                return { deviceId: device.id, ...result };
              }).catch((err): { deviceId: string } & ActionResult => {
                // CommandService normally resolves failures rather than rejecting,
                // but an unexpected host rejection must still reach the execution
                // collector instead of becoming only a bulk-result bookkeeping row.
                const failure: ActionResult = {
                  success: false,
                  error: (err as Error).message,
                  failureKind: "execution",
                };
                collector?.pushCurrent(failure);
                return { deviceId: device.id, ...failure };
              }),
            ),
          );

          const results = settled.map((entry, index) =>
            entry.status === "fulfilled"
              ? entry.value
              : { deviceId: matched[index]?.id ?? "", success: false as const, error: String(entry.reason) },
          );
          const succeeded = results.filter((result) => result.success).length;
          const failed = results.length - succeeded;
          return copyOut({ total: results.length, succeeded, failed, results });
        })();
        registerInFlight(inFlight, run);
        return run;
      }),
    );
  }

  /**
   * Set MQTT publish reference on the jail for the bootstrap script.
   */
  private async setMqttRefs(jail: IvmGlobal, ruleId: string): Promise<void> {
    if (!ivm) return;

    const commandService = this.commandService;
    await jail.set(
      "__mqttPublishRef",
      new ivm.Reference(function (topic: string, payload: string) {
        // Fire-and-forget — publish is synchronous from the script's perspective
        void commandService.execute(
          { type: "publish", target: topic, params: { payload } },
          ruleId,
        );
      }),
    );
  }

  /**
   * Set the Automation Event emit reference on the jail (phase-1 Req 6.3, 6.4).
   * Only wired when an AutomationEventService is available. The source rule and
   * causal metadata are resolved host-side from the active execution context, so
   * user script supplies only the event name and payload. Scoped automations may
   * use this; it never grants arbitrary MQTT publish authority.
   */
  private async setEventsRefs(
    jail: IvmGlobal,
    executionContext: ActiveExecutionContext | undefined,
  ): Promise<void> {
    if (!ivm) return;
    const service = this.automationEventService;
    if (!service) return;
    await jail.set(
      "__eventsEmitRef",
      new ivm.Reference(function (name: unknown, payloadJson: unknown) {
        // The payload crosses the boundary as a JSON string (isolated-vm transfers
        // only primitives as call arguments); parse it back before emitting.
        const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
        // Re-establish the execution context captured on the host stack: this
        // callback is invoked synchronously from inside the isolate, where the
        // ambient AsyncLocalStorage context is not preserved. Without this,
        // service.emit() resolves no source rule id and refuses the event.
        return executionContext !== undefined
          ? runInExecutionContext(executionContext, () => service.emit(name, payload))
          : service.emit(name, payload);
      }),
    );
  }

  /**
   * Set log references on the jail for the bootstrap script.
   */
  private async setLogRefs(jail: IvmGlobal, ruleId: string): Promise<void> {
    if (!ivm) return;

    await jail.set(
      "__logInfoRef",
      new ivm.Reference(function (message: string) {
        logger.info({ ruleId }, `[script] ${message}`);
      }),
    );
    await jail.set(
      "__logWarnRef",
      new ivm.Reference(function (message: string) {
        logger.warn({ ruleId }, `[script] ${message}`);
      }),
    );
    await jail.set(
      "__logErrorRef",
      new ivm.Reference(function (message: string) {
        logger.error({ ruleId }, `[script] ${message}`);
      }),
    );
  }

  /**
   * Set the frozen context object data on the jail for the bootstrap script.
   */
  private async setContextData(jail: IvmGlobal, context: SandboxContext): Promise<void> {
    if (!ivm) return;
    await jail.set("__contextData", new ivm.ExternalCopy(context).copyInto());
  }

  /**
   * Set HTTP references on the jail. Both authored HTTP and generic webhook
   * actions use the shared public-outbound policy in security/outbound-http.ts:
   * DNS preflight, public HTTP(S) only, no redirects, timeout and body limits.
   */
  private async setHttpRefs(jail: IvmGlobal, ruleId: string): Promise<void> {
    const runtime = ivm;
    if (!runtime) return;

    const request = async (
      method: "GET" | "POST",
      url: string,
      headersJson: string,
      body?: string,
    ): Promise<unknown> => {
      try {
        const headers = JSON.parse(headersJson) as Record<string, string>;
        const response = await requestPublicHttp(url, {
          method,
          headers,
          body: method === "POST" && body ? body : undefined,
        });
        return new runtime.ExternalCopy({ status: response.status, body: response.body }).copyInto();
      } catch (err) {
        logger.warn(
          { ruleId, method, url, error: (err as Error).message },
          "[sandbox] outbound HTTP request refused or failed",
        );
        return new runtime.ExternalCopy({ status: 0, body: (err as Error).message }).copyInto();
      }
    };

    await jail.set(
      "__httpGetRef",
      new runtime.Reference((url: string, headersJson: string) => request("GET", url, headersJson)),
    );
    await jail.set(
      "__httpPostRef",
      new runtime.Reference((url: string, headersJson: string, body: string) =>
        request("POST", url, headersJson, body)),
    );
  }
  /**
   * Set state store references on the jail for the bootstrap script.
   * Provides `state.get(key)`, `state.set(key, value)`, `state.getAll()`, and `state.delete(key)`.
   */
  private async setStateRefs(jail: IvmGlobal, ruleId: string): Promise<void> {
    if (!ivm) return;

    const stateStore = this.stateStore;
    const onStateChange = this.onStateChange;

    // Host-side callback for state.get(key)
    await jail.set(
      "__stateGetRef",
      new ivm.Reference(function (key: string) {
        if (!stateStore) return undefined;
        const value = stateStore.get(ruleId, key);
        if (value === undefined) return undefined;
        return new ivm.ExternalCopy(value).copyInto();
      }),
    );

    // Host-side callback for state.set(key, jsonValue)
    await jail.set(
      "__stateSetRef",
      new ivm.Reference(function (key: string, jsonValue: string) {
        if (!stateStore) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonValue);
        } catch (err) {
          logger.warn({ ruleId, key, error: (err as Error).message }, "Cannot parse state value from sandbox");
          return;
        }
        stateStore.set(ruleId, key, parsed);
        if (onStateChange) {
          onStateChange(ruleId, key, parsed);
        }
      }),
    );

    // Host-side callback for state.getAll()
    await jail.set(
      "__stateGetAllRef",
      new ivm.Reference(function () {
        if (!stateStore) return new ivm.ExternalCopy({}).copyInto();
        const all = stateStore.getAll(ruleId);
        return new ivm.ExternalCopy(all).copyInto();
      }),
    );

    // Host-side callback for state.delete(key)
    await jail.set(
      "__stateDeleteRef",
      new ivm.Reference(function (key: string) {
        if (!stateStore) return;
        stateStore.delete(ruleId, key);
      }),
    );
  }

  /**
   * Set Data Store references on the jail for the bootstrap script.
   * Provides `db.write()`, `db.query()`, `db.get()`, `db.set()`, `db.delete()`, `db.collections()`
   * via host-side callbacks. Only wired when dataStore is provided and enabled.
   */
  private async setDataStoreRefs(
    jail: IvmGlobal,
    ruleId: string,
    scope: AuthorizationScope = { kind: "unrestricted" },
  ): Promise<void> {
    if (!ivm) return;

    const dataStore = this.dataStore;

    // Only wire references when DataStore is provided and enabled
    if (!dataStore || !dataStore.isEnabled()) return;

    // Scope gating: a scoped automation may read/write only the collections its
    // owning tab surfaces, and may not use the shared key-value buckets (which
    // have no per-tab ownership model). An unrestricted automation is unconfined.
    const scoped = scope.kind === "scoped";
    const allowedCollections: ReadonlySet<string> =
      scope.kind === "scoped" ? scope.collections : new Set<string>();
    const collectionAllowed = (collection: string): boolean =>
      !scoped || allowedCollections.has(collection);

    // Host-side callback for db.write(collection, payloadJson, optionsJson)
    await jail.set(
      "__dbWriteRef",
      new ivm.Reference(function (collection: string, payloadJson: string, optionsJson: string) {
        if (!collectionAllowed(collection)) {
          logger.warn(
            { ruleId, collection },
            "[sandbox] db.write refused — collection outside automation scope",
          );
          return;
        }
        try {
          const payload = JSON.parse(payloadJson);
          const options = JSON.parse(optionsJson);
          dataStore.write(collection, payload, options);
        } catch (err) {
          logger.error({ ruleId, error: (err as Error).message }, "[sandbox] db.write failed");
        }
      }),
    );

    // Host-side callback for db.query(collection, optionsJson)
    await jail.set(
      "__dbQueryRef",
      new ivm.Reference(function (collection: string, optionsJson: string) {
        if (!collectionAllowed(collection)) {
          logger.warn(
            { ruleId, collection },
            "[sandbox] db.query refused — collection outside automation scope",
          );
          return JSON.stringify({ records: [], total: 0 });
        }
        try {
          const options = JSON.parse(optionsJson);
          const result = dataStore.query(collection, options);
          return JSON.stringify(result);
        } catch (err) {
          logger.error({ ruleId, error: (err as Error).message }, "[sandbox] db.query failed");
          return JSON.stringify({ records: [], total: 0 });
        }
      }),
    );

    // Host-side callback for db.get(bucket, key)
    await jail.set(
      "__dbGetRef",
      new ivm.Reference(function (bucket: string, key: string) {
        if (scoped) {
          logger.warn({ ruleId }, "[sandbox] db.get refused — shared buckets are not available to scoped automations");
          return undefined;
        }
        try {
          const result = dataStore.get(bucket, key);
          return result === undefined ? undefined : JSON.stringify(result);
        } catch (err) {
          logger.error({ ruleId, error: (err as Error).message }, "[sandbox] db.get failed");
          return undefined;
        }
      }),
    );

    // Host-side callback for db.set(bucket, key, valueJson)
    await jail.set(
      "__dbSetRef",
      new ivm.Reference(function (bucket: string, key: string, valueJson: string) {
        if (scoped) {
          logger.warn({ ruleId }, "[sandbox] db.set refused — shared buckets are not available to scoped automations");
          return;
        }
        try {
          const value = JSON.parse(valueJson);
          dataStore.set(bucket, key, value);
        } catch (err) {
          logger.error({ ruleId, error: (err as Error).message }, "[sandbox] db.set failed");
        }
      }),
    );

    // Host-side callback for db.delete(bucket, key)
    await jail.set(
      "__dbDeleteRef",
      new ivm.Reference(function (bucket: string, key: string) {
        if (scoped) {
          logger.warn({ ruleId }, "[sandbox] db.delete refused — shared buckets are not available to scoped automations");
          return;
        }
        try {
          dataStore.delete(bucket, key);
        } catch (err) {
          logger.error({ ruleId, error: (err as Error).message }, "[sandbox] db.delete failed");
        }
      }),
    );

    // Host-side callback for db.collections()
    await jail.set(
      "__dbCollectionsRef",
      new ivm.Reference(function () {
        try {
          const result = dataStore.listCollections();
          // A scoped automation sees only the collections its owning tab surfaces.
          const visible = scoped
            ? result.filter((c) => allowedCollections.has(c.name))
            : result;
          return JSON.stringify(visible);
        } catch (err) {
          logger.error({ ruleId, error: (err as Error).message }, "[sandbox] db.collections failed");
          return JSON.stringify([]);
        }
      }),
    );
  }
}

/**
 * Minimal interface for the ivm context global object.
 *
 * The actual type is `ivm.Context["global"]` which returns a `Reference<Record<string, unknown>>`,
 * but since isolated-vm is conditionally imported (may not be available at compile time on all
 * platforms), we define the subset of the API we actually use. All our sandbox methods only call
 * `jail.set(key, value)` to inject references and data into the isolate.
 */
interface IvmGlobal {
  /** Set a named property on the isolate's global object. */
  set(key: string, value: unknown): Promise<void>;
}
