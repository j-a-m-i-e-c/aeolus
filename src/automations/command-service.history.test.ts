// src/automations/command-service.history.test.ts
// phase-1-runtime-foundations Task 3 — command identity + durable history in CommandService.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import {
  CommandService,
  type CommandServiceDeps,
  type ExecutionContextProvider,
  restSource,
  automationSource,
} from "./command-service.js";
import { CommandHistoryStore } from "./command-history-store.js";
import { PendingCommandTracker } from "./pending-command-tracker.js";
import type { AutomationScopeResolver } from "./automation-scope-resolver.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let db: DatabaseType;
let store: CommandHistoryStore;

function baseDeps(overrides?: Partial<CommandServiceDeps>): CommandServiceDeps {
  return {
    mqttService: { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as CommandServiceDeps["mqttService"],
    connectorManager: {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      getAcknowledgementCapability: vi.fn().mockReturnValue(undefined),
    } as unknown as CommandServiceDeps["connectorManager"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as CommandServiceDeps["logger"],
    commandHistoryStore: store,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = new CommandHistoryStore(db);
});

afterEach(() => db.close());

describe("CommandService — commandId assignment", () => {
  it("assigns a commandId to a physical dispatch-only result and persists terminal_at", async () => {
    const svc = new CommandService(baseDeps());
    svc.registerHandler("device_action", async () => ({ success: true }));

    const result = await svc.execute({ type: "device_action", target: "dev-1", params: {} }, restSource());

    expect(result.commandId).toBeDefined();
    expect(result.lifecycleState).toBe("DISPATCHED");

    const rec = store.get(result.commandId!);
    expect(rec?.lifecycleState).toBe("DISPATCHED");
    expect(rec?.effectiveTier).toBe("dispatch");
    expect(rec?.terminalAt).toBeGreaterThan(0);
    expect(rec?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED"]);
  });

  it("assigns a commandId even when no history store is configured", async () => {
    const svc = new CommandService(baseDeps({ commandHistoryStore: undefined }));
    svc.registerHandler("device_action", async () => ({ success: true }));

    const result = await svc.execute({ type: "device_action", target: "dev-1", params: {} }, restSource());
    expect(result.commandId).toBeDefined();
  });

  it.each([
    ["throwing handler", async () => { throw new Error("boom"); }],
    ["explicit failure", async () => ({ success: false, error: "offline" })],
  ])("attaches a commandId and records REQUESTED -> FAILED for a %s", async (_label, handler) => {
    const svc = new CommandService(baseDeps());
    svc.registerHandler("device_action", handler as never);

    const result = await svc.execute({ type: "device_action", target: "dev-1", params: {} }, restSource());
    expect(result.success).toBe(false);
    expect(result.commandId).toBeDefined();

    const rec = store.get(result.commandId!);
    expect(rec?.lifecycleState).toBe("FAILED");
    expect(rec?.terminalAt).toBeGreaterThan(0);
    expect(rec?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "FAILED"]);
  });
});

describe("CommandService — refusals create no record (locked decision 1)", () => {
  it("an unknown action type gets no commandId and no record", async () => {
    const svc = new CommandService(baseDeps());
    const result = await svc.execute({ type: "nope", target: "dev-1", params: {} }, restSource());
    expect(result.commandId).toBeUndefined();
    expect(result.lifecycleState).toBe("FAILED");
    expect(store.list()).toHaveLength(0);
  });

  it("a scope-refused automation command gets no commandId and no record", async () => {
    const scopeResolver: AutomationScopeResolver = {
      resolve: () => ({ kind: "scoped", tabId: "t1", deviceIds: new Set(["allowed"]), collections: new Set() }),
    };
    const svc = new CommandService(baseDeps({ scopeResolver }));
    svc.registerHandler("device_action", async () => ({ success: true }));

    const result = await svc.execute(
      { type: "device_action", target: "forbidden", params: {} },
      automationSource("rule-1"),
    );
    expect(result.failureKind).toBe("unauthorized");
    expect(result.commandId).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });
});

describe("CommandService — raw publish is not a Verified Command (Req 1.9)", () => {
  it("a publish action gets no commandId and creates no command record", async () => {
    const svc = new CommandService(baseDeps());
    svc.registerHandler("publish", async () => undefined);

    const result = await svc.execute({ type: "publish", target: "home/x", params: { payload: "on" } }, restSource());
    expect(result.commandId).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });
});

describe("CommandService — observed-tier durable timeline", () => {
  it("persists REQUESTED -> DISPATCHED -> OBSERVED for a confirmed command", async () => {
    const tracker = new PendingCommandTracker();
    const deviceRegistry = { getById: vi.fn().mockReturnValue({ id: "dev-1" }) };
    const svc = new CommandService(
      baseDeps({
        pendingCommandTracker: tracker,
        deviceRegistry: deviceRegistry as unknown as CommandServiceDeps["deviceRegistry"],
      }),
    );
    svc.registerHandler("device_action", async () => ({ success: true }));

    const promise = svc.execute(
      { type: "device_action", target: "dev-1", params: {} },
      restSource(),
      { condition: (s) => s.on === true, timeoutMs: 5000 },
    );
    await new Promise((r) => setTimeout(r, 10));
    tracker.observeState("dev-1", { on: true });
    const result = await promise;

    expect(result.lifecycleState).toBe("OBSERVED");
    expect(result.commandId).toBeDefined();
    const rec = store.get(result.commandId!);
    expect(rec?.effectiveTier).toBe("observed");
    expect(rec?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED", "OBSERVED"]);
    expect(rec?.correlationId).toBeDefined();
  });
});

describe("CommandService — execution context linkage (design §2.3)", () => {
  it("stamps executionId/causationId from the execution context provider", async () => {
    const executionContext: ExecutionContextProvider = {
      current: () => ({ executionId: "exec-9", causationId: "evt-9" }),
    };
    const svc = new CommandService(baseDeps({ executionContext }));
    svc.registerHandler("device_action", async () => ({ success: true }));

    const result = await svc.execute(
      { type: "device_action", target: "dev-1", params: {} },
      automationSource("rule-7"),
    );
    const rec = store.get(result.commandId!);
    expect(rec?.executionId).toBe("exec-9");
    expect(rec?.causationId).toBe("evt-9");
    expect(rec?.ruleId).toBe("rule-7");
    expect(rec?.sourceKind).toBe("automation");
  });

  it("REST commands carry source metadata without an execution context", async () => {
    const svc = new CommandService(baseDeps());
    svc.registerHandler("device_action", async () => ({ success: true }));

    const result = await svc.execute(
      { type: "device_action", target: "dev-1", params: {} },
      restSource("dashboard"),
    );
    const rec = store.get(result.commandId!);
    expect(rec?.sourceKind).toBe("rest");
    expect(rec?.sourceId).toBe("dashboard");
    expect(rec?.executionId).toBeUndefined();
  });
});
