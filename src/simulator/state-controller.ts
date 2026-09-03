// src/simulator/state-controller.ts
// phase-2-mqtt-simulator Task 2 — per-device state controller.
//
// Every state mutation for a device flows through one instance so updates are
// applied in call order (deterministic — Req 6.5), identical publishes are
// suppressed (Req 2.9), current-state publications can be retained (Req 2.7),
// and delayed publishes are clamped and cancellable on shutdown (Req 2.10).

import type { Logger } from "pino";
import type { TimerBudget } from "./timer-budget.js";
import type {
  SimulatedState,
  SimulatedStateController,
  StateTransition,
  StateTransitionOptions,
  StateUpdateOptions,
} from "./types.js";

/** A publish sink; the runtime wires this to the simulator MQTT client. */
export type StatePublishFn = (topic: string, payload: string, options: { retain: boolean }) => void;

export interface DeviceStateControllerOptions<TState extends SimulatedState> {
  key: string;
  stateTopic: string;
  initialState: TState;
  /** Retain current-state publications. */
  retainState: boolean;
  /** Upper bound applied to any requested publish delay. */
  maxDelayMs: number;
  publish: StatePublishFn;
  logger: Logger;
  /** Shared cap on outstanding delayed operations. Absent ⇒ unbounded (tests). */
  timerBudget?: TimerBudget;
}

/** Internal bookkeeping for one running transition. */
interface RunningTransition {
  group?: string;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  cancel: () => void;
}

