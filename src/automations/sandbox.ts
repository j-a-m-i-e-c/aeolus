// src/automations/sandbox.ts — Secure isolated-vm sandbox for user-authored automation scripts

import type { CommandService, ActionDescriptor } from "./command-service.js";
import type { AutomationScopeResolver, AuthorizationScope } from "./automation-scope-resolver.js";
import type { ConfirmationTier } from "./command-lifecycle.js";
import { isConfirmationTier, resolveEffectiveTier } from "./completion-tier.js";
import type { CommandResultCollector } from "./command-result-collector.js";
import type { AutomationStateStore } from "./automation-state-store.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { DataStore } from "../data-store/data-store.js";
import type { Device, ActionResult, BulkActionResult, ConfirmOptions } from "../core/types.js";
import logger from "../logger.js";

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
 * Build a host-side {@link ConfirmOptions} from the pieces threaded across the
 * isolate boundary by the `devices.action` / `devices.actionAll` wrappers.
 *
 * The predicate may arrive either as a native host-callable function or as an
 * isolated-vm `Reference` (depending on how the runtime marshals function
 * arguments), so the wrapper handles both. When it is a Reference, the observed
 * state is copied into the isolate before applying the predicate, mirroring the
 * existing host-callback marshalling.
 *
 * NOTE: the exact function-marshalling behaviour of isolated-vm can only be
 * validated against a native build (Docker/Pi), not the Windows dev box where
 * isolated-vm is unavailable.
 */
function buildConfirmOptions(
  condition: unknown,
  confirmDeviceId?: string,
  confirmTimeoutMs?: number,
): ConfirmOptions | undefined {
  if (typeof condition !== "function" && !isIvmReference(condition)) return undefined;

  let predicate: (state: Record<string, unknown>) => boolean;
  if (isIvmReference(condition)) {
    predicate = (state: Record<string, unknown>): boolean => {
      const arg = ivm ? new ivm.ExternalCopy(state).copyInto() : state;
      return Boolean(condition.applySync(undefined, [arg]));
    };
  } else {
    const fn = condition as (state: Record<string, unknown>) => unknown;
    predicate = (state: Record<string, unknown>): boolean => Boolean(fn(state));
  }

  return {
    condition: predicate,
    ...(typeof confirmDeviceId === "string" ? { deviceId: confirmDeviceId } : {}),
    ...(typeof confirmTimeoutMs === "number" ? { timeoutMs: confirmTimeoutMs } : {}),
  };
}

/** Minimal shape of an isolated-vm Reference we call synchronously. */
interface IvmCallableReference {
  applySync(receiver: unknown, args: unknown[]): unknown;
}

function isIvmReference(value: unknown): value is IvmCallableReference {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { applySync?: unknown }).applySync === "function"
  );
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
 * Apply the script-rule completion-tier gate for one command (Req 5.1–5.6):
 *
 * - a per-call tier that is defined but not a valid `ConfirmationTier` fails
 *   validation (Req 5.5);
 * - with no per-call tier, a rule-level default that is defined but invalid
 *   fails validation (Req 5.6);
 * - otherwise the effective tier is `resolveEffectiveTier(default, perCall, null)`
 *   — a per-call tier overrides the rule-level default, and `undefined` means
 *   "omit `requiredTier`" so the boundary selects highest-available (Req 5.1–5.3).
 *
 * The ceiling is deliberately `null`: the inherited `CommandService` boundary
 * clamps the supplied tier against the device's live capability and never reports
 * an unreached tier, so the script path only hard-fails on a *malformed* value
 * and never pre-omits on a ceiling it cannot see here.
 */
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

export function resolveScriptTier(
  ruleTierDefault: unknown,
  perCallTier: unknown,
): ScriptTierResolution {
  if (perCallTier !== undefined && !isConfirmationTier(perCallTier)) {
    return { ok: false, error: `Invalid completion tier '${describeTierValue(perCallTier)}'` };
  }
  if (perCallTier === undefined && ruleTierDefault !== undefined && !isConfirmationTier(ruleTierDefault)) {
    return { ok: false, error: `Invalid rule-level completion tier '${describeTierValue(ruleTierDefault)}'` };
  }
  return { ok: true, chosen: resolveEffectiveTier(ruleTierDefault, perCallTier, null) };
}

/**
 * Body of the `devices.action()` host callback, extracted so the completion-tier
 * gate can be property-tested without a live isolate. Validates the tier and,
 * on an invalid value, returns a failing {@link ActionResult} WITHOUT calling
 * `execute` (Req 5.5, 5.6); otherwise dispatches through the
 * {@link CommandService} with the resolved tier (per-call overrides the
 * rule-level default; `undefined` ⇒ highest-available).
 */
