// src/automations/automation-engine.branches.test.ts — the engine's refusals.
//
// automation-engine.test.ts covers dispatch working: a matching rule runs, a
// scoped rule is admitted or not, a Shared State change wakes a shared-state rule.
// This file covers the decisions on the other side of those: what the engine does
// when the gate says no, when a condition says no, when a cron expression cannot
// be scheduled, and how provenance is carried when an event arrives with metadata
// rather than without.
//
// The gate rejections matter more than their line count suggests. Each dispatch
// path submits to the gate independently, so "drops are logged, not thrown" is
// four separate promises that were only ever verified on one path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  DEVICE_STATE_CHANGE,
  AUTOMATION_EVENT,
  SHARED_STATE_CHANGE,
} from "../core/event-bus.js";
import { AutomationEngine } from "./automation-engine.js";
import type { Rule, NormalizedEvent, EventContext } from "../core/types.js";
import type { Sandbox } from "./sandbox.js";
import type { SharedStateChange, SharedStateSource } from "../shared-state/shared-state-types.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// node-cron is replaced so a scheduled rule can be fired on demand. The real
// scheduler would need a minute of wall clock to reach the same code, and the
// engine's cron path is about what it builds for the execution, not about
// node-cron's timing.
const cronTasks: Array<{ expression: string; onFire: () => void; stopped: boolean }> = [];
vi.mock("node-cron", () => ({
  default: {
    validate: (expression: string) => expression !== "not a cron expression",
    schedule: (expression: string, onFire: () => void) => {
      const task = { expression, onFire, stopped: false, stop() { this.stopped = true; } };
      cronTasks.push(task as never);
      return task;
    },
  },
}));

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    topic: "home/sensor/temperature",
    name: "Test Rule",
    action: vi.fn(async () => ({ success: true })),
    ...overrides,
  } as Rule;
}

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    deviceId: "sensor-1",
    deviceType: "sensor",
    state: { value: 25 },
    topic: "home/sensor/temperature",
    timestamp: 1000,
    ...overrides,
  };
}

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schema: "aeolus.automation-event.v1",
    name: "farm/water/transfer",
    payload: { litres: 500 },
    meta: {
      eventId: "evt-1",
      timestamp: 1000,
      source: { kind: "automation", id: "rule-source" },
      depth: 1,
    },
    ...overrides,
  } as never;
}

function makeChange(overrides: Partial<SharedStateChange> = {}): SharedStateChange {
  return {
    bucket: "bunker-summary",
    key: "power",
    value: { battery: 74 },
    deleted: false,
    timestamp: 1000,
    source: { kind: "automation", id: "rule-source" },
    ...overrides,
  };
}

