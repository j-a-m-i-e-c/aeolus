// src/simulator/scenarios/index.ts
// phase-2-mqtt-simulator — scenario registry. Maps a scenario key (from
// AEOLUS_SIMULATOR_SCENARIOS) to its factory so the runtime can load the
// configured scenarios by name.

import type { SimulatorScenario } from "../types.js";
import { createReferenceWaterScenario, REFERENCE_WATER_SCENARIO_KEY } from "./reference-water.js";
import { createAgricultureScenario, AGRICULTURE_SCENARIO_KEY } from "./agriculture.js";

const SCENARIO_FACTORIES: Record<string, () => SimulatorScenario> = {
  [REFERENCE_WATER_SCENARIO_KEY]: () => createReferenceWaterScenario(),
  [AGRICULTURE_SCENARIO_KEY]: () => createAgricultureScenario(),
};

/** True when a scenario key is known. */
export function isKnownScenario(key: string): boolean {
  return key in SCENARIO_FACTORIES;
}

/** Build a scenario by key, or undefined when unknown. */
export function createScenario(key: string): SimulatorScenario | undefined {
  const factory = SCENARIO_FACTORIES[key];
  return factory ? factory() : undefined;
}

/** All known scenario keys. */
export function knownScenarioKeys(): string[] {
  return Object.keys(SCENARIO_FACTORIES);
}