export async function dispatchScriptAction(
  actionExecutor: Pick<CommandService, "execute">,
  descriptor: ActionDescriptor,
  ruleId: string,
  confirm: ConfirmOptions | undefined,
  ruleTierDefault: unknown,
  perCallTier: unknown,
): Promise<ActionResult> {
  const tier = resolveScriptTier(ruleTierDefault, perCallTier);
  if (!tier.ok) {
    return { success: false, error: tier.error, lifecycleState: "FAILED" };
  }
  return actionExecutor.execute(descriptor, ruleId, confirm, tier.chosen);
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

/**
 * Private/internal network patterns that sandbox HTTP requests are blocked from
 * reaching. Prevents SSRF against LAN services and cloud metadata endpoints.
 *
 * Blocked ranges: localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x
 * (link-local/cloud metadata), [::1], and any hostname resolving to "localhost".
 *
 * Exported for unit testing.
 */
export const BLOCKED_HOSTS = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

/**
 * Returns true if the URL targets a private/internal address that sandbox
 * scripts should not be allowed to reach. Pure helper for SSRF prevention.
 */
export function isBlockedUrl(url: string): boolean {
  return BLOCKED_HOSTS.test(url);
}

/** Dependencies injected into the Sandbox. */
export interface SandboxDeps {
  actionExecutor: CommandService;
  deviceRegistry: DeviceRegistry;
  stateStore?: AutomationStateStore;
  dataStore?: DataStore;
  collector?: CommandResultCollector;
  onStateChange?: (ruleId: string, key: string, value: unknown) => void;
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
 * script only sees `devices`, `mqtt`, `log`, and `context`.
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
  var dbWriteRef = __dbWriteRef;
  var dbQueryRef = __dbQueryRef;
  var dbGetRef = __dbGetRef;
  var dbSetRef = __dbSetRef;
  var dbDeleteRef = __dbDeleteRef;
  var dbCollectionsRef = __dbCollectionsRef;

  globalThis.devices = {
    list: function() { return data; },
    get: function(id) { return map[id]; },
    filter: function(predicate) { return data.filter(predicate); },
    action: function(deviceId, actionType, params, opts) {
      // 3-arg form is preserved byte-for-byte. The 4th options bag may carry a
      // confirm predicate (condition/deviceId/timeoutMs) and/or an optional
      // per-call completion tier, forwarded as the trailing host-callback arg.
      var tier = opts ? opts.tier : undefined;
      var p;
      if (opts && typeof opts.condition === 'function') {
        p = actionRef.apply(undefined,
          [deviceId, actionType, params, opts.condition, opts.deviceId, opts.timeoutMs, tier],
          { result: { promise: true } });
      } else {
        p = actionRef.apply(undefined,
          [deviceId, actionType, params, undefined, undefined, undefined, tier],
          { result: { promise: true } });
      }
      // Record a logical (non-throwing) command failure on an isolate-global flag
      // so automation() can fail-fast without depending on the user action
      // callback returning the ActionResult (Req 11.3, 11.4).
      return p.then(function(result) {
        if (result && result.success === false) { globalThis.__commandFailed = true; }
        return result;
      });
    },
    actionAll: function(filter, actionType, params, opts) {
      var tier = opts ? opts.tier : undefined;
      var p;
      if (opts && typeof opts.condition === 'function') {
        p = actionAllRef.apply(undefined,
          [filter, actionType, params, opts.condition, opts.deviceId, opts.timeoutMs, tier],
          { result: { promise: true } });
      } else {
        p = actionAllRef.apply(undefined,
          [filter, actionType, params, undefined, undefined, undefined, tier],
          { result: { promise: true } });
      }
      // A bulk action is a logical failure when any per-device command failed
      // (Req 11.3, 11.4).
      return p.then(function(result) {
        if (result && result.failed > 0) { globalThis.__commandFailed = true; }
        return result;
      });
    }
  };

  globalThis.mqtt = {
    publish: function(topic, payload) {
      mqttRef.applySync(undefined, [topic, payload]);
    }
  };

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
    globalThis.__commandFailed = false;
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
      if (!continueOnFailure && globalThis.__commandFailed) {
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
})();
`;

/**
 * Executes compiled JavaScript in a secure V8 isolate via `isolated-vm`.
 *
 * Each execution creates a fresh isolate with a 32 MB memory limit and
 * 5-second timeout. The sandbox exposes `devices`, `mqtt`, `log`, and
 * `context` as globals — all other Node.js APIs are inaccessible.
 *
 * Errors are always caught, logged with the rule ID, and never propagated.
 */
export class Sandbox {
  private actionExecutor: CommandService;
  private deviceRegistry: DeviceRegistry;
  private stateStore?: AutomationStateStore;
  private dataStore?: DataStore;
  private collector?: CommandResultCollector;
  private onStateChange?: (ruleId: string, key: string, value: unknown) => void;
  private scopeResolver?: AutomationScopeResolver;

  constructor(deps: SandboxDeps) {
    this.actionExecutor = deps.actionExecutor;
    this.deviceRegistry = deps.deviceRegistry;
    this.stateStore = deps.stateStore;
    this.dataStore = deps.dataStore;
    this.collector = deps.collector;
    this.onStateChange = deps.onStateChange;
    this.scopeResolver = deps.scopeResolver;
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
    ruleTierDefault?: ConfirmationTier,
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

      // Set raw data and references on the global scope
      await this.setDevicesRefs(jail, ruleId, inFlight, ruleTierDefault, scope);
      await this.setMqttRefs(jail, ruleId);
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
      // never-reject contract (Req 11.6) — logical failures are already surfaced via
      // the __commandFailed flag and each ActionResult pushed into the collector.
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
    ruleTierDefault?: ConfirmationTier,
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
    const actionExecutor = this.actionExecutor;
    const collector = this.collector;
    await jail.set(
      "__actionRef",
      new ivm.Reference(function (
        deviceId: string,
        actionType: string,
        params?: Record<string, unknown>,
        condition?: unknown,
        confirmDeviceId?: string,
        confirmTimeoutMs?: number,
        perCallTier?: unknown,
      ): Promise<ActionResult> {
        const run = (async (): Promise<ActionResult> => {
          try {
            const confirm = buildConfirmOptions(condition, confirmDeviceId, confirmTimeoutMs);
            // Completion-tier gate (Req 5.1–5.6): fail-on-invalid before dispatch,
            // otherwise dispatch with the resolved tier (per-call overrides the
            // rule-level default; undefined ⇒ highest-available).
            const result = await dispatchScriptAction(
              actionExecutor,
              { type: "device_action", target: deviceId, params: { actionType, ...(params ?? {}) } },
              ruleId,
              confirm,
              ruleTierDefault,
              perCallTier,
            );
            // Push the Command_Result into the collector for the running executionId
            // (Req 2.4, 4.3, 5.3 — script-path commands aggregated via AsyncLocalStorage)
            collector?.pushCurrent(result);
            return result;
          } catch {
            // Should never reach here since execute() never throws, but guard anyway
            return { success: false, error: "Unexpected error in devices.action()" };
          }
        })();
        // Track the promise so Sandbox.execute() can drain it before resolving,
        // closing the await gap (Req 11.1, 11.2).
        registerInFlight(inFlight, run);
        return run;
      }),
    );

    // Host-side callback for devices.actionAll() — returns BulkActionResult
    // Requirements: 7.1–7.7, 9.2
    const deviceRegistry = this.deviceRegistry;
    await jail.set(
      "__actionAllRef",
      new ivm.Reference(function (
        filter: (device: Device) => boolean,
        actionType: string,
        params?: Record<string, unknown>,
        condition?: unknown,
        confirmDeviceId?: string,
        confirmTimeoutMs?: number,
        perCallTier?: unknown,
      ): Promise<BulkActionResult> {
        const run = (async (): Promise<BulkActionResult> => {
          // Completion-tier gate (Req 5.1–5.6): an invalid per-call or rule-level
          // tier fails validation for the whole call WITHOUT dispatching to any
          // device. Runs before the predicate so no command is issued on failure.
          const tier = resolveScriptTier(ruleTierDefault, perCallTier);
          if (!tier.ok) {
            return {
              total: 0,
              succeeded: 0,
              failed: 0,
              results: [{ deviceId: "", success: false, error: tier.error }],
            };
          }

          // Catch predicate throws
          let matched: Device[];
          try {
            const all = deviceRegistry.getAll();
            matched = all.filter(filter);
          } catch (err) {
            return {
              total: 0,
              succeeded: 0,
              failed: 0,
              results: [{ deviceId: "", success: false, error: (err as Error).message }],
            };
          }

          if (matched.length === 0) {
            return { total: 0, succeeded: 0, failed: 0, results: [] };
          }

          // Each matched device gets its own confirmation (and its own correlationId
          // assigned inside execute()), observing the target device by default. The
          // resolved completion tier applies to every per-device command (Req 5.1–5.4).
          const confirm = buildConfirmOptions(condition, confirmDeviceId, confirmTimeoutMs);

          const settled = await Promise.allSettled(
            matched.map((device) =>
              actionExecutor.execute(
                { type: "device_action", target: device.id, params: { actionType, ...(params ?? {}) } },
                ruleId,
                confirm,
                tier.chosen,
              ).then((result): { deviceId: string } & ActionResult => {
                // Push each per-device Command_Result into the collector
                // (Req 2.4, 4.3, 5.3 — script-path commands aggregated via AsyncLocalStorage)
                collector?.pushCurrent(result);
                return { deviceId: device.id, ...result };
              })
               .catch((err): { deviceId: string } & ActionResult => ({
                 deviceId: device.id,
                 success: false,
                 error: (err as Error).message,
               })),
            ),
          );

          const results = settled.map((s) =>
            s.status === "fulfilled"
              ? s.value
              : { deviceId: "", success: false as const, error: String(s.reason) },
          );

          const succeeded = results.filter((r) => r.success).length;
          const failed = results.length - succeeded;

          return { total: results.length, succeeded, failed, results };
        })();
        // Track the bulk promise so Sandbox.execute() can drain it before
        // resolving, closing the await gap (Req 11.1, 11.2).
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

    const actionExecutor = this.actionExecutor;
    await jail.set(
      "__mqttPublishRef",
      new ivm.Reference(function (topic: string, payload: string) {
        // Fire-and-forget — publish is synchronous from the script's perspective
        void actionExecutor.execute(
          { type: "publish", target: topic, params: { payload } },
          ruleId,
        );
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

  /** HTTP request timeout in milliseconds. */
  private static readonly HTTP_TIMEOUT_MS = 10_000;

  /**
   * Identifies local addresses where plain HTTP is expected (not blocked — these
   * are warnings only for external URLs). See {@link BLOCKED_HOSTS} for the SSRF
   * blocklist.
   */
  private static readonly LOCAL_HOSTS = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i;

  /**
   * Log a warning when plain HTTP is used for non-local URLs.
   * Local/private network addresses (localhost, 10.x, 172.16-31.x, 192.168.x) are fine over HTTP.
   */
  private static warnInsecureUrl(ruleId: string, method: string, url: string): void {
    if (url.startsWith("http://") && !Sandbox.LOCAL_HOSTS.test(url)) {
      logger.warn({ ruleId, method, url }, "[sandbox] Plain HTTP used for external URL — consider using HTTPS");
    }
  }

  /**
   * Set HTTP references on the jail for the bootstrap script.
   * Provides `http.get(url, headers)` and `http.post(url, headers, body)` via host-side callbacks.
   * Requests are made from the host process using `fetch()` with a 10-second timeout.
   */
  private async setHttpRefs(jail: IvmGlobal, ruleId: string): Promise<void> {
    if (!ivm) return;

    const timeoutMs = Sandbox.HTTP_TIMEOUT_MS;

    // Host-side callback for http.get(url, headersJson)
    await jail.set(
      "__httpGetRef",
      new ivm.Reference(async function (url: string, headersJson: string) {
        try {
          if (isBlockedUrl(url)) {
            logger.warn({ ruleId, method: "GET", url }, "[sandbox] HTTP request blocked: private/internal network address");
            return new ivm.ExternalCopy({ status: 0, body: "Request blocked: private/internal network address" }).copyInto();
          }
          Sandbox.warnInsecureUrl(ruleId, "GET", url);
          const headers = JSON.parse(headersJson) as Record<string, string>;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const res = await fetch(url, {
            method: "GET",
            headers,
            signal: controller.signal,
          });
          clearTimeout(timer);
          const body = await res.text();
          return new ivm.ExternalCopy({ status: res.status, body }).copyInto();
        } catch (err) {
          logger.error({ ruleId, url, error: (err as Error).message }, "[sandbox] http.get failed");
          return new ivm.ExternalCopy({ status: 0, body: (err as Error).message }).copyInto();
        }
      }),
    );

    // Host-side callback for http.post(url, headersJson, body)
    await jail.set(
      "__httpPostRef",
      new ivm.Reference(async function (url: string, headersJson: string, body: string) {
        try {
          if (isBlockedUrl(url)) {
            logger.warn({ ruleId, method: "POST", url }, "[sandbox] HTTP request blocked: private/internal network address");
            return new ivm.ExternalCopy({ status: 0, body: "Request blocked: private/internal network address" }).copyInto();
          }
          Sandbox.warnInsecureUrl(ruleId, "POST", url);
          const headers = JSON.parse(headersJson) as Record<string, string>;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: body || undefined,
            signal: controller.signal,
          });
          clearTimeout(timer);
          const responseBody = await res.text();
          return new ivm.ExternalCopy({ status: res.status, body: responseBody }).copyInto();
        } catch (err) {
          logger.error({ ruleId, url, error: (err as Error).message }, "[sandbox] http.post failed");
          return new ivm.ExternalCopy({ status: 0, body: (err as Error).message }).copyInto();
        }
      }),
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
