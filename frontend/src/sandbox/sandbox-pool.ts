// frontend/src/sandbox/sandbox-pool.ts — Bounded LRU registry of live sandbox frames
//
// On Raspberry-Pi-class hardware the number of concurrently-live sandbox iframes
// must be capped (Requirement 7.3). This module-level singleton tracks live frames
// in least-recently-used order and evicts the LRU frame when a new acquisition
// would exceed the cap. Eviction invokes a teardown callback supplied by the host
// hook (which unregisters the broker entry and removes the iframe). Releasing a
// frame leaves no registration behind (Requirement 7.4).

/** Default maximum number of concurrently-live sandbox frames. */
export const SANDBOX_POOL_CAP = 4;

interface PoolEntry {
  frameId: string;
  /** Tears down the frame: broker.unregister + iframe removal + host status update. */
  teardown: () => void;
}

export class SandboxPool {
  private readonly cap: number;
  /** Insertion/access order encodes recency: first = least recently used. */
  private readonly entries = new Map<string, PoolEntry>();

  constructor(cap: number = SANDBOX_POOL_CAP) {
    this.cap = Math.max(1, cap);
  }

  /** Number of currently-live frames. */
  get size(): number {
    return this.entries.size;
  }

  has(frameId: string): boolean {
    return this.entries.has(frameId);
  }

  /** Frame ids in LRU order (least → most recently used). */
  liveFrameIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Register a newly-acquired frame. If this pushes the pool over its cap, the
   * least-recently-used OTHER frame is evicted (its teardown is invoked) until
   * the pool is within the cap.
   */
  acquire(frameId: string, teardown: () => void): void {
    // Re-acquiring an existing id refreshes recency and replaces its teardown.
    if (this.entries.has(frameId)) {
      this.entries.delete(frameId);
    }
    this.entries.set(frameId, { frameId, teardown });

    // Evict LRU others until within cap.
    while (this.entries.size > this.cap) {
      const lruId = this.entries.keys().next().value as string | undefined;
      if (lruId === undefined || lruId === frameId) break;
      this.evict(lruId);
    }
  }

  /** Mark a frame as most-recently-used. */
  touch(frameId: string): void {
    const entry = this.entries.get(frameId);
    if (!entry) return;
    this.entries.delete(frameId);
    this.entries.set(frameId, entry);
  }

  /** Remove a frame from the pool without invoking its teardown (host-driven unmount). */
  release(frameId: string): void {
    this.entries.delete(frameId);
  }

  /** Evict a frame: run its teardown, then remove it from the pool. */
  private evict(frameId: string): void {
    const entry = this.entries.get(frameId);
    if (!entry) return;
    this.entries.delete(frameId);
    try {
      entry.teardown();
    } catch {
      // Teardown must never throw into the pool; swallow to keep the pool consistent.
    }
  }

  /** Test/support helper: evict everything. */
  clear(): void {
    for (const frameId of Array.from(this.entries.keys())) {
      this.evict(frameId);
    }
  }
}

/** Shared singleton pool used by all sandbox hosts in the dashboard. */
export const sandboxPool = new SandboxPool();
