// src/simulator/state-controller.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Logger } from "pino";
import { DeviceStateController } from "./state-controller.js";

function stubLogger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

interface Published {
  topic: string;
  payload: string;
  options: { retain: boolean };
}

function makeController(overrides?: { retainState?: boolean; maxDelayMs?: number }) {
  const published: Published[] = [];
  const controller = new DeviceStateController<{ level: number; on?: boolean }>({
    key: "dev",
    stateTopic: "sensor/dev",
    initialState: { level: 10 },
    retainState: overrides?.retainState ?? true,
    maxDelayMs: overrides?.maxDelayMs ?? 15000,
    publish: (topic, payload, options) => {
      published.push({ topic, payload, options });
    },
    logger: stubLogger(),
  });
  return { controller, published };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceStateController", () => {
  it("returns a defensive copy that cannot mutate internal state", () => {
    const { controller } = makeController();
    const snapshot = controller.read();
    (snapshot as { level: number }).level = 999;
    expect(controller.read().level).toBe(10);
  });

  it("merges a patch and publishes the resulting state with the retain flag", () => {
    const { controller, published } = makeController();
    controller.update({ level: 25 });
    expect(published).toHaveLength(1);
    expect(published[0].topic).toBe("sensor/dev");
    expect(JSON.parse(published[0].payload)).toEqual({ level: 25 });
    expect(published[0].options.retain).toBe(true);
  });

  it("suppresses an identical publish unless forced", () => {
    const { controller, published } = makeController();
    controller.update({ level: 25 });
    controller.update({ level: 25 }); // identical serialized state -> suppressed
    expect(published).toHaveLength(1);

    controller.publish({ force: true });
    expect(published).toHaveLength(2);
    expect(JSON.parse(published[1].payload)).toEqual({ level: 25 });
  });

  it("merges without publishing when publish is false", () => {
    const { controller, published } = makeController();
    controller.update({ level: 42 }, { publish: false });
    expect(published).toHaveLength(0);
    expect(controller.read().level).toBe(42);
  });

  it("honours a non-retained device", () => {
    const { controller, published } = makeController({ retainState: false });
    controller.update({ level: 1 });
    expect(published[0].options.retain).toBe(false);
  });

  it("delays a publish and clamps the delay to the maximum", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController({ maxDelayMs: 1000 });

    controller.update({ level: 5 }, { delayMs: 60000 }); // clamped to 1000ms
    expect(published).toHaveLength(0);
    expect(controller.pendingTimerCount).toBe(1);

    vi.advanceTimersByTime(999);
    expect(published).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0].payload)).toEqual({ level: 5 });
    expect(controller.pendingTimerCount).toBe(0);
  });

  it("cancels outstanding timers on dispose and ignores later updates", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController();

    controller.update({ level: 7 }, { delayMs: 500 });
    expect(controller.pendingTimerCount).toBe(1);

    controller.dispose();
    expect(controller.pendingTimerCount).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(published).toHaveLength(0);

    controller.update({ level: 8 });
    expect(published).toHaveLength(0);
  });
});
