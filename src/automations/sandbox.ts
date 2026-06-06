// src/automations/sandbox.ts — Secure isolated-vm sandbox for user-authored automation scripts

import type { ActionExecutor } from "./action-executor.js";
import type { AutomationStateStore } from "./automation-state-store.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { DataStore } from "../data-store/data-store.js";
import type { Device, ActionResult, BulkActionResult } from "../core/types.js";
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

/** Dependencies injected into the Sandbox. */
export interface SandboxDeps {
  actionExecutor: ActionExecutor;
  deviceRegistry: DeviceRegistry;
  stateStore?: AutomationStateStore;
  dataStore?: DataStore;
  onStateChange?: (ruleId: string, key: string, value: unknown) => void;
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

/** Execution timeout in milliseconds. */
const EXECUTION_TIMEOUT_MS = 5000;

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
    action: function(deviceId, actionType, params) {
      return actionRef.apply(undefined, [deviceId, actionType, params], { result: { promise: true } });
    },
    actionAll: function(filter, actionType, params) {
      return actionAllRef.apply(undefined, [filter, actionType, params], { result: { promise: true } });
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

  globalThis.automation = function(config) {
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
    for (var j = 0; j < actions.length; j++) {
      actions[j](globalThis.context);
    }
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
  private actionExecutor: ActionExecutor;
  private deviceRegistry: DeviceRegistry;
  private stateStore?: AutomationStateStore;
  private dataStore?: DataStore;
  private onStateChange?: (ruleId: string, key: string, value: unknown) => void;

  constructor(deps: SandboxDeps) {
    this.actionExecutor = deps.actionExecutor;
    this.deviceRegistry = deps.deviceRegistry;
    this.stateStore = deps.stateStore;
    this.dataStore = deps.dataStore;
    this.onStateChange = deps.onStateChange;
  }

  /** Execute compiled JS in an isolated V8 context. Never throws. */
  async execute(compiledJs: string, context: SandboxContext, ruleId: string): Promise<void> {
    if (!ivm) {
      logger.error({ ruleId }, "Sandbox execution skipped — isolated-vm not available");
      return;
    }

    let isolate: InstanceType<(typeof ivm)["Isolate"]> | null = null;

    try {
      isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_MB });
      const ivmContext = await isolate.createContext();
      const jail = ivmContext.global;

      // Block forbidden globals
      await this.blockForbiddenGlobals(jail);

      // Set raw data and references on the global scope
      await this.setDevicesRefs(jail, ruleId);
      await this.setMqttRefs(jail, ruleId);
      await this.setLogRefs(jail, ruleId);
      await this.setContextData(jail, context);
      await this.setHttpRefs(jail, ruleId);
      await this.setStateRefs(jail, ruleId);
      await this.setDataStoreRefs(jail, ruleId);

      // Run bootstrap to wire up the clean API from the raw refs
      const bootstrap = await isolate.compileScript(BOOTSTRAP_SCRIPT);
      await bootstrap.run(ivmContext);

      // Compile and run user script with timeout
      const script = await isolate.compileScript(compiledJs);
      await script.run(ivmContext, { timeout: EXECUTION_TIMEOUT_MS });
    } catch (err) {
      logger.error(
        { ruleId, error: (err as Error).message },
        `Sandbox execution error for rule ${ruleId}`,
      );
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
  private async setDevicesRefs(jail: IvmGlobal, ruleId: string): Promise<void> {
    if (!ivm) return;

    const allDevices = this.deviceRegistry.getAll();
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
    await jail.set(
      "__actionRef",
      new ivm.Reference(async function (
        deviceId: string,
        actionType: string,
        params?: Record<string, unknown>,
      ): Promise<ActionResult> {
        try {
          const result = await actionExecutor.execute(
            { type: "device_action", target: deviceId, params: { actionType, ...(params ?? {}) } },
            ruleId,
          );
          return result;
        } catch {
          // Should never reach here since execute() never throws, but guard anyway
          return { success: false, error: "Unexpected error in devices.action()" };
        }
      }),
    );

    // Host-side callback for devices.actionAll() — returns BulkActionResult
    // Requirements: 7.1–7.7, 9.2
    const deviceRegistry = this.deviceRegistry;
    await jail.set(
      "__actionAllRef",
      new ivm.Reference(async function (
        filter: (device: Device) => boolean,
        actionType: string,
        params?: Record<string, unknown>,
      ): Promise<BulkActionResult> {
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

        const settled = await Promise.allSettled(
          matched.map((device) =>
            actionExecutor.execute(
              { type: "device_action", target: device.id, params: { actionType, ...(params ?? {}) } },
              ruleId,
            ).then((result): { deviceId: string } & ActionResult => ({ deviceId: device.id, ...result }))
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

  /** Local/private network patterns where plain HTTP is expected. */
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
  private async setDataStoreRefs(jail: IvmGlobal, ruleId: string): Promise<void> {
    if (!ivm) return;

    const dataStore = this.dataStore;

    // Only wire references when DataStore is provided and enabled
    if (!dataStore || !dataStore.isEnabled()) return;

    // Host-side callback for db.write(collection, payloadJson, optionsJson)
    await jail.set(
      "__dbWriteRef",
      new ivm.Reference(function (collection: string, payloadJson: string, optionsJson: string) {
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
          return JSON.stringify(result);
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
