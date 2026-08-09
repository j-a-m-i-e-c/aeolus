// src/simulator/device-registry.test.ts
import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "./device-registry.js";
import type { AnyDeviceDefinition, DeviceModelFactoryContext, SimulatedDeviceModel, SimulatedState } from "./types.js";

function stubLogger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

interface Published {
  topic: string;
  payload: string;
  options: { retain: boolean };
}

function makeRegistry() {
  const published: Published[] = [];
  const registry = new SimulatorDeviceRegistry({
    publish: (topic, payload, options) => published.push({ topic, payload, options }),
    logger: stubLogger(),
    maxDelayMs: 15000,
  });
  return { registry, published };
}

/** A trivial model backed by the injected state controller. */
function passiveModel(ctx: DeviceModelFactoryContext<SimulatedState>): SimulatedDeviceModel<SimulatedState> {
  return { getState: () => ctx.state.read() };
}

function sensorDef(key: string, stateTopic: string): AnyDeviceDefinition {
  return { key, name: key, stateTopic, initialState: { value: 1 }, createModel: passiveModel };
}

function actuatorDef(key: string, stateTopic: string, commandTopic: string): AnyDeviceDefinition {
  return { key, name: key, stateTopic, commandTopic, initialState: { on: false }, createModel: passiveModel };
}

describe("SimulatorDeviceRegistry validation", () => {
  it("registers and looks up devices", () => {
    const { registry } = makeRegistry();
    registry.register(sensorDef("a", "sensor/a"));
    registry.register(actuatorDef("b", "switch/b", "switch/b/command"));
    expect(registry.list()).toHaveLength(2);
    expect(registry.get("a")?.definition.name).toBe("a");
    expect(registry.getByCommandTopic("switch/b/command")?.definition.key).toBe("b");
    expect(registry.commandTopicList()).toEqual(["switch/b/command"]);
  });

  it("rejects a missing/empty key", () => {
    const { registry } = makeRegistry();
    expect(() => registry.register(sensorDef("", "sensor/a"))).toThrow(/non-empty key/i);
  });

  it("rejects a duplicate device key", () => {
    const { registry } = makeRegistry();
    registry.register(sensorDef("a", "sensor/a"));
    expect(() => registry.register(sensorDef("a", "sensor/other"))).toThrow(/duplicate/i);
  });

  it("rejects wildcards in a concrete state or command topic", () => {
    const { registry } = makeRegistry();
    expect(() => registry.register(sensorDef("a", "sensor/+"))).toThrow(/wildcard/i);
    expect(() => registry.register(actuatorDef("b", "switch/b", "switch/#"))).toThrow(/wildcard/i);
  });

  it("rejects the reserved Automation Event namespace as a device topic", () => {
    const { registry } = makeRegistry();
    expect(() => registry.register(sensorDef("a", "aeolus/events/rule/thing"))).toThrow(/Automation Event namespace/i);
    expect(() => registry.register(actuatorDef("b", "switch/b", "aeolus/events/x"))).toThrow(
      /Automation Event namespace/i,
    );
  });

  it("rejects a duplicate state topic", () => {
    const { registry } = makeRegistry();
    registry.register(sensorDef("a", "sensor/shared"));
    expect(() => registry.register(sensorDef("b", "sensor/shared"))).toThrow(/already owned/i);
  });

  it("rejects duplicate command-topic ownership", () => {
    const { registry } = makeRegistry();
    registry.register(actuatorDef("a", "switch/a", "cmd/shared"));
    expect(() => registry.register(actuatorDef("b", "switch/b", "cmd/shared"))).toThrow(/already owned/i);
  });

  it("rejects a command topic equal to its own state topic", () => {
    const { registry } = makeRegistry();
    expect(() => registry.register(actuatorDef("a", "switch/a", "switch/a"))).toThrow(/differ from its state topic/i);
  });

  it("rejects a command topic that collides with another device's state topic", () => {
    const { registry } = makeRegistry();
    registry.register(sensorDef("a", "sensor/a"));
    expect(() => registry.register(actuatorDef("b", "switch/b", "sensor/a"))).toThrow(/collides with a state topic/i);
  });

  it("rejects a state topic that collides with another device's command topic", () => {
    const { registry } = makeRegistry();
    registry.register(actuatorDef("a", "switch/a", "cmd/a"));
    expect(() => registry.register(sensorDef("b", "cmd/a"))).toThrow(/collides with a command topic/i);
  });

  it("does not half-register a device whose model factory throws", () => {
    const { registry } = makeRegistry();
    const bad: AnyDeviceDefinition = {
      key: "bad",
      name: "bad",
      stateTopic: "sensor/bad",
      initialState: {},
      createModel: () => {
        throw new Error("boom");
      },
    };
    expect(() => registry.register(bad)).toThrow(/boom/);
    expect(registry.get("bad")).toBeUndefined();
    // The topic must be free for reuse after the failed registration.
    expect(() => registry.register(sensorDef("good", "sensor/bad"))).not.toThrow();
  });
});

describe("SimulatorDeviceRegistry lifecycle", () => {
  it("publishes coherent initial state for every device", () => {
    const { registry, published } = makeRegistry();
    registry.register(sensorDef("a", "sensor/a"));
    registry.register(actuatorDef("b", "switch/b", "switch/b/command"));

    registry.publishAll();

    const topics = published.map((p) => p.topic).sort();
    expect(topics).toEqual(["sensor/a", "switch/b"]);
    expect(published.every((p) => p.options.retain === true)).toBe(true);
  });

  it("disposes models and controllers", async () => {
    const { registry } = makeRegistry();
    const dispose = vi.fn();
    const def: AnyDeviceDefinition = {
      key: "a",
      name: "a",
      stateTopic: "sensor/a",
      initialState: { value: 1 },
      createModel: (ctx) => ({ getState: () => ctx.state.read(), dispose }),
    };
    registry.register(def);
    await registry.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(registry.list()).toHaveLength(0);
  });
});