/** Wait for the fire-and-forget execution the engine starts on dispatch. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("AutomationEngine — refusals and provenance", () => {
  let eventBus: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    cronTasks.length = 0;
    eventBus = new EventEmitter();
  });

  // ─── Gate rejection on every dispatch path ─────────────────────────────────

  describe("when the execution gate refuses a request", () => {
    /**
     * A gate with no capacity at all. `maxActive: 0` means the first request is
     * already over the active cap and `maxQueuePerRule: 0` leaves nowhere to
     * queue it, so every submission is refused synchronously — no timing.
     */
    const closedGate = { maxActive: 0, maxQueuePerRule: 0 };

    it("does not run a device-state rule, and does not throw", async () => {
      const engine = new AutomationEngine(eventBus, { gateConfig: closedGate });
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ action }));

      expect(() => eventBus.emit(DEVICE_STATE_CHANGE, makeEvent())).not.toThrow();
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("does not run an Automation Event consumer", async () => {
      const engine = new AutomationEngine(eventBus, { gateConfig: closedGate });
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "farm/water/#", action }));

      eventBus.emit(AUTOMATION_EVENT, { topic: "farm/water/transfer", envelope: makeEnvelope() });
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("does not run a Shared State consumer", async () => {
      const engine = new AutomationEngine(eventBus, { gateConfig: closedGate });
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "bunker-summary/#", triggerType: "shared-state", action }));

      eventBus.emit(SHARED_STATE_CHANGE, makeChange());
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("does not run a cron rule when its tick is refused", async () => {
      const engine = new AutomationEngine(eventBus, { gateConfig: closedGate });
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ triggerType: "cron", cronExpression: "* * * * *", action }));

      expect(cronTasks).toHaveLength(1);
      expect(() => cronTasks[0]!.onFire()).not.toThrow();
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("reports a refused manual fire as a failure rather than hanging on a promise", async () => {
      const engine = new AutomationEngine(eventBus, { gateConfig: closedGate });
      engine.register(makeRule());

      const result = await engine.fire("rule-1", {
        topic: "manual",
        deviceId: "manual-fire",
        state: {},
        timestamp: 1000,
      } as EventContext);

      expect(result.success).toBe(false);
      expect(result.failureReason).toContain("Execution gate");
    });

    it("names duplicate suppression separately from a full queue", async () => {
      // One slot, no queue: the first request occupies the gate until its thunk
      // settles, so a second identical discrete request is a duplicate rather
      // than an overflow, and the reported reason has to say which.
      const engine = new AutomationEngine(eventBus, { gateConfig: { maxActive: 1, maxQueuePerRule: 0 } });
      let release: (() => void) | undefined;
      engine.register(
        makeRule({
          action: vi.fn(() => new Promise<never>(() => { /* never settles */ })) as never,
        }),
      );

      const context = { topic: "manual", deviceId: "manual-fire", state: {}, timestamp: 1000 } as EventContext;
      void engine.fire("rule-1", context);
      const second = await engine.fire("rule-1", context);

      expect(second.success).toBe(false);
      expect(second.failureReason).toContain("suppressed (duplicate)");
      release?.();
    });
  });

  // ─── Cron registration ─────────────────────────────────────────────────────

  describe("cron registration", () => {
    it("registers the rule but starts no timer for an expression it cannot schedule", () => {
      const engine = new AutomationEngine(eventBus);
      engine.register(
        makeRule({ triggerType: "cron", cronExpression: "not a cron expression" }),
      );
      expect(cronTasks).toHaveLength(0);
      expect(engine.getRule("rule-1")).toBeDefined();
    });

    it("identifies an unnamed cron rule by id in the topic it fires with", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register({
        id: "rule-unnamed",
        topic: "",
        action,
        triggerType: "cron",
        cronExpression: "* * * * *",
      } as Rule);

      cronTasks[0]!.onFire();
      await settle();
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "cron/rule-unnamed", deviceId: "rule-unnamed" }),
      );
    });

    it("uses the rule name in the cron topic when it has one", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ name: "Nightly Sweep", triggerType: "cron", cronExpression: "* * * * *", action }));

      cronTasks[0]!.onFire();
      await settle();
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ topic: "cron/Nightly Sweep" }));
    });

    it("stops a rule's timer when it is unregistered", () => {
      const engine = new AutomationEngine(eventBus);
      engine.register(makeRule({ triggerType: "cron", cronExpression: "* * * * *" }));
      engine.unregister("rule-1");
      expect((cronTasks[0] as unknown as { stopped: boolean }).stopped).toBe(true);
    });
  });

  // ─── Conditions and patterns on the non-device paths ───────────────────────

  describe("rule selection on the Automation Event path", () => {
    it("ignores an event whose topic the rule's pattern does not claim", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "farm/water/#", action }));

      eventBus.emit(AUTOMATION_EVENT, { topic: "farm/energy/permission", envelope: makeEnvelope() });
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("does not run a rule whose condition rejects the event", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "farm/water/#", condition: () => false, action }));

      eventBus.emit(AUTOMATION_EVENT, { topic: "farm/water/transfer", envelope: makeEnvelope() });
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("runs a rule whose condition accepts the event, passing the envelope payload as state", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "farm/water/#", condition: () => true, action }));

      eventBus.emit(AUTOMATION_EVENT, { topic: "farm/water/transfer", envelope: makeEnvelope() });
      await settle();
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ state: { litres: 500 }, deviceId: "" }));
    });

    it("survives a condition that throws, without running the action", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(
        makeRule({
          topic: "farm/water/#",
          condition: () => { throw new Error("condition boom"); },
          action,
        }),
      );

      expect(() =>
        eventBus.emit(AUTOMATION_EVENT, { topic: "farm/water/transfer", envelope: makeEnvelope() }),
      ).not.toThrow();
      await settle();
      expect(action).not.toHaveBeenCalled();
    });
  });

  describe("rule selection on the Shared State path", () => {
    it("does not run a shared-state rule whose condition rejects the change", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(
        makeRule({ topic: "bunker-summary/#", triggerType: "shared-state", condition: () => false, action }),
      );

      eventBus.emit(SHARED_STATE_CHANGE, makeChange());
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("survives a shared-state condition that throws", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(
        makeRule({
          topic: "bunker-summary/#",
          triggerType: "shared-state",
          condition: () => { throw new Error("condition boom"); },
          action,
        }),
      );

      expect(() => eventBus.emit(SHARED_STATE_CHANGE, makeChange())).not.toThrow();
      await settle();
      expect(action).not.toHaveBeenCalled();
    });

    it("translates an API-sourced write into rest provenance, carrying the user id", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "bunker-summary/#", triggerType: "shared-state", action }));

      const source: SharedStateSource = { kind: "api", userId: "user-7" };
      eventBus.emit(SHARED_STATE_CHANGE, makeChange({ source }));
      await settle();

      const context = action.mock.calls[0]![0] as EventContext;
      expect(context.meta?.source).toEqual({ kind: "rest", id: "user-7" });
      // The untranslated source stays available verbatim.
      expect(context.meta?.sharedState?.source).toEqual(source);
    });

    it("omits the id for an API-sourced write with no user attached", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "bunker-summary/#", triggerType: "shared-state", action }));

      eventBus.emit(SHARED_STATE_CHANGE, makeChange({ source: { kind: "api" } }));
      await settle();

      const context = action.mock.calls[0]![0] as EventContext;
      expect(context.meta?.source).toEqual({ kind: "rest" });
    });

    it("translates a system-sourced write", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "bunker-summary/#", triggerType: "shared-state", action }));

      eventBus.emit(SHARED_STATE_CHANGE, makeChange({ source: { kind: "system", id: "retention" } }));
      await settle();

      const context = action.mock.calls[0]![0] as EventContext;
      expect(context.meta?.source).toEqual({ kind: "system", id: "retention" });
    });
  });

  // ─── Provenance carried into execution ─────────────────────────────────────

  describe("event metadata", () => {
    it("carries a device event's metadata into the rule context", async () => {
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ action }));

      const meta = {
        eventId: "evt-device-1",
        timestamp: 1000,
        source: { kind: "mqtt" as const },
        depth: 0,
      };
      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ meta }));
      await settle();
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ meta }));
    });

    it("gives a script execution the triggering event as its causation", async () => {
      const execute = vi.fn().mockResolvedValue({ success: true });
      const sandbox = { execute } as unknown as Sandbox;
      const engine = new AutomationEngine(eventBus, { sandbox });
      engine.register(makeRule({ compiled_js: "log.info('x');" }));

      eventBus.emit(
        DEVICE_STATE_CHANGE,
        makeEvent({
          meta: { eventId: "evt-cause", timestamp: 1000, source: { kind: "mqtt" as const }, depth: 0 },
        }),
      );
      await settle();

      expect(execute).toHaveBeenCalled();
      const context = execute.mock.calls[0]![1];
      expect(context.meta.eventId).toBe("evt-cause");
    });

    it("runs a rule whose pattern claims everything against an event with no topic", async () => {
      // `#` matches an empty topic, which is the one case where the execution
      // carries no triggering topic to record.
      const engine = new AutomationEngine(eventBus);
      const action = vi.fn(async () => ({ success: true }));
      engine.register(makeRule({ topic: "#", action }));

      eventBus.emit(DEVICE_STATE_CHANGE, makeEvent({ topic: "" }));
      await settle();
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ topic: "" }));
    });
  });

  // ─── Sandbox outcome reporting ─────────────────────────────────────────────

  describe("script execution outcomes", () => {
    it("names the sandbox when it returns no outcome at all", async () => {
      // Sandbox.execute() is documented never to reject, so a missing result is
      // not an error path it reported — it is the sandbox itself having failed to
      // answer, and the reason has to say so rather than blaming the Logic.
      const execute = vi.fn().mockResolvedValue(undefined);
      const sandbox = { execute } as unknown as Sandbox;
      const engine = new AutomationEngine(eventBus, { sandbox });
      engine.register(makeRule({ compiled_js: "boom();" }));

      const result = await engine.fire("rule-1", {
        topic: "manual",
        deviceId: "manual-fire",
        state: {},
        timestamp: 1000,
      } as EventContext);

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe("Sandbox execution failed");
    });

    it("falls back to a generic logic failure when the sandbox fails without naming an error", async () => {
      const execute = vi.fn().mockResolvedValue({ success: false });
      const sandbox = { execute } as unknown as Sandbox;
      const engine = new AutomationEngine(eventBus, { sandbox });
      engine.register(makeRule({ compiled_js: "boom();" }));

      const result = await engine.fire("rule-1", {
        topic: "manual",
        deviceId: "manual-fire",
        state: {},
        timestamp: 1000,
      } as EventContext);

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe("Automation execution logic failed");
    });

    it("prefers the sandbox's own error message when it gives one", async () => {
      const execute = vi.fn().mockResolvedValue({ success: false, error: "ReferenceError: boom is not defined" });
      const sandbox = { execute } as unknown as Sandbox;
      const engine = new AutomationEngine(eventBus, { sandbox });
      engine.register(makeRule({ compiled_js: "boom();" }));

      const result = await engine.fire("rule-1", {
        topic: "manual",
        deviceId: "manual-fire",
        state: {},
        timestamp: 1000,
      } as EventContext);

      expect(result.failureReason).toBe("ReferenceError: boom is not defined");
    });
  });
});