export class DeviceStateController<TState extends SimulatedState = SimulatedState>
  implements SimulatedStateController<TState>
{
  private current: TState;
  private lastPublishedPayload: string | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly transitions = new Set<RunningTransition>();
  private disposed = false;
  private readonly options: DeviceStateControllerOptions<TState>;

  constructor(options: DeviceStateControllerOptions<TState>) {
    this.options = options;
    this.current = { ...options.initialState };
  }

  read(): Readonly<TState> {
    // Defensive shallow copy so a model cannot mutate internal state in place.
    return { ...this.current };
  }

  update(patch: Partial<TState>, options?: StateUpdateOptions): void {
    if (this.disposed) {
      this.options.logger.debug({ key: this.options.key }, "Ignoring state update after dispose");
      return;
    }

    const shouldPublish = options?.publish !== false;
    const force = options?.forcePublish === true;
    const delayMs = this.clampDelay(options?.delayMs);

    if (delayMs > 0) {
      // When the shared timer budget is exhausted, do not schedule another
      // timer — apply immediately so an interaction storm cannot grow memory.
      if (this.options.timerBudget && !this.options.timerBudget.tryAcquire()) {
        this.options.logger.debug({ key: this.options.key }, "Timer budget exhausted; publishing immediately");
        this.applyAndMaybePublish(patch, shouldPublish, force);
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.options.timerBudget?.release();
        if (this.disposed) return;
        this.applyAndMaybePublish(patch, shouldPublish, force);
      }, delayMs);
      (timer as { unref?: () => void }).unref?.();
      this.timers.add(timer);
      return;
    }

    this.applyAndMaybePublish(patch, shouldPublish, force);
  }

  publish(options?: { force?: boolean }): void {
    if (this.disposed) return;
    this.publishState(options?.force === true);
  }

  /**
   * Advance state over time in bounded, cancellable steps.
   *
   * Only one timer is outstanding per transition, so a long movement costs a
   * single budget slot rather than one per step. That is also why `durationMs` may
   * exceed `maxDelayMs`: each step's wait is clamped individually, and the total
   * is reached by chaining them.
   */
  transition(options: StateTransitionOptions<TState>): StateTransition {
    const steps = Math.max(1, Math.floor(options.steps));
    const forcePublish = options.forcePublish !== false;

    // A repeated interaction should replace its own animation, not race it.
    if (options.group) this.cancelTransitions(options.group);

    const running: RunningTransition = {
      ...(options.group ? { group: options.group } : {}),
      timer: null,
      settled: false,
      cancel: () => undefined,
    };

    const settle = (completed: boolean): void => {
      if (running.settled) return;
      running.settled = true;
      if (running.timer !== null) {
        clearTimeout(running.timer);
        running.timer = null;
      }
      this.transitions.delete(running);
      this.options.timerBudget?.release();
      options.onSettled?.(completed);
    };

    running.cancel = () => settle(false);

    const handle: StateTransition = {
      cancel: () => running.cancel(),
      get settled() {
        return running.settled;
      },
    };

    if (this.disposed) {
      this.options.logger.debug({ key: this.options.key }, "Ignoring transition after dispose");
      running.settled = true;
      return handle;
    }

    // When the shared budget is exhausted, do not schedule: apply every frame at
    // once and publish only the final state. The end state stays correct, an
    // interaction storm cannot grow memory, and the operator sees the outcome
    // rather than a burst of intermediate publishes.
    if (this.options.timerBudget && !this.options.timerBudget.tryAcquire()) {
      this.options.logger.debug(
        { key: this.options.key },
        "Timer budget exhausted; applying transition immediately",
      );
      for (let index = 1; index <= steps; index += 1) {
        const patch = options.frame(index / steps, index);
        if (patch) this.current = { ...this.current, ...patch };
      }
      this.publishState(forcePublish);
      running.settled = true;
      options.onSettled?.(true);
      return handle;
    }

    this.transitions.add(running);

    const interval = this.clampDelay(options.durationMs / steps);
    let index = 0;

    const step = (): void => {
      running.timer = null;
      if (this.disposed || running.settled) return;

      index += 1;
      const patch = options.frame(index / steps, index);
      if (patch) this.applyAndMaybePublish(patch, true, forcePublish);

      if (index >= steps) {
        settle(true);
        return;
      }
      schedule();
    };

    const schedule = (): void => {
      // A zero-length step still yields to the event loop, so a transition never
      // blocks the runtime even when a scenario asks for no delay.
      const timer = setTimeout(step, interval);
      (timer as { unref?: () => void }).unref?.();
      running.timer = timer;
    };

    schedule();
    return handle;
  }

  /**
   * Cancel running transitions and report how many were stopped. With a group,
   * only that group is cancelled, so resetting one domain leaves the others
   * running.
   */
  cancelTransitions(group?: string): number {
    let cancelled = 0;
    for (const running of [...this.transitions]) {
      if (group !== undefined && running.group !== group) continue;
      running.cancel();
      cancelled += 1;
    }
    return cancelled;
  }

  /** Number of outstanding delayed publish timers (observability/tests). */
  get pendingTimerCount(): number {
    return this.timers.size;
  }

  /** Number of running transitions (observability/tests). */
  get activeTransitionCount(): number {
    return this.transitions.size;
  }

  /** Cancel all outstanding timers and refuse further updates. */
  dispose(): void {
    this.disposed = true;
    // Transitions first: cancelling releases their budget slots, and a scenario
    // can no longer leak one by forgetting to clear a hand-rolled timer.
    this.cancelTransitions();
    for (const timer of this.timers) {
      clearTimeout(timer);
      this.options.timerBudget?.release();
    }
    this.timers.clear();
  }

  private applyAndMaybePublish(patch: Partial<TState>, shouldPublish: boolean, force: boolean): void {
    this.current = { ...this.current, ...patch };
    if (shouldPublish) {
      this.publishState(force);
    }
  }

  private publishState(force: boolean): void {
    const payload = JSON.stringify(this.current);
    if (!force && payload === this.lastPublishedPayload) {
      this.options.logger.debug({ key: this.options.key }, "Suppressed no-op state publish");
      return;
    }
    this.options.publish(this.options.stateTopic, payload, { retain: this.options.retainState });
    this.lastPublishedPayload = payload;
  }

  private clampDelay(delayMs: number | undefined): number {
    if (delayMs === undefined || Number.isNaN(delayMs) || delayMs <= 0) return 0;
    return Math.min(delayMs, this.options.maxDelayMs);
  }
}
