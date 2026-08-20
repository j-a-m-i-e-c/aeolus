// src/automations/automation-engine.test.ts — Unit tests for AutomationEngine evaluate dispatch

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { DEVICE_STATE_CHANGE, AUTOMATION_FIRED, AUTOMATION_COMPLETED } from "../core/event-bus.js";
import { AutomationEngine } from "./automation-engine.js";
import { ExecutionRecorder } from "./execution-recorder.js";
import { CommandResultCollector } from "./command-result-collector.js";
import type { Rule, NormalizedEvent, ActionResult } from "../core/types.js";
import type { Sandbox } from "./sandbox.js";
import type { ExecutionLog } from "./execution-log.js";
import type { Logger } from "pino";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** Build an engine wired to a spy ExecutionLog through the real Execution_Owner. */
function makeEngine(
  eventBus: EventEmitter,
  opts: {
    sandbox?: Sandbox;
    pushFn?: ReturnType<typeof vi.fn>;
    scopeResolver?: import("./automation-scope-resolver.js").AutomationScopeResolver;
  } = {},
): { engine: AutomationEngine; pushFn: ReturnType<typeof vi.fn> } {
  const pushFn = opts.pushFn ?? vi.fn();
  const executionLog = { push: pushFn } as unknown as ExecutionLog;
  const executionRecorder = new ExecutionRecorder({ eventBus, executionLog, logger: silentLogger });
  const collector = new CommandResultCollector();
  const engine = new AutomationEngine(eventBus, {
    ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
    ...(opts.scopeResolver ? { scopeResolver: opts.scopeResolver } : {}),
    executionRecorder,
    collector,
  });
  return { engine, pushFn };
}

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    deviceId: "sensor-1",
    deviceType: "sensor",
    state: { value: 25 },
    topic: "home/sensor/temperature",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("AutomationEngine", () => {
  let eventBus: EventEmitter;

  beforeEach(() => {
    eventBus = new EventEmitter();
  });

  it("dispatches script rules through Sandbox when compiled_js is present", async () => {
    const executeFn = vi.fn().mockResolvedValue({ success: true });
    const sandbox: Sandbox = { execute: executeFn } as unknown as Sandbox;
    const { engine, pushFn } = makeEngine(eventBus, { sandbox });

    const rule = {
      id: "script-rule-1",
      topic: "home/sensor/temperature",
      name: "Test Script",
      action: vi.fn(),
      compiled_js: 'log.info("hello");',
    };
    engine.register(rule as unknown as Rule);

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());

    // Allow async sandbox execution to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(executeFn).toHaveBeenCalledOnce();
    expect(executeFn).toHaveBeenCalledWith(
      'log.info("hello");',
      expect.objectContaining({
        topic: "home/sensor/temperature",
        deviceId: "sensor-1",
      }),
      "script-rule-1",
    );
    // The rule's own action function should NOT be called for script rules
    expect(rule.action).not.toHaveBeenCalled();
    // Execution should be logged once, via the Execution_Owner
    expect(pushFn).toHaveBeenCalledOnce();
    expect(pushFn.mock.calls[0][0]).toMatchObject({
      ruleId: "script-rule-1",
      ruleName: "Test Script",
      ruleType: "script",
      success: true,
    });
  });

  it("executes non-script rules directly without Sandbox and emits exactly one started + one completed", async () => {
    const actionFn = vi.fn();
    const { engine, pushFn } = makeEngine(eventBus);

    const rule: Rule = {
      id: "direct-rule-1",
      topic: "home/sensor/temperature",
      name: "Direct Rule",
      action: actionFn,
    };
    engine.register(rule);

    const firedEvents: Array<{ executionId: string; ruleId: string }> = [];
    const completedEvents: Array<{ result: { executionId: string; success: boolean } }> = [];
    eventBus.on(AUTOMATION_FIRED, (e) => firedEvents.push(e));
    eventBus.on(AUTOMATION_COMPLETED, (e) => completedEvents.push(e));

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());

    await new Promise((r) => setTimeout(r, 50));

    expect(actionFn).toHaveBeenCalledOnce();
    expect(actionFn).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "home/sensor/temperature",
        deviceId: "sensor-1",
      }),
    );
    // Exactly one AUTOMATION_FIRED (started), carrying the executionId (Req 6.1, 6.4).
    expect(firedEvents.length).toBe(1);
    expect(firedEvents[0]).toMatchObject({ ruleId: "direct-rule-1" });
    expect(typeof firedEvents[0].executionId).toBe("string");
    // Exactly one AUTOMATION_COMPLETED, correlated by executionId (Req 6.2, 6.7).
    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0].result.executionId).toBe(firedEvents[0].executionId);
    expect(completedEvents[0].result.success).toBe(true);
    // Execution logged once
    expect(pushFn).toHaveBeenCalledOnce();
    expect(pushFn.mock.calls[0][0]).toMatchObject({
      ruleId: "direct-rule-1",
      ruleType: "form",
      success: true,
    });
  });

  it("incorporates a form rule's returned Command_Result and records failure when it failed", async () => {
    const failing: ActionResult = { success: false, error: "device offline", lifecycleState: "FAILED" };
    const actionFn = vi.fn().mockResolvedValue(failing);
    const { engine, pushFn } = makeEngine(eventBus);

    const rule: Rule = {
      id: "form-fail",
      topic: "home/sensor/temperature",
      name: "Form Fail",
      action: actionFn,
    };
    engine.register(rule);

    const completedEvents: Array<{ result: { success: boolean; failureReason?: string } }> = [];
    eventBus.on(AUTOMATION_COMPLETED, (e) => completedEvents.push(e));

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());
    await new Promise((r) => setTimeout(r, 50));

    expect(pushFn).toHaveBeenCalledOnce();
    const entry = pushFn.mock.calls[0][0];
    expect(entry.success).toBe(false);
    expect(entry.failureReason).toContain("device offline");
    expect(entry.actions[0]).toMatchObject({ success: false, error: "device offline", lifecycleState: "FAILED" });
    expect(completedEvents[0].result.success).toBe(false);
    expect(completedEvents[0].result.failureReason).toContain("device offline");
  });

  it("records failed script execution in ExecutionLog", async () => {
    const executeFn = vi.fn().mockResolvedValue({ success: false, error: "sandbox boom", reason: "runtime" });
    const sandbox: Sandbox = { execute: executeFn } as unknown as Sandbox;
    const { engine, pushFn } = makeEngine(eventBus, { sandbox });

    const rule = {
      id: "fail-script",
      topic: "home/sensor/temperature",
      name: "Failing Script",
      action: vi.fn(),
      compiled_js: "throw new Error('boom');",
    };
    engine.register(rule as unknown as Rule);

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());

    await new Promise((r) => setTimeout(r, 50));

    expect(pushFn).toHaveBeenCalledOnce();
    const entry = pushFn.mock.calls[0][0];
    expect(entry.ruleId).toBe("fail-script");
    expect(entry.success).toBe(false);
    expect(entry.failureReason).toBe("sandbox boom");
  });

  it("works without optional deps (backward compat)", () => {
    // No deps — should not throw
    const engine = new AutomationEngine(eventBus);

    const actionFn = vi.fn();
    engine.register({
      id: "compat-rule",
      topic: "home/+/temperature",
      action: actionFn,
    });

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());

    expect(actionFn).toHaveBeenCalledOnce();
  });

  it("falls back to direct execution when sandbox is not provided for script rule", () => {
    // No sandbox injected — script rule should fall through to direct action execution
    const actionFn = vi.fn();
    const engine = new AutomationEngine(eventBus);

    const rule = {
      id: "no-sandbox-script",
      topic: "home/sensor/temperature",
      action: actionFn,
      compiled_js: "some code",
    };
    engine.register(rule as unknown as Rule);

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());

    // Without sandbox, it falls back to calling the action directly
    expect(actionFn).toHaveBeenCalledOnce();
  });

  it("records execution duration in the log entry", async () => {
    const executeFn = vi.fn().mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ success: true }), 20)),
    );
    const sandbox: Sandbox = { execute: executeFn } as unknown as Sandbox;
    const { engine, pushFn } = makeEngine(eventBus, { sandbox });

    const rule = {
      id: "timed-rule",
      topic: "home/sensor/temperature",
      name: "Timed",
      action: vi.fn(),
      compiled_js: "/* slow */",
    };
    engine.register(rule as unknown as Rule);

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());

    await new Promise((r) => setTimeout(r, 100));

    expect(pushFn).toHaveBeenCalledOnce();
    const entry = pushFn.mock.calls[0][0];
    expect(entry.duration).toBeGreaterThanOrEqual(15);
    expect(entry.duration).toBeLessThan(500);
  });

  describe("fire()", () => {
    it("resolves with the assembled AutomationExecutionResult", async () => {
      const okResult: ActionResult = { success: true, lifecycleState: "DISPATCHED" };
      const actionFn = vi.fn().mockResolvedValue(okResult);
      const { engine } = makeEngine(eventBus);

      engine.register({ id: "manual-1", topic: "", name: "Manual", action: actionFn });

      const result = await engine.fire("manual-1", {
        topic: "manual/manual-1",
        deviceId: "manual-fire",
        state: {},
        timestamp: Date.now(),
      });

      expect(result.success).toBe(true);
      expect(typeof result.executionId).toBe("string");
      expect(result.commandResults).toEqual([okResult]);
    });

    it("rejects for an unknown rule", async () => {
      const { engine } = makeEngine(eventBus);
      await expect(
        engine.fire("nope", { topic: "x", deviceId: "y", state: {}, timestamp: Date.now() }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("cron-triggered rules", () => {
    it("registers a cron rule and starts a timer", () => {
      const { engine } = makeEngine(eventBus);

      const actionFn = vi.fn();
      const rule: Rule = {
        id: "cron-rule-1",
        topic: "",
        name: "Cron Rule",
        action: actionFn,
        triggerType: "cron",
        cronExpression: "* * * * *",
      };
      engine.register(rule);

      expect(engine.ruleCount).toBe(1);
      engine.dispose();
    });
  });

  describe("unregister", () => {
    it("removes a registered rule", () => {
      const engine = new AutomationEngine(eventBus);
      const rule: Rule = { id: "to-remove", topic: "home/+/temp", action: vi.fn() };
      engine.register(rule);
      expect(engine.ruleCount).toBe(1);
      engine.unregister("to-remove");
      expect(engine.ruleCount).toBe(0);
    });
  });

  describe("dispose", () => {
    it("stops all cron timers", () => {
      const engine = new AutomationEngine(eventBus);
      const rule: Rule = {
        id: "cron-dispose",
        topic: "",
        name: "Cron Dispose",
        action: vi.fn(),
        triggerType: "cron",
        cronExpression: "0 9 * * *",
      };
      engine.register(rule);
      engine.dispose();
      // Should not throw
    });
  });

  describe("async rule action failure", () => {
    it("records failed async direct rule execution", async () => {
      const { engine, pushFn } = makeEngine(eventBus);

      const actionFn = vi.fn().mockRejectedValue(new Error("async boom"));
      const rule: Rule = {
        id: "async-fail",
        topic: "home/sensor/temperature",
        name: "Async Fail",
        action: actionFn,
      };
      engine.register(rule);

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());
      await new Promise((r) => setTimeout(r, 50));

      expect(pushFn).toHaveBeenCalledOnce();
      const entry = pushFn.mock.calls[0][0];
      expect(entry.ruleId).toBe("async-fail");
      expect(entry.success).toBe(false);
      expect(entry.failureReason).toBe("async boom");
    });
  });

  describe("topic matching", () => {
    it("matches multi-level wildcard (#)", () => {
      const engine = new AutomationEngine(eventBus);
      const actionFn = vi.fn();
      engine.register({ id: "hash-rule", topic: "home/#", action: actionFn });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ topic: "home/sensor/temperature" }));
      expect(actionFn).toHaveBeenCalledOnce();
    });

    it("does not match when pattern is longer than topic", () => {
      const engine = new AutomationEngine(eventBus);
      const actionFn = vi.fn();
      engine.register({ id: "long-rule", topic: "home/sensor/temperature/extra", action: actionFn });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ topic: "home/sensor/temperature" }));
      expect(actionFn).not.toHaveBeenCalled();
    });

    it("does not fire rules with empty topic (manual-only)", () => {
      const engine = new AutomationEngine(eventBus);
      const actionFn = vi.fn();
      engine.register({ id: "manual-rule", topic: "", action: actionFn });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());
      expect(actionFn).not.toHaveBeenCalled();
    });
  });

  describe("scope-aware device-event admission (audit Critical 2)", () => {
    type Scope = import("./automation-scope-resolver.js").AuthorizationScope;
    function resolverFor(scopes: Record<string, Scope>) {
      const empty: Scope = { kind: "scoped", tabId: null, deviceIds: new Set(), collections: new Set() };
      return { resolve: (id: string): Scope => scopes[id] ?? empty };
    }

    it("triggers a scoped rule only for in-scope device events", () => {
      const scopeResolver = resolverFor({
        "scoped-1": { kind: "scoped", tabId: "tab-a", deviceIds: new Set(["in-scope"]), collections: new Set() },
      });
      const { engine } = makeEngine(eventBus, { scopeResolver });
      const action = vi.fn();
      engine.register({ id: "scoped-1", topic: "#", action });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ deviceId: "in-scope", topic: "x/y" }));
      expect(action).toHaveBeenCalledOnce();
    });

    it("does not trigger a scoped rule for an out-of-scope device event (broad # subscription)", () => {
      const scopeResolver = resolverFor({
        "scoped-1": { kind: "scoped", tabId: "tab-a", deviceIds: new Set(["in-scope"]), collections: new Set() },
      });
      const { engine } = makeEngine(eventBus, { scopeResolver });
      const action = vi.fn();
      engine.register({ id: "scoped-1", topic: "#", action });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ deviceId: "other-device", topic: "x/y" }));
      expect(action).not.toHaveBeenCalled();
    });

    it("triggers an unrestricted rule for any matching device event", () => {
      const scopeResolver = resolverFor({ "unrestricted-1": { kind: "unrestricted" } });
      const { engine } = makeEngine(eventBus, { scopeResolver });
      const action = vi.fn();
      engine.register({ id: "unrestricted-1", topic: "#", action });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ deviceId: "anything", topic: "x/y" }));
      expect(action).toHaveBeenCalledOnce();
    });

    it("does not trigger a scoped rule whose owning tab was deleted (empty scope)", () => {
      const scopeResolver = resolverFor({
        orphan: { kind: "scoped", tabId: null, deviceIds: new Set(), collections: new Set() },
      });
      const { engine } = makeEngine(eventBus, { scopeResolver });
      const action = vi.fn();
      engine.register({ id: "orphan", topic: "#", action });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ deviceId: "any", topic: "x/y" }));
      expect(action).not.toHaveBeenCalled();
    });

    it("admits every matching event when no scope resolver is wired (legacy)", () => {
      const { engine } = makeEngine(eventBus);
      const action = vi.fn();
      engine.register({ id: "legacy", topic: "#", action });

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ deviceId: "whatever", topic: "x/y" }));
      expect(action).toHaveBeenCalledOnce();
    });
  });
});
