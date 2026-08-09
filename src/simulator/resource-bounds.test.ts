// src/simulator/resource-bounds.test.ts
import { describe, it, expect } from "vitest";
import { TimerBudget } from "./timer-budget.js";
import { createRng } from "./rng.js";

describe("TimerBudget", () => {
  it("grants up to the maximum then refuses", () => {
    const budget = new TimerBudget(2);
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.tryAcquire()).toBe(false);
    expect(budget.activeCount).toBe(2);
  });

  it("frees a slot on release", () => {
    const budget = new TimerBudget(1);
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.tryAcquire()).toBe(false);
    budget.release();
    expect(budget.tryAcquire()).toBe(true);
  });

  it("never underflows below zero", () => {
    const budget = new TimerBudget(1);
    budget.release();
    budget.release();
    expect(budget.activeCount).toBe(0);
  });

  it("coerces a non-positive maximum to at least one", () => {
    expect(new TimerBudget(0).maxCount).toBe(1);
  });
});

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng("reference-water");
    const b = createRng("reference-water");
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    expect(a.next()).not.toBe(b.next());
  });

  it("bounds int() within the inclusive range", () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("bounds float() within [min, max)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.float(1, 2);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThan(2);
    }
  });
});
