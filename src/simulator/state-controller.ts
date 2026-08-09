// src/simulator/state-controller.ts
// phase-2-mqtt-simulator Task 2 — per-device state controller.
//
// Every state mutation for a device flows through one instance so updates are
// applied in call order (deterministic — Req 6.5), identical publishes are
// suppressed (Req 2.9), current-state publications can be retained (Req 2.7),
// and delayed publishes are clamped and cancellable on shutdown (Req 2.10).

import type { Logger } from "pino";
import type { TimerBudget } from "./timer-budget.js";
import type { SimulatedState, SimulatedStateController, StateUpdateOptions } from "./types.js";

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

export class DeviceStateController<TState extends SimulatedState = SimulatedState>
  implements SimulatedStateController<TState>
{
  private current: TState;
  private lastPublishedPayload: string | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
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

  /** Number of outstanding delayed publish timers (observability/tests). */
  get pendingTimerCount(): number {
    return this.timers.size;
  }

  /** Cancel all outstanding timers and refuse further updates. */
  dispose(): void {
    this.disposed = true;
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
