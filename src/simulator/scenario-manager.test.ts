// src/simulator/scenario-manager.test.ts
import { describe, it, expect } from "vitest";
import type { Logger } from "pino";
import { AUTOMATION_EVENT_SCHEMA } from "../automations/automation-event-service.js";
import { ScenarioManager } from "./scenario-manager.js";
import { SimulatorDeviceRegistry } from "./device-registry.js";
import { FaultController } from "./fault-controller.js";
import type { AnyDeviceDefinition, SimulatorScenario } from "./types.js";

function stubLogger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

interface Captured {
  topic: string;
  payload: string;
}

const HEADER_TANK_TOPIC = "sensor/reference-water/header-tank";

function headerTankDef(): AnyDeviceDefinition {
  return {
    key: "header-tank",
    name: "Header Tank",
    stateTopic: HEADER_TANK_TOPIC,
    initialState: { levelPct: 60 },
    createModel: (ctx) => ({ getState: () => ctx.state.read() }),
  };
}

function referenceScenario(): SimulatorScenario {
  return {
    key: "reference-water",
    devices: [headerTankDef()],
    stimuli: {
      "reference-water.tank-low": (ctx) => {
        ctx.devices.getController("header-tank")?.update({ levelPct: 25, litres: 1250 });
      },
      "reference-water.restricted": (ctx) => {
        if (ctx.stimulus.sourceRuleId !== "rule-allowed") return;
        ctx.devices.getController("header-tank")?.update({ levelPct: 5 });
      },
    },
  };
}

function setup(maxPayloadBytes?: number) {
  const statePublished: Captured[] = [];
  const registry = new SimulatorDeviceRegistry({
    publish: (topic, payload) => statePublished.push({ topic, payload }),
    logger: stubLogger(),
    maxDelayMs: 5000,
  });
  const faults = new FaultController({ maxDelayMs: 5000, logger: stubLogger() });
  const manager = new ScenarioManager({
    registry,
    faults,
    logger: stubLogger(),
    now: () => 1000,
    ...(maxPayloadBytes !== undefined ? { maxPayloadBytes } : {}),
  });
  return { manager, registry, faults, statePublished };
}

function eventBuf(name: string, payload: unknown, opts?: { ruleId?: string }): Buffer {
  const meta = {
    eventId: "evt-1",
    timestamp: 1,
    source: { kind: "automation", ...(opts?.ruleId ? { id: opts.ruleId } : {}) },
    ...(opts?.ruleId ? { ruleId: opts.ruleId } : {}),
    traceId: "evt-1",
    depth: 0,
  };
  return Buffer.from(JSON.stringify({ schema: AUTOMATION_EVENT_SCHEMA, name, payload, meta }));
}

describe("ScenarioManager loading", () => {
  it("registers scenario devices and declares stimuli", () => {
    const { manager, registry } = setup();
    manager.load(referenceScenario());
    expect(registry.get("header-tank")).toBeDefined();
    expect(manager.hasDeclaredStimuli()).toBe(true);
    expect(manager.eventTopicFilter()).toBe("aeolus/events/#");
  });

  it("rejects a scenario declaring an unsafe stimulus event name", () => {
    const { manager } = setup();
    const bad: SimulatorScenario = {
      key: "bad",
      devices: [],
      stimuli: { "has a space": () => undefined },
    };
    expect(() => manager.load(bad)).toThrow(/invalid stimulus event name/i);
  });

  it("recognises reserved Automation Event topics", () => {
    expect(ScenarioManager.isEventTopic("aeolus/events/rule/tank-low")).toBe(true);
    expect(ScenarioManager.isEventTopic("aeolus/events")).toBe(true);
    expect(ScenarioManager.isEventTopic("sensor/x")).toBe(false);
  });
});

describe("ScenarioManager event handling", () => {
  it("routes a declared event into simulator-owned state, published on the device topic", async () => {
    const { manager, statePublished } = setup();
    manager.load(referenceScenario());

    await manager.handleAutomationEvent(
      "aeolus/events/rule-1/reference-water.tank-low",
      eventBuf("reference-water.tank-low", { reason: "demo" }, { ruleId: "rule-1" }),
    );

    expect(statePublished).toHaveLength(1);
    expect(statePublished[0].topic).toBe(HEADER_TANK_TOPIC);
    expect(JSON.parse(statePublished[0].payload)).toEqual({ levelPct: 25, litres: 1250 });
  });

  it("ignores a valid but undeclared event without changing state", async () => {
    const { manager, statePublished } = setup();
    manager.load(referenceScenario());
    await manager.handleAutomationEvent(
      "aeolus/events/rule-1/reference-water.unknown",
      eventBuf("reference-water.unknown", {}),
    );
    expect(statePublished).toHaveLength(0);
  });

  it("ignores a malformed envelope", async () => {
    const { manager, statePublished } = setup();
    manager.load(referenceScenario());
    await manager.handleAutomationEvent("aeolus/events/rule-1/x", Buffer.from("not json"));
    await manager.handleAutomationEvent(
      "aeolus/events/rule-1/x",
      Buffer.from(JSON.stringify({ schema: "wrong.schema", name: "reference-water.tank-low" })),
    );
    expect(statePublished).toHaveLength(0);
  });

  it("ignores an oversized payload", async () => {
    const { manager, statePublished } = setup(50);
    manager.load(referenceScenario());
    await manager.handleAutomationEvent(
      "aeolus/events/rule-1/reference-water.tank-low",
      eventBuf("reference-water.tank-low", { padding: "x".repeat(200) }, { ruleId: "rule-1" }),
    );
    expect(statePublished).toHaveLength(0);
  });

  it("lets a stimulus arm a bounded fault on a device", async () => {
    const { manager, faults } = setup();
    const scenario: SimulatorScenario = {
      key: "reference-water",
      devices: [headerTankDef()],
      stimuli: {
        "reference-water.reject-next": (ctx) => {
          ctx.faults.arm("header-tank", { rejectNext: { reason: "armed by stimulus" } });
        },
      },
    };
    manager.load(scenario);

    await manager.handleAutomationEvent(
      "aeolus/events/rule-1/reference-water.reject-next",
      eventBuf("reference-water.reject-next", {}, { ruleId: "rule-1" }),
    );

    expect(faults.peek("header-tank")?.rejectNext?.reason).toBe("armed by stimulus");
  });

  it("supports optional source-rule restriction inside a handler", async () => {
    const { manager, statePublished } = setup();
    manager.load(referenceScenario());

    // Wrong rule -> ignored by the handler.
    await manager.handleAutomationEvent(
      "aeolus/events/rule-other/reference-water.restricted",
      eventBuf("reference-water.restricted", {}, { ruleId: "rule-other" }),
    );
    expect(statePublished).toHaveLength(0);

    // Allowed rule -> state changes.
    await manager.handleAutomationEvent(
      "aeolus/events/rule-allowed/reference-water.restricted",
      eventBuf("reference-water.restricted", {}, { ruleId: "rule-allowed" }),
    );
    expect(statePublished).toHaveLength(1);
    expect(JSON.parse(statePublished[0].payload)).toMatchObject({ levelPct: 5 });
  });
});
