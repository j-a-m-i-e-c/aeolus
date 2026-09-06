// src/simulator/scenarios/index.ts
// phase-2-mqtt-simulator — scenario registry. Maps a scenario key (from
// AEOLUS_SIMULATOR_SCENARIOS) to its factory so the runtime can load the
// configured scenarios by name.

import type { SimulatorScenario } from "../types.js";
import { createReferenceWaterScenario, REFERENCE_WATER_SCENARIO_KEY } from "./reference-water.js";
import { createAgricultureScenario, AGRICULTURE_SCENARIO_KEY } from "./agriculture.js";
import { createResearchVesselScenario, RESEARCH_VESSEL_SCENARIO_KEY } from "./research-vessel.js";
import { createUndergroundMiningScenario, UNDERGROUND_MINING_SCENARIO_KEY } from "./underground-mining.js";
import { createWildlifeScenario, WILDLIFE_SCENARIO_KEY } from "./wildlife.js";
import { createStageShowScenario, STAGE_SHOW_SCENARIO_KEY } from "./stage-show.js";
import { createEscapeRoomScenario, ESCAPE_ROOM_SCENARIO_KEY } from "./escape-room.js";
import { createOffGridBunkerScenario, BUNKER_SCENARIO_KEY } from "./off-grid-bunker.js";

const SCENARIO_FACTORIES: Record<string, () => SimulatorScenario> = {
  [REFERENCE_WATER_SCENARIO_KEY]: () => createReferenceWaterScenario(),
  [AGRICULTURE_SCENARIO_KEY]: () => createAgricultureScenario(),
  [RESEARCH_VESSEL_SCENARIO_KEY]: () => createResearchVesselScenario(),
  [UNDERGROUND_MINING_SCENARIO_KEY]: () => createUndergroundMiningScenario(),
  [WILDLIFE_SCENARIO_KEY]: () => createWildlifeScenario(),
  [STAGE_SHOW_SCENARIO_KEY]: () => createStageShowScenario(),
  [ESCAPE_ROOM_SCENARIO_KEY]: () => createEscapeRoomScenario(),
  [BUNKER_SCENARIO_KEY]: () => createOffGridBunkerScenario(),
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

/**
 * The scenarios that make up the public showcase, in tab order.
 *
 * This is the list the simulator runs when AEOLUS_SIMULATOR_SCENARIOS is not set,
 * and it is the ONE place it is written down. It used to be copy-pasted into the
 * Makefile's `sim` target and both compose files, three copies that had to be kept
 * in step by hand whenever a world was added.
 *
 * Deliberately not `knownScenarioKeys()`: that also includes `reference-water`, the
 * minimal fixture the integration harness drives. Loading it alongside the showcase
 * would publish devices no demo tab accounts for.
 */
export const SHOWCASE_SCENARIO_KEYS: readonly string[] = [
  AGRICULTURE_SCENARIO_KEY,
  RESEARCH_VESSEL_SCENARIO_KEY,
  UNDERGROUND_MINING_SCENARIO_KEY,
  WILDLIFE_SCENARIO_KEY,
  STAGE_SHOW_SCENARIO_KEY,
  ESCAPE_ROOM_SCENARIO_KEY,
  BUNKER_SCENARIO_KEY,
];

/**
 * Which scenarios to run: an explicit list if one was given, else the showcase.
 *
 * Naming none used to start a simulator that connected and published nothing, which
 * is never the intent behind switching on a process that is off by default.
 *
 * Used by the simulator entry point only. The runtime deliberately does not apply
 * this, because the integration harness constructs a runtime with no configured
 * scenarios and calls loadScenario() itself — a default any deeper would load the
 * whole showcase on top of the single fixture those tests want.
 */
export function resolveScenarios(configured: readonly string[]): string[] {
  return configured.length > 0 ? [...configured] : [...SHOWCASE_SCENARIO_KEYS];
}
