// src/automations/shared-state-trigger.test.ts — reactive Shared State dispatch (ADR-0016)
//
// The `shared-state` trigger type has to be a genuinely separate namespace from
// MQTT, not a second reading of the same topic space. Most of what follows is
// about what must NOT happen: an MQTT publish must not be able to impersonate a
// Shared State write, a device rule must not see a Shared State change, and a
// change must not be able to loop forever.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Database as DatabaseType } from "better-sqlite3";
import { AutomationEngine } from "./automation-engine.js";
import { ExecutionGate } from "./execution-gate.js";
import { MAX_EVENT_DEPTH } from "./automation-event-service.js";
import { SHARED_STATE_CHANGE, DEVICE_STATE_CHANGE, AUTOMATION_EVENT } from "../core/event-bus.js";
import { AUTOMATION_EVENT_SCHEMA } from "./automation-event-service.js";
import { newEventMetadata } from "../core/event-metadata.js";
import { SharedStateStore } from "../shared-state/shared-state-store.js";
import { createTestDatabase } from "../__test-helpers__/index.js";
import type { EventContext, NormalizedEvent } from "../core/types.js";
import type { SharedStateChange } from "../shared-state/shared-state-types.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

function change(overrides: Partial<SharedStateChange> = {}): SharedStateChange {
  return {
    bucket: "bunker-summary",
    key: "power",
    value: { battery: 74 },
    deleted: false,
    timestamp: 1_700_000_000_000,
    source: { kind: "automation", id: "rule-producer", executionId: "exec-1" },
    ...overrides,
  };
}

