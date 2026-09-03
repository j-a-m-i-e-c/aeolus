// src/simulator/state-controller.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Logger } from "pino";
import { DeviceStateController } from "./state-controller.js";
import { TimerBudget } from "./timer-budget.js";

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

describe("DeviceStateController transitions", () => {
  function makeBudgetController(max: number) {
    const published: Published[] = [];
    const budget = new TimerBudget(max);
    const controller = new DeviceStateController<{ level: number; on?: boolean }>({
      key: "dev",
      stateTopic: "sensor/dev",
      initialState: { level: 0 },
      retainState: false,
      maxDelayMs: 15000,
      publish: (topic, payload, options) => published.push({ topic, payload, options }),
      logger: stubLogger(),
      timerBudget: budget,
    });
    return { controller, published, budget };
  }

  function levels(published: Published[]): number[] {
    return published.map((entry) => (JSON.parse(entry.payload) as { level: number }).level);
  }

  it("publishes one patch per step and reaches the target", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController();

    controller.transition({
      durationMs: 400,
      steps: 4,
      frame: (progress) => ({ level: 10 + progress * 40 }),
    });

    expect(published).toHaveLength(0);
    vi.advanceTimersByTime(400);

    expect(levels(published)).toEqual([20, 30, 40, 50]);
    expect(controller.read().level).toBe(50);
  });

  it("ends exactly on the target rather than near it", () => {
    // progress reaches exactly 1 on the final step, so a movement never stops a
    // rounding error short of the state it claims to have reached.
    vi.useFakeTimers();
    const { controller } = makeController();

    controller.transition({ durationMs: 300, steps: 3, frame: (progress) => ({ level: progress * 100 }) });
    vi.advanceTimersByTime(300);

    expect(controller.read().level).toBe(100);
  });

  it("holds only one timer at a time regardless of step count", () => {
    // A long movement must not cost one budget slot per step.
    vi.useFakeTimers();
    const { controller, budget } = makeBudgetController(4);

    controller.transition({ durationMs: 500, steps: 50, frame: (progress) => ({ level: progress }) });

    expect(budget.activeCount).toBe(1);
    vi.advanceTimersByTime(200);
    expect(budget.activeCount).toBe(1);
  });

  it("runs longer than a single delay may, by chaining clamped steps", () => {
    // maxDelayMs caps one wait; a transition composes many, so a 60s movement is
    // expressible even though no individual delay could be that long.
    vi.useFakeTimers();
    const { controller, published } = makeController({ maxDelayMs: 1000 });

    controller.transition({
      durationMs: 60_000,
      steps: 60,
      frame: (progress) => ({ level: progress * 60 }),
    });

    vi.advanceTimersByTime(30_000);
    expect(published.length).toBe(30);
    vi.advanceTimersByTime(30_000);
    expect(controller.read().level).toBe(60);
  });

  it("releases its budget slot when it completes", () => {
    vi.useFakeTimers();
    const { controller, budget } = makeBudgetController(2);

    controller.transition({ durationMs: 100, steps: 2, frame: (progress) => ({ level: progress }) });
    expect(budget.activeCount).toBe(1);

    vi.advanceTimersByTime(100);
    expect(budget.activeCount).toBe(0);
    expect(controller.activeTransitionCount).toBe(0);
  });

  it("stops publishing once cancelled and reports it did not complete", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController();
    const settled: boolean[] = [];

    const running = controller.transition({
      durationMs: 400,
      steps: 4,
      frame: (progress) => ({ level: progress * 100 }),
      onSettled: (completed) => settled.push(completed),
    });

    vi.advanceTimersByTime(200);
    const publishedBeforeCancel = published.length;
    running.cancel();
    vi.advanceTimersByTime(1000);

    expect(published.length).toBe(publishedBeforeCancel);
    expect(running.settled).toBe(true);
    expect(settled).toEqual([false]);
  });

  it("treats a repeated cancel as a no-op", () => {
    vi.useFakeTimers();
    const { controller } = makeController();
    const settled: boolean[] = [];

    const running = controller.transition({
      durationMs: 100,
      steps: 2,
      frame: () => ({ level: 1 }),
      onSettled: (completed) => settled.push(completed),
    });
    running.cancel();
    running.cancel();

    expect(settled).toEqual([false]);
  });

  it("replaces a running transition in the same group", () => {
    // A repeated interaction should supersede its own animation, not race it.
    vi.useFakeTimers();
    const { controller } = makeController();

    controller.transition({ durationMs: 400, steps: 4, group: "drink", frame: () => ({ level: 1 }) });
    controller.transition({ durationMs: 400, steps: 4, group: "drink", frame: () => ({ level: 99 }) });

    expect(controller.activeTransitionCount).toBe(1);
    vi.advanceTimersByTime(400);
    expect(controller.read().level).toBe(99);
  });

  it("leaves other groups running when one group is cancelled", () => {
    // Resetting one domain must not disturb the rest of the simulated site.
    vi.useFakeTimers();
    const { controller } = makeController();

    controller.transition({ durationMs: 400, steps: 4, group: "drink", frame: () => ({ level: 1 }) });
    controller.transition({ durationMs: 400, steps: 4, group: "refill", frame: () => ({ on: true }) });

    expect(controller.cancelTransitions("drink")).toBe(1);
    expect(controller.activeTransitionCount).toBe(1);

    vi.advanceTimersByTime(400);
    expect(controller.read().on).toBe(true);
  });

  it("cancels every group when no group is given", () => {
    vi.useFakeTimers();
    const { controller } = makeController();

    controller.transition({ durationMs: 400, steps: 4, group: "a", frame: () => ({ level: 1 }) });
    controller.transition({ durationMs: 400, steps: 4, group: "b", frame: () => ({ level: 2 }) });
    controller.transition({ durationMs: 400, steps: 4, frame: () => ({ level: 3 }) });

    expect(controller.cancelTransitions()).toBe(3);
    expect(controller.activeTransitionCount).toBe(0);
  });

  it("cancels running transitions on dispose so a scenario cannot leak one", () => {
    vi.useFakeTimers();
    const { controller, published, budget } = makeBudgetController(2);

    controller.transition({ durationMs: 400, steps: 4, frame: (progress) => ({ level: progress }) });
    controller.dispose();
    vi.advanceTimersByTime(1000);

    expect(published).toHaveLength(0);
    expect(budget.activeCount).toBe(0);
  });

  it("refuses to start a transition after dispose", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController();
    controller.dispose();

    const running = controller.transition({ durationMs: 100, steps: 2, frame: () => ({ level: 5 }) });
    vi.advanceTimersByTime(1000);

    expect(running.settled).toBe(true);
    expect(published).toHaveLength(0);
  });

  it("reaches the target immediately when the timer budget is exhausted", () => {
    // Matches how a delayed update degrades: the end state stays correct so an
    // interaction storm cannot grow memory, and only the outcome is published
    // rather than a burst of intermediate steps.
    vi.useFakeTimers();
    const { controller, published, budget } = makeBudgetController(1);
    expect(budget.tryAcquire()).toBe(true);

    const running = controller.transition({
      durationMs: 5000,
      steps: 10,
      frame: (progress) => ({ level: progress * 100 }),
    });

    expect(running.settled).toBe(true);
    expect(controller.read().level).toBe(100);
    expect(published).toHaveLength(1);
    expect(levels(published)).toEqual([100]);
  });

  it("skips a step whose frame returns undefined without ending the transition", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController();

    controller.transition({
      durationMs: 300,
      steps: 3,
      frame: (_progress, index) => (index === 2 ? undefined : { level: index }),
    });
    vi.advanceTimersByTime(300);

    expect(levels(published)).toEqual([1, 3]);
  });

  it("publishes every step by default even when a value repeats", () => {
    // Interpolation can round two neighbouring steps to the same value; treating
    // that as a no-op would stall visible movement.
    vi.useFakeTimers();
    const { controller, published } = makeController();

    controller.transition({ durationMs: 300, steps: 3, frame: () => ({ level: 42 }) });
    vi.advanceTimersByTime(300);

    expect(published).toHaveLength(3);
  });

  it("honours forcePublish: false so unchanged steps are suppressed", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController();

    controller.transition({
      durationMs: 300,
      steps: 3,
      forcePublish: false,
      frame: () => ({ level: 42 }),
    });
    vi.advanceTimersByTime(300);

    expect(published).toHaveLength(1);
  });

  it("treats a non-positive step count as a single step", () => {
    vi.useFakeTimers();
    const { controller, published } = makeController();

    controller.transition({ durationMs: 100, steps: 0, frame: () => ({ level: 7 }) });
    vi.advanceTimersByTime(100);

    expect(controller.read().level).toBe(7);
    expect(published).toHaveLength(1);
  });
});
