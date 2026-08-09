// src/simulator/timer-budget.ts
// phase-2-mqtt-simulator Task 5 — a shared cap on outstanding delayed operations.
//
// The public demo is shared, so repeated interactions must not create unbounded
// timers/memory (Req 5.7, 6.3, §6.3). Delayed publishes and ACK delays acquire a
// budget slot; when the budget is exhausted the operation runs immediately
// instead of scheduling another timer.

export class TimerBudget {
  private active = 0;
  private readonly max: number;

  constructor(max: number) {
    this.max = max > 0 ? max : 1;
  }

  /** Reserve a slot. Returns false when the budget is exhausted. */
  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  /** Release a previously acquired slot. */
  release(): void {
    if (this.active > 0) this.active -= 1;
  }

  /** Outstanding acquired slots. */
  get activeCount(): number {
    return this.active;
  }

  /** Configured ceiling. */
  get maxCount(): number {
    return this.max;
  }
}
