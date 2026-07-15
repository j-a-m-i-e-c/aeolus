// src/automations/automation-engine.test.ts — Unit tests for AutomationEngine evaluate dispatch

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { DEVICE_STATE_CHANGE, AUTOMATION_FIRED } from "../core/event-bus.js";
import { AutomationEngine } from "./automation-engine.js";
import type { Rule, NormalizedEvent } from "../core/types.js";
import type { Sandbox } from "./sandbox.js";
import type { ExecutionLog } from "./execution-log.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
    const pushFn = vi.fn();
    const executionLog = { push: pushFn } as unknown as ExecutionLog;

    const engine = new AutomationEngine(eventBus, { sandbox, executionLog });

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
    // Execution should be logged
    expect(pushFn).toHaveBeenCalledOnce();
    expect(pushFn.mock.calls[0][0]).toMatchObject({
      ruleId: "script-rule-1",
      ruleName: "Test Script",
      ruleType: "script",
    });
  });

  it("executes non-script rules directly without Sandbox", async () => {
    const actionFn = vi.fn();
    const pushFn = vi.fn();
    const executionLog = { push: pushFn } as unknown as ExecutionLog;

    const engine = new AutomationEngine(eventBus, { executionLog });

    const rule: Rule = {
      id: "direct-rule-1",
      topic: "home/sensor/temperature",
      name: "Direct Rule",
      action: actionFn,
    };
    engine.register(rule);

    const firedEvents: unknown[] = [];
    eventBus.on(AUTOMATION_FIRED, (e) => firedEvents.push(e));

    eventBus.emit(DEVICE_STATE_CHANGE, makeEvent());

    await new Promise((r) => setTimeout(r, 50));

    expect(actionFn).toHaveBeenCalledOnce();
    expect(actionFn).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "home/sensor/temperature",
        deviceId: "sensor-1",
      }),
    );
    // AUTOMATION_FIRED should be emitted
    expect(firedEvents.length).toBe(1);
    expect(firedEvents[0]).toMatchObject({ ruleId: "direct-rule-1" });
    // Execution logged
    expect(pushFn).toHaveBeenCalledOnce();
    expect(pushFn.mock.calls[0][0]).toMatchObject({
      ruleId: "direct-rule-1",
      ruleType: "form",
    });
  });

  it("records failed script execution in ExecutionLog", async () => {
    const executeFn = vi.fn().mockResolvedValue({ success: false, error: "sandbox boom", reason: "runtime" });
    const sandbox: Sandbox = { execute: executeFn } as unknown as Sandbox;
    const pushFn = vi.fn();
    const executionLog = { push: pushFn } as unknown as ExecutionLog;

    const engine = new AutomationEngine(eventBus, { sandbox, executionLog });

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
    expect(entry.actions[0].success).toBe(false);
    expect(entry.actions[0].error).toBe("sandbox boom");
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
    const pushFn = vi.fn();
    const executionLog = { push: pushFn } as unknown as ExecutionLog;

    const engine = new AutomationEngine(eventBus, { sandbox, executionLog });

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

  describe("cron-triggered rules", () => {
    it("registers a cron rule and starts a timer", () => {
      const pushFn = vi.fn();
      const executionLog = { push: pushFn } as unknown as ExecutionLog;
      const engine = new AutomationEngine(eventBus, { executionLog });

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
      const pushFn = vi.fn();
      const executionLog = { push: pushFn } as unknown as ExecutionLog;
      const engine = new AutomationEngine(eventBus, { executionLog });

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
      expect(entry.actions[0].success).toBe(false);
      expect(entry.actions[0].error).toBe("async boom");
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
});
