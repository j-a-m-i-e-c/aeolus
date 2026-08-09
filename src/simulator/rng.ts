// src/simulator/rng.ts
// phase-2-mqtt-simulator Task 5 — deterministic, seedable pseudo-random source.
//
// Scenario telemetry that needs pseudo-random variation uses this so tests are
// reproducible (Req 6.6). It is a small mulberry32 generator — not for anything
// security-sensitive.

export interface DeterministicRng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Next float in [min, max). */
  float(min: number, max: number): number;
}

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Create a deterministic RNG from a string or numeric seed. */
export function createRng(seed: string | number): DeterministicRng {
  let state = (typeof seed === "number" ? seed : hashSeed(seed)) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
  };
}