describe("shared-state trigger dispatch", () => {
  let eventBus: EventEmitter;
  let engine: AutomationEngine;

  beforeEach(() => {
    eventBus = new EventEmitter();
    engine = new AutomationEngine(eventBus);
  });

  afterEach(() => engine.dispose());

  describe("only shared-state rules receive a Shared State change", () => {
    it("wakes a shared-state rule whose pattern matches the path", async () => {
      const ran: EventContext[] = [];
      engine.register({
        id: "rule-overview",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: (ctx) => { ran.push(ctx); },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change());
      await settle();

      expect(ran).toHaveLength(1);
      expect(ran[0]!.topic).toBe("bunker-summary/power");
    });

    it("does not wake an mqtt rule, even when its pattern would match the path", async () => {
      // This is the impersonation guard. `bunker-summary/power` is a legal MQTT
      // topic, so without partitioning by trigger type the two namespaces would be
      // interchangeable.
      const ran: string[] = [];
      engine.register({
        id: "rule-mqtt-exact",
        topic: "bunker-summary/power",
        triggerType: "mqtt",
        action: () => { ran.push("exact"); },
      });
      engine.register({
        id: "rule-mqtt-wildcard",
        topic: "bunker-summary/#",
        triggerType: "mqtt",
        action: () => { ran.push("wildcard"); },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change());
      await settle();

      expect(ran).toEqual([]);
    });

    it("does not wake a rule with no explicit trigger type", async () => {
      // An omitted trigger type defaults to mqtt everywhere else, so it must not
      // quietly opt a legacy rule into a new namespace.
      const ran: string[] = [];
      engine.register({ id: "rule-legacy", topic: "bunker-summary/#", action: () => { ran.push("legacy"); } });

      eventBus.emit(SHARED_STATE_CHANGE, change());
      await settle();

      expect(ran).toEqual([]);
    });

    it("does not wake a cron or manual rule", async () => {
      const ran: string[] = [];
      engine.register({ id: "rule-none", topic: "bunker-summary/#", triggerType: "none", action: () => { ran.push("none"); } });

      eventBus.emit(SHARED_STATE_CHANGE, change());
      await settle();

      expect(ran).toEqual([]);
    });
  });

  describe("a shared-state rule is not woken by transport", () => {
    it("ignores a device state change on the same path", async () => {
      const ran: string[] = [];
      engine.register({
        id: "rule-overview",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: () => { ran.push("device"); },
      });

      const event: NormalizedEvent = {
        deviceId: "spoof-1",
        deviceType: "sensor",
        state: { battery: 1 },
        topic: "bunker-summary/power",
        timestamp: Date.now(),
      };
      eventBus.emit(DEVICE_STATE_CHANGE, event);
      await settle();

      expect(ran).toEqual([]);
    });

    it("ignores an Automation Event on the same path", async () => {
      const ran: string[] = [];
      engine.register({
        id: "rule-overview",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: () => { ran.push("event"); },
      });

      eventBus.emit(AUTOMATION_EVENT, {
        topic: "bunker-summary/power",
        envelope: {
          schema: AUTOMATION_EVENT_SCHEMA,
          name: "power",
          payload: { battery: 1 },
          meta: newEventMetadata({ kind: "automation", id: "rule-spoof" }),
        },
      });
      await settle();

      expect(ran).toEqual([]);
    });
  });

  describe("pattern matching over the canonical <bucket>/<key> path", () => {
    async function pathsMatchedBy(pattern: string, changes: Array<[string, string]>): Promise<string[]> {
      const bus = new EventEmitter();
      const local = new AutomationEngine(bus);
      const matched: string[] = [];
      local.register({
        id: "rule-1",
        topic: pattern,
        triggerType: "shared-state",
        action: (ctx) => { matched.push(ctx.topic); },
      });
      for (const [bucket, key] of changes) {
        bus.emit(SHARED_STATE_CHANGE, change({ bucket, key }));
      }
      await settle();
      local.dispose();
      return matched;
    }

    const paths: Array<[string, string]> = [
      ["bunker-summary", "power"],
      ["bunker-summary", "air"],
      ["mine-summary", "power"],
    ];

    it("matches an exact path", async () => {
      expect(await pathsMatchedBy("bunker-summary/power", paths)).toEqual(["bunker-summary/power"]);
    });

    it("matches a bucket-wide multi-level wildcard", async () => {
      expect(await pathsMatchedBy("bunker-summary/#", paths)).toEqual([
        "bunker-summary/power",
        "bunker-summary/air",
      ]);
    });

    it("matches a single-level wildcard in the key position", async () => {
      expect(await pathsMatchedBy("bunker-summary/+", paths)).toEqual([
        "bunker-summary/power",
        "bunker-summary/air",
      ]);
    });

    it("matches a single-level wildcard in the bucket position", async () => {
      expect(await pathsMatchedBy("+/power", paths)).toEqual([
        "bunker-summary/power",
        "mine-summary/power",
      ]);
    });

    it("does not match a different bucket", async () => {
      expect(await pathsMatchedBy("vessel-summary/#", paths)).toEqual([]);
    });
  });

  describe("trigger context tells the truth about what changed", () => {
    it("names the bucket and key rather than inventing a device", async () => {
      let captured: EventContext | undefined;
      engine.register({
        id: "rule-1",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: (ctx) => { captured = ctx; },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change());
      await settle();

      expect(captured!.topic).toBe("bunker-summary/power");
      // No fake device id: a Shared State change is not device state, and authored
      // Logic must be able to tell the difference.
      expect(captured!.deviceId).toBe("");
      expect(captured!.state).toEqual({ battery: 74 });
      expect(captured!.timestamp).toBe(1_700_000_000_000);
      expect(captured!.meta?.sharedState).toEqual({
        bucket: "bunker-summary",
        key: "power",
        deleted: false,
        source: { kind: "automation", id: "rule-producer", executionId: "exec-1" },
      });
    });

    it("wraps a primitive value so state stays an object", async () => {
      let captured: EventContext | undefined;
      engine.register({
        id: "rule-1",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: (ctx) => { captured = ctx; },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change({ value: 74 }));
      await settle();

      // Same convention the Automation Event path uses, rather than a third shape.
      expect(captured!.state).toEqual({ value: 74 });
    });

    it("reports a deletion explicitly instead of as a stored null", async () => {
      const captured: EventContext[] = [];
      engine.register({
        id: "rule-1",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: (ctx) => { captured.push(ctx); },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change({ value: null, deleted: false }));
      eventBus.emit(SHARED_STATE_CHANGE, change({ key: "air", value: undefined, deleted: true }));
      await settle();

      const storedNull = captured.find((c) => c.topic === "bunker-summary/power");
      const removed = captured.find((c) => c.topic === "bunker-summary/air");
      // A legitimately stored null and a removed key must be distinguishable.
      expect(storedNull!.meta?.sharedState?.deleted).toBe(false);
      expect(storedNull!.state).toEqual({ value: null });
      expect(removed!.meta?.sharedState?.deleted).toBe(true);
    });

    it("translates the write source into event provenance", async () => {
      const captured: EventContext[] = [];
      engine.register({
        id: "rule-1",
        topic: "+/#",
        triggerType: "shared-state",
        action: (ctx) => { captured.push(ctx); },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change({ key: "a", source: { kind: "api", userId: "admin-1" } }));
      eventBus.emit(SHARED_STATE_CHANGE, change({ key: "b", source: { kind: "system", id: "seeder" } }));
      await settle();

      // `api` is the Shared State word; `rest` is the event-provenance word. The
      // untranslated source stays available verbatim on meta.sharedState.source.
      const fromApi = captured.find((c) => c.topic === "bunker-summary/a");
      expect(fromApi!.meta?.source).toEqual({ kind: "rest", id: "admin-1" });
      expect(fromApi!.meta?.sharedState?.source).toEqual({ kind: "api", userId: "admin-1" });

      const fromSystem = captured.find((c) => c.topic === "bunker-summary/b");
      expect(fromSystem!.meta?.source).toEqual({ kind: "system", id: "seeder" });
    });

    it("threads traceId and causationId through for correlation", async () => {
      let captured: EventContext | undefined;
      engine.register({
        id: "rule-1",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: (ctx) => { captured = ctx; },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change({ traceId: "trace-1", causationId: "exec-9", depth: 2 }));
      await settle();

      expect(captured!.meta?.traceId).toBe("trace-1");
      expect(captured!.meta?.causationId).toBe("exec-9");
      expect(captured!.meta?.depth).toBe(2);
    });
  });

  describe("causal-depth protection", () => {
    it("dispatches a change within the depth ceiling", async () => {
      const ran: string[] = [];
      engine.register({
        id: "rule-1",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: () => { ran.push("ran"); },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change({ depth: MAX_EVENT_DEPTH }));
      await settle();

      expect(ran).toHaveLength(1);
    });

    it("refuses to dispatch a change past the depth ceiling", async () => {
      // Without this, a shared-state rule that writes Shared State could wake
      // itself forever. The ceiling is shared with Automation Events so one causal
      // budget covers a mixed chain.
      const ran: string[] = [];
      engine.register({
        id: "rule-1",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: () => { ran.push("ran"); },
      });

      eventBus.emit(SHARED_STATE_CHANGE, change({ depth: MAX_EVENT_DEPTH + 1 }));
      await settle();

      expect(ran).toEqual([]);
    });

    it("terminates a self-triggering loop instead of running forever", async () => {
      // An end-to-end version: the rule writes the key it watches, so every
      // execution produces the next change. It must stop.
      const db: DatabaseType = createTestDatabase();
      try {
        const bus = new EventEmitter();
        const store = new SharedStateStore(db, bus);
        const local = new AutomationEngine(bus);
        let runs = 0;

        local.register({
          id: "rule-loop",
          topic: "loop/#",
          triggerType: "shared-state",
          action: (ctx) => {
            runs += 1;
            // Mirror what the sandbox bridge does: one deeper than the change that
            // woke this execution, and always a NEW value so the idempotency
            // shortcut cannot be what stops the loop.
            store.set("loop", "counter", runs, { depth: (ctx.meta?.depth ?? 0) + 1 });
          },
        });

        store.set("loop", "counter", 0, { depth: 1 });
        await new Promise((r) => setTimeout(r, 150));
        local.dispose();

        expect(runs).toBeGreaterThan(0);
        // Bounded by the ceiling rather than by the test's patience.
        expect(runs).toBeLessThanOrEqual(MAX_EVENT_DEPTH + 1);
      } finally {
        db.close();
      }
    });
  });

  describe("automation scope", () => {
    it("denies a scoped automation", async () => {
      // A scoped automation cannot READ Shared State through the sandbox, so waking
      // it with a Shared State value in its context would hand it the very data
      // that boundary withholds.
      const bus = new EventEmitter();
      const scoped = new AutomationEngine(bus, {
        scopeResolver: {
          resolve: () => ({ kind: "scoped", tabId: "t1", deviceIds: new Set<string>(), collections: new Set<string>() }),
        },
      });
      const ran: string[] = [];
      scoped.register({
        id: "rule-scoped",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: () => { ran.push("ran"); },
      });

      bus.emit(SHARED_STATE_CHANGE, change());
      await settle();
      scoped.dispose();

      expect(ran).toEqual([]);
    });

    it("admits an unrestricted automation", async () => {
      const bus = new EventEmitter();
      const unrestricted = new AutomationEngine(bus, {
        scopeResolver: { resolve: () => ({ kind: "unrestricted" }) },
      });
      const ran: string[] = [];
      unrestricted.register({
        id: "rule-admin",
        topic: "bunker-summary/#",
        triggerType: "shared-state",
        action: () => { ran.push("ran"); },
      });

      bus.emit(SHARED_STATE_CHANGE, change());
      await settle();
      unrestricted.dispose();

      expect(ran).toHaveLength(1);
    });
  });
});

describe("keep-latest coalescing for Shared State", () => {
  // Asserted at the gate rather than through the engine, because the requirement
  // is about which pending request survives — which the gate's return status
  // states directly, and a timing-dependent engine test would only imply.

  function busyGate() {
    const gate = new ExecutionGate({ maxActive: 1, maxQueuePerRule: 3 });
    return gate;
  }

  const coalesceKey = (ruleId: string, bucket: string, key: string): string =>
    `shared-state:${ruleId}:${bucket}:${key}`;

  it("runs the first value then the newest, discarding the ones in between", async () => {
    const gate = busyGate();
    const order: number[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });

    const submit = (value: number, blocking = false) =>
      gate.submit({
        ruleId: "rule-overview",
        deviceId: "bunker-summary/power",
        topic: "bunker-summary/power",
        coalesceKey: coalesceKey("rule-overview", "bunker-summary", "power"),
        execute: async () => {
          order.push(value);
          if (blocking) await blocked;
        },
      });

    // Value 1 occupies the only active slot.
    expect(submit(1, true).status).toBe("admitted");
    // 2 queues as the single pending entry; 3 and 4 replace it in place.
    expect(submit(2).status).toBe("queued");
    expect(submit(3).status).toBe("coalesced");
    expect(submit(4).status).toBe("coalesced");

    release();
    await new Promise((r) => setTimeout(r, 20));

    // 1 -> 4. Values 2 and 3 were safely dropped because the durable Shared State
    // key already holds 4; replaying them would project stale truth.
    expect(order).toEqual([1, 4]);
  });

  it("keeps different keys of one bucket independent", async () => {
    const gate = busyGate();
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });

    const submit = (key: string, label: string, blocking = false) =>
      gate.submit({
        ruleId: "rule-overview",
        deviceId: `bunker-summary/${key}`,
        topic: `bunker-summary/${key}`,
        coalesceKey: coalesceKey("rule-overview", "bunker-summary", key),
        execute: async () => {
          order.push(label);
          if (blocking) await blocked;
        },
      });

    expect(submit("power", "power-1", true).status).toBe("admitted");
    expect(submit("air", "air-1").status).toBe("queued");
    // A second power change coalesces with the pending power work, not with air.
    expect(submit("power", "power-2").status).toBe("queued");

    release();
    await new Promise((r) => setTimeout(r, 30));

    // air work is never replaced by power work.
    expect(order).toContain("air-1");
    expect(order).toContain("power-1");
    expect(order).toContain("power-2");
  });

  it("keeps different consumers of one key independent", async () => {
    const gate = new ExecutionGate({ maxActive: 10, maxQueuePerRule: 3 });
    const ran: string[] = [];

    for (const ruleId of ["rule-a", "rule-b"]) {
      gate.submit({
        ruleId,
        deviceId: "bunker-summary/power",
        topic: "bunker-summary/power",
        coalesceKey: coalesceKey(ruleId, "bunker-summary", "power"),
        execute: async () => { ran.push(ruleId); },
      });
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(ran.sort()).toEqual(["rule-a", "rule-b"]);
  });

  it("does not suppress a second key as a duplicate", async () => {
    // The gate's internal dedup key is ruleId:deviceId:topic. Passing the path as
    // `deviceId` is what stops two keys of one bucket sharing a dedup identity —
    // an empty deviceId would make the second key look like a repeat of the first.
    const gate = new ExecutionGate({ maxActive: 10, maxQueuePerRule: 3 });
    const ran: string[] = [];

    for (const key of ["power", "air"]) {
      const result = gate.submit({
        ruleId: "rule-overview",
        deviceId: `bunker-summary/${key}`,
        topic: `bunker-summary/${key}`,
        coalesceKey: coalesceKey("rule-overview", "bunker-summary", key),
        execute: async () => { ran.push(key); },
      });
      expect(result.status).toBe("admitted");
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(ran.sort()).toEqual(["air", "power"]);
  });

  it("leaves real Automation Events discrete rather than coalescing them", async () => {
    // The contrast that matters: an Automation Event omits the coalesce key, so two
    // occurrences on one topic are two executions, not one.
    const gate = new ExecutionGate({ maxActive: 10, maxQueuePerRule: 3 });
    const ran: string[] = [];

    for (const eventId of ["event-1", "event-2", "event-3"]) {
      gate.submit({
        ruleId: "rule-alarm",
        deviceId: eventId,
        topic: "perimeter-breached",
        execute: async () => { ran.push(eventId); },
      });
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(ran).toHaveLength(3);
  });
});

describe("end-to-end: a store write wakes a consumer", () => {
  let db: DatabaseType;

  beforeEach(() => { db = createTestDatabase(); });
  afterEach(() => { db.close(); });

  it("runs the consumer only when the value actually changed", async () => {
    const bus = new EventEmitter();
    const store = new SharedStateStore(db, bus);
    const engine = new AutomationEngine(bus);
    let runs = 0;

    engine.register({
      id: "rule-overview",
      topic: "bunker-summary/#",
      triggerType: "shared-state",
      action: () => { runs += 1; },
    });

    store.set("bunker-summary", "power", { battery: 74 });
    await settle();
    expect(runs).toBe(1);

    // Identical write: no store write, no change, no execution.
    store.set("bunker-summary", "power", { battery: 74 });
    await settle();
    expect(runs).toBe(1);

    store.set("bunker-summary", "power", { battery: 73 });
    await settle();
    expect(runs).toBe(2);

    engine.dispose();
  });

  it("lets the consumer read every subsystem's current value, not just the one that woke it", async () => {
    // The composition pattern: one key changing is a prompt to re-read the current
    // world, not the whole world itself. It is also what gives good restart
    // behaviour — the other subsystems' values are durable and still there.
    const bus = new EventEmitter();
    const store = new SharedStateStore(db, bus);
    const engine = new AutomationEngine(bus);
    const projected: Array<Record<string, unknown>> = [];

    store.set("bunker-summary", "air", { sealed: true });
    store.set("bunker-summary", "comms", { transmitting: false });

    engine.register({
      id: "rule-overview",
      topic: "bunker-summary/#",
      triggerType: "shared-state",
      action: () => {
        projected.push({
          power: store.get("bunker-summary", "power"),
          air: store.get("bunker-summary", "air"),
          comms: store.get("bunker-summary", "comms"),
        });
      },
    });

    store.set("bunker-summary", "power", { battery: 74 });
    await settle();

    expect(projected).toHaveLength(1);
    expect(projected[0]).toEqual({
      power: { battery: 74 },
      air: { sealed: true },
      comms: { transmitting: false },
    });

    engine.dispose();
  });

  it("never reaches a rule watching a different bucket", async () => {
    const bus = new EventEmitter();
    const store = new SharedStateStore(db, bus);
    const engine = new AutomationEngine(bus);
    const ran: string[] = [];

    engine.register({ id: "rule-bunker", topic: "bunker-summary/#", triggerType: "shared-state", action: () => { ran.push("bunker"); } });
    engine.register({ id: "rule-mine", topic: "mine-summary/#", triggerType: "shared-state", action: () => { ran.push("mine"); } });

    store.set("bunker-summary", "power", 1);
    await settle();

    expect(ran).toEqual(["bunker"]);

    engine.dispose();
  });
});

describe("Rule registration", () => {
  it("does not also schedule a shared-state rule that carries a cron expression", async () => {
    // A cron expression on a shared-state rule is meaningless. It must be ignored
    // rather than silently giving the rule a second, scheduled trigger that fires
    // with no Shared State change behind it.
    const bus = new EventEmitter();
    const engine = new AutomationEngine(bus);
    const ran: string[] = [];

    engine.register({
      id: "rule-1",
      topic: "bunker-summary/#",
      triggerType: "shared-state",
      cronExpression: "* * * * * *",
      action: () => { ran.push("ran"); },
    });

    await new Promise((r) => setTimeout(r, 1200));
    engine.dispose();

    expect(ran).toEqual([]);
  });
});
