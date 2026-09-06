// src/simulator/scenarios/registry.test.ts — the scenario registry's contracts.
//
// SHOWCASE_SCENARIO_KEYS is now the single definition of what the simulator runs by
// default. It used to be copy-pasted into the Makefile and both compose files, where a
// typo only surfaced as a fatal error when a container started — and on the hosted demo
// that means a failed deploy. Here it fails in CI instead.

import { describe, expect, it } from "vitest";
import {
  SHOWCASE_SCENARIO_KEYS,
  createScenario,
  isKnownScenario,
  knownScenarioKeys,
  resolveScenarios,
} from "./index.js";
import { REFERENCE_WATER_SCENARIO_KEY } from "./reference-water.js";

describe("scenario registry", () => {
  it("can build every key it claims to know", () => {
    for (const key of knownScenarioKeys()) {
      expect(createScenario(key), key).toBeDefined();
    }
  });

  it("returns undefined for an unknown key rather than throwing", () => {
    // The runtime turns this into a startup error naming the key, so the registry
    // itself must report absence rather than crash.
    expect(createScenario("no-such-world")).toBeUndefined();
    expect(isKnownScenario("no-such-world")).toBe(false);
  });
});

describe("SHOWCASE_SCENARIO_KEYS", () => {
  it("names only scenarios that actually exist", () => {
    // A typo here would have been a fatal simulator startup error, previously only
    // discoverable by running a container.
    for (const key of SHOWCASE_SCENARIO_KEYS) {
      expect(isKnownScenario(key), key).toBe(true);
    }
  });

  it("covers the seven showcase worlds", () => {
    expect(SHOWCASE_SCENARIO_KEYS).toHaveLength(7);
    expect(new Set(SHOWCASE_SCENARIO_KEYS).size).toBe(7);
  });

  it("excludes the reference fixture", () => {
    // reference-water is the minimal scenario the integration harness drives. It is a
    // known scenario but not part of the showcase: loading it alongside would publish
    // devices no demo tab accounts for, which is why the default is this list rather
    // than knownScenarioKeys().
    expect(isKnownScenario(REFERENCE_WATER_SCENARIO_KEY)).toBe(true);
    expect(SHOWCASE_SCENARIO_KEYS).not.toContain(REFERENCE_WATER_SCENARIO_KEY);
  });

  it("accounts for every known scenario except the fixture", () => {
    // Adding a world without adding it here would leave it out of the demo silently.
    const expected = knownScenarioKeys().filter((key) => key !== REFERENCE_WATER_SCENARIO_KEY);
    expect([...SHOWCASE_SCENARIO_KEYS].sort()).toEqual(expected.sort());
  });
});

describe("resolveScenarios", () => {
  it("falls back to the showcase when nothing is configured", () => {
    // This is what lets the Makefile and both compose files stop naming scenarios.
    expect(resolveScenarios([])).toEqual([...SHOWCASE_SCENARIO_KEYS]);
  });

  it("honours an explicit list, including a single scenario", () => {
    expect(resolveScenarios(["agriculture"])).toEqual(["agriculture"]);
  });

  it("does not fall back for an explicit list that happens to be unknown", () => {
    // The runtime turns an unknown key into a startup error naming it. Silently
    // substituting the showcase would hide the operator's typo instead.
    expect(resolveScenarios(["typo-world"])).toEqual(["typo-world"]);
  });

  it("returns a copy, so a caller cannot mutate the shared default", () => {
    const first = resolveScenarios([]);
    first.push("mutated");
    expect(resolveScenarios([])).toEqual([...SHOWCASE_SCENARIO_KEYS]);
    expect(SHOWCASE_SCENARIO_KEYS).not.toContain("mutated");
  });
});
