// src/automations/execution-gate.ts — Concurrency gate for automation rule executions

import { randomUUID } from "node:crypto";

/**
 * Configuration for the execution gate's capacity limits.
 */
export interface GateConfig {
  /** Maximum number of concurrently active executions (default: 10). */
  maxActive: number;
  /** Maximum queue depth per rule before excess triggers are dropped (default: 3). */
  maxQueuePerRule: number;
}

/**
 * A request to execute an automation rule's action.
 *
 * The `execute` thunk is called when the gate admits the request. The gate does
 * not inspect the thunk's result — it only cares about slot lifecycle.
 */
export interface ExecutionRequest {
  ruleId: string;
  deviceId: string;
  topic: string;
  /** Thunk called when the request is admitted. */
  execute: () => Promise<unknown>;
}

/**
 * The synchronous decision returned by `submit()`.
 */
export type AdmitResult =
  | { status: "admitted"; handle: string }
  | { status: "queued" }
  | { status: "dropped"; reason: "queue_full" }
  | { status: "suppressed"; reason: "duplicate" };

/**
 * Snapshot of the gate's current utilization for observability.
 */
export interface GateStats {
  activeCount: number;
  /** Rule ID → current queue length. */
  queueDepths: Record<string, number>;
}

/**
 * Optional dependency hooks (logging / metrics). Following the same pattern as
 * `PendingCommandTrackerDeps` — no direct logger import.
 */
export interface ExecutionGateDeps {
  onDrop?: (ruleId: string, deviceId: string, topic: string) => void;
  onSuppress?: (ruleId: string, deviceId: string, topic: string) => void;
}

/** Internal bookkeeping for a queued execution. */
interface QueuedEntry {
  request: ExecutionRequest;
  dedupKey: string;
  enqueuedAt: number;
}

/**
 * Pure concurrency-control gate that sits between rule-match evaluation and
 * execution dispatch. Enforces a global active-execution cap, per-rule bounded
 * FIFO queues, drop-on-overflow, and duplicate suppression.
 *
 * The gate is in-memory only — queued/active state is lost on process restart.
 */
export class ExecutionGate {
  private readonly config: GateConfig;
  private readonly deps: ExecutionGateDeps;

  /** handle → metadata for currently active executions. */
  private readonly activeSet = new Map<string, { ruleId: string; dedupKey: string }>();
  /** ruleId → FIFO queue of pending executions. */
  private readonly queues = new Map<string, QueuedEntry[]>();
  /** Set of dedup keys currently active or queued. */
  private readonly dedupKeys = new Set<string>();

  constructor(config?: Partial<GateConfig>, deps: ExecutionGateDeps = {}) {
    this.config = {
      maxActive: config?.maxActive ?? 10,
      maxQueuePerRule: config?.maxQueuePerRule ?? 3,
    };
    this.deps = deps;
  }

  /**
   * Synchronous decision: admit, queue, drop, or suppress an execution request.
   *
   * If admitted, the thunk is started immediately (fire-and-forget). The
   * returned promise is wrapped with a `finally` that calls `complete` to
   * guarantee the slot is freed even on rejection.
   */
  submit(request: ExecutionRequest): AdmitResult {
    const dedupKey = `${request.ruleId}:${request.deviceId}:${request.topic}`;

    // 1. Duplicate suppression — if same key is already active or queued, suppress.
    if (this.dedupKeys.has(dedupKey)) {
      this.deps.onSuppress?.(request.ruleId, request.deviceId, request.topic);
      return { status: "suppressed", reason: "duplicate" };
    }

    // 2. Active capacity available — admit immediately.
    if (this.activeSet.size < this.config.maxActive) {
      return this.admit(request, dedupKey);
    }

    // 3. At capacity — attempt to queue under the rule's limit.
    const queue = this.queues.get(request.ruleId) ?? [];
    if (queue.length >= this.config.maxQueuePerRule) {
      this.deps.onDrop?.(request.ruleId, request.deviceId, request.topic);
      return { status: "dropped", reason: "queue_full" };
    }

    // 4. Enqueue.
    this.dedupKeys.add(dedupKey);
    queue.push({ request, dedupKey, enqueuedAt: Date.now() });
    this.queues.set(request.ruleId, queue);
    return { status: "queued" };
  }

  /**
   * Signal that an active execution has completed. Idempotent — a second call
   * with the same handle is a no-op.
   *
   * After freeing the slot, drains the oldest queued entry (if any) until the
   * active cap is reached or all queues are empty.
   */
  complete(handle: string): void {
    const entry = this.activeSet.get(handle);
    if (!entry) return; // idempotent / stale handle

    this.activeSet.delete(handle);
    this.dedupKeys.delete(entry.dedupKey);

    // Drain queued executions until at capacity or queues exhausted.
    this.drain();
  }

  /**
   * Return current utilization snapshot for health/metrics.
   */
  stats(): GateStats {
    const queueDepths: Record<string, number> = {};
    for (const [ruleId, queue] of this.queues) {
      if (queue.length > 0) {
        queueDepths[ruleId] = queue.length;
      }
    }
    return {
      activeCount: this.activeSet.size,
      queueDepths,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Admit a request: generate a handle, register in the active set and dedup
   * registry, fire the thunk (wrapped to guarantee slot release).
   */
  private admit(request: ExecutionRequest, dedupKey: string): { status: "admitted"; handle: string } {
    const handle = randomUUID();
    this.activeSet.set(handle, { ruleId: request.ruleId, dedupKey });
    this.dedupKeys.add(dedupKey);

    // Fire-and-forget — wrap with finally to guarantee slot release.
    void request.execute().finally(() => this.complete(handle));

    return { status: "admitted", handle };
  }

  /**
   * Promote the oldest queued entry across all rules to active. Repeats until
   * the cap is hit or queues are empty.
   */
  private drain(): void {
    while (this.activeSet.size < this.config.maxActive) {
      const oldest = this.findOldestQueued();
      if (!oldest) break;

      const { entry, ruleId, index } = oldest;
      const queue = this.queues.get(ruleId)!;
      queue.splice(index, 1);

      // Clean up empty queues from the map.
      if (queue.length === 0) {
        this.queues.delete(ruleId);
      }

      // The dedup key is already in the set from when it was enqueued.
      // Admit it as active now.
      const handle = randomUUID();
      this.activeSet.set(handle, { ruleId: entry.request.ruleId, dedupKey: entry.dedupKey });

      // Fire the thunk.
      void entry.request.execute().finally(() => this.complete(handle));
    }
  }

  /**
   * Find the queued entry with the earliest `enqueuedAt` across all rule queues.
   */
  private findOldestQueued(): { entry: QueuedEntry; ruleId: string; index: number } | undefined {
    let oldest: { entry: QueuedEntry; ruleId: string; index: number } | undefined;

    for (const [ruleId, queue] of this.queues) {
      for (let i = 0; i < queue.length; i++) {
        if (!oldest || queue[i].enqueuedAt < oldest.entry.enqueuedAt) {
          oldest = { entry: queue[i], ruleId, index: i };
        }
      }
    }

    return oldest;
  }
}
