// src/automations/sandbox.ts — Secure isolated-vm sandbox for user-authored automation scripts

import type { ActionExecutor } from "./action-executor.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { ServiceManager } from "../services/service-manager.js";
import type { Device } from "../core/types.js";
import logger from "../logger.js";

// isolated-vm is a native addon that requires C++ compilation.
// On Windows dev machines it may not compile — graceful fallback logs a warning.
// The actual build happens in Docker on the Raspberry Pi (ARM64).
let ivm: typeof import("isolated-vm") | null = null;
try {
  ivm = await import("isolated-vm");
} catch {
  logger.warn("isolated-vm not available — sandbox execution disabled (expected on Windows dev)");
}

/** Dependencies injected into the Sandbox. */
export interface SandboxDeps {
  actionExecutor: ActionExecutor;
  deviceRegistry: DeviceRegistry;
  serviceManager?: ServiceManager;
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
  var mqttRef = __mqttPublishRef;
  var logInfoRef = __logInfoRef;
  var logWarnRef = __logWarnRef;
  var logErrorRef = __logErrorRef;
  var ctx = __contextData;
  var servicesGetRef = __servicesGetRef;
  var servicesListRef = __servicesListRef;
  var httpGetRef = __httpGetRef;
  var httpPostRef = __httpPostRef;

  globalThis.devices = {
    list: function() { return data; },
    get: function(id) { return map[id]; },
    filter: function(predicate) { return data.filter(predicate); },
    action: function(deviceId, actionType, params) {
      return actionRef.apply(undefined, [deviceId, actionType, params], { result: { promise: true } });
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

  globalThis.services = {
    get: function(serviceType) {
      return servicesGetRef.applySync(undefined, [serviceType]);
    },
    list: function() {
      return servicesListRef.applySync(undefined, []);
    }
  };

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
  delete globalThis.__mqttPublishRef;
  delete globalThis.__logInfoRef;
  delete globalThis.__logWarnRef;
  delete globalThis.__logErrorRef;
  delete globalThis.__contextData;
  delete globalThis.__servicesGetRef;
  delete globalThis.__servicesListRef;
  delete globalThis.__httpGetRef;
  delete globalThis.__httpPostRef;
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
  private serviceManager?: ServiceManager;

  constructor(deps: SandboxDeps) {
    this.actionExecutor = deps.actionExecutor;
    this.deviceRegistry = deps.deviceRegistry;
    this.serviceManager = deps.serviceManager;
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
      await this.setServicesRefs(jail);
      await this.setHttpRefs(jail, ruleId);

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

    // Host-side callback for devices.action()
    const actionExecutor = this.actionExecutor;
    await jail.set(
      "__actionRef",
      new ivm.Reference(function (
        deviceId: string,
        actionType: string,
        params?: Record<string, unknown>,
      ) {
        return actionExecutor.execute(
          { type: "device_action", target: deviceId, params: { actionType, ...(params ?? {}) } },
          ruleId,
        );
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

  /**
   * Set services references on the jail for the bootstrap script.
   * Provides `services.get(type)` and `services.list()` via host-side callbacks.
   */
  private async setServicesRefs(jail: IvmGlobal): Promise<void> {
    if (!ivm) return;

    const serviceManager = this.serviceManager;

    // Host-side callback for services.get(serviceType)
    await jail.set(
      "__servicesGetRef",
      new ivm.Reference(function (serviceType: string) {
        if (!serviceManager) return undefined;
        const instance = serviceManager.getServiceInstance(serviceType);
        const state = instance?.getState?.();
        if (state === undefined) return undefined;
        return new ivm.ExternalCopy(state).copyInto();
      }),
    );

    // Host-side callback for services.list()
    await jail.set(
      "__servicesListRef",
      new ivm.Reference(function () {
        if (!serviceManager) return new ivm.ExternalCopy([]).copyInto();
        const enabled = serviceManager.listEnabled();
        const list = enabled.map((s) => ({
          type: s.serviceType,
          displayName: s.displayName,
          running: s.health.status === "running",
        }));
        return new ivm.ExternalCopy(list).copyInto();
      }),
    );
  }

  /** HTTP request timeout in milliseconds. */
  private static readonly HTTP_TIMEOUT_MS = 10_000;

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
}

/**
 * Type alias for the global reference object inside an ivm.Context.
 * Using `any` here because the exact type depends on the ivm version
 * and we can't reference it directly when ivm may not be available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IvmGlobal = any;
