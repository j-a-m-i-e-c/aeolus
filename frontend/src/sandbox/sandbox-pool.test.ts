// frontend/src/sandbox/sandbox-pool.test.ts — Property 7 + unit tests for SandboxPool
// Feature: custom-ui-sandboxing, Property 7: Sandbox lifecycle releases resources and respects the pool bound

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { SandboxPool, SANDBOX_POOL_CAP } from "./sandbox-pool";

describe("Feature: custom-ui-sandboxing, Property 7: Sandbox lifecycle releases resources and respects the pool bound", () => {
  it("live frames never exceed the pool cap at any step", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            action: fc.constantFrom("acquire", "release"),
            frameId: fc.stringMatching(/^f[0-9]{1,3}$/),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        fc.integer({ min: 1, max: 6 }),
        (actions, cap) => {
          const pool = new SandboxPool(cap);
          const teardowns = new Map<string, ReturnType<typeof vi.fn>>();

          for (const { action, frameId } of actions) {
            if (action === "acquire") {
              const teardown = vi.fn();
              teardowns.set(frameId, teardown);
              pool.acquire(frameId, teardown);
            } else {
              pool.release(frameId);
            }
            // Invariant: live frames <= cap
            expect(pool.size).toBeLessThanOrEqual(cap);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("unregistered frames leave no registration and have teardown called on eviction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        (cap) => {
          const pool = new SandboxPool(cap);
          const teardowns: Array<ReturnType<typeof vi.fn>> = [];

          // Fill the pool
          for (let i = 0; i < cap; i++) {
            const td = vi.fn();
            teardowns.push(td);
            pool.acquire(`frame-${i}`, td);
          }
          expect(pool.size).toBe(cap);

          // Acquire one more — LRU (frame-0) should be evicted
          const extraTd = vi.fn();
          pool.acquire("frame-extra", extraTd);
          expect(pool.size).toBe(cap);
          expect(pool.has("frame-0")).toBe(false);
          expect(teardowns[0]).toHaveBeenCalledOnce();

          // Release frame-extra
          pool.release("frame-extra");
          expect(pool.has("frame-extra")).toBe(false);
          expect(pool.size).toBe(cap - 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("SandboxPool — unit tests", () => {

  it("default pool can keep a supervisory hero plus four owning automation panes live", () => {
    expect(SANDBOX_POOL_CAP).toBeGreaterThanOrEqual(5);
    const pool = new SandboxPool();
    const teardowns = Array.from({ length: 5 }, () => vi.fn());
    teardowns.forEach((td, index) => pool.acquire(`showcase-${index}`, td));
    expect(pool.size).toBe(5);
    for (const td of teardowns) expect(td).not.toHaveBeenCalled();
  });
  it("touch refreshes recency", () => {
    const pool = new SandboxPool(2);
    const td1 = vi.fn();
    const td2 = vi.fn();
    pool.acquire("a", td1);
    pool.acquire("b", td2);

    // Touch 'a' so it becomes most-recently-used
    pool.touch("a");

    // Acquire 'c' — should evict 'b' (now LRU), not 'a'
    pool.acquire("c", vi.fn());
    expect(pool.has("a")).toBe(true);
    expect(pool.has("b")).toBe(false);
    expect(td2).toHaveBeenCalledOnce();
    expect(td1).not.toHaveBeenCalled();
  });

  it("clear evicts everything", () => {
    const pool = new SandboxPool(3);
    const tds = [vi.fn(), vi.fn(), vi.fn()];
    pool.acquire("a", tds[0]);
    pool.acquire("b", tds[1]);
    pool.acquire("c", tds[2]);

    pool.clear();
    expect(pool.size).toBe(0);
    for (const td of tds) expect(td).toHaveBeenCalledOnce();
  });

  it("re-acquiring same id updates teardown and refreshes", () => {
    const pool = new SandboxPool(2);
    const td1 = vi.fn();
    const td2 = vi.fn();
    pool.acquire("a", td1);
    pool.acquire("a", td2);
    expect(pool.size).toBe(1);

    // Fill + evict — new teardown should be the one called
    pool.acquire("b", vi.fn());
    pool.acquire("c", vi.fn()); // evicts LRU which is 'a' (td2)
    expect(td2).toHaveBeenCalledOnce();
    expect(td1).not.toHaveBeenCalled();
  });
});
