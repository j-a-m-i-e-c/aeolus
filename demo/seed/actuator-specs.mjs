// demo/seed/actuator-specs.mjs — Registry of simulated-actuator command profiles.
//
// Each per-domain module exports a `*_ACTUATOR_SPECS` array describing the MQTT
// command profile the seeder should configure for that world's actuators, once the
// simulator has published their devices (see simulator-bootstrap.mjs).
//
// This exists for the same reason tabs/index.mjs does: seed.mjs is the orchestrator
// and should not carry a hand-maintained list of every domain. It used to import all
// seven modules and spread them inline at the call site, so adding a world meant
// editing the orchestrator as well as the registry. Now it imports one name.

import { AGRICULTURE_ACTUATOR_SPECS } from "./agriculture-simulator-bootstrap.mjs";
import { RESEARCH_VESSEL_ACTUATOR_SPECS } from "./research-vessel-simulator-bootstrap.mjs";
import { UNDERGROUND_MINING_ACTUATOR_SPECS } from "./underground-mining-simulator-bootstrap.mjs";
import { WILDLIFE_ACTUATOR_SPECS } from "./wildlife-simulator-bootstrap.mjs";
import { STAGE_SHOW_ACTUATOR_SPECS } from "./stage-show-simulator-bootstrap.mjs";
import { ESCAPE_ROOM_ACTUATOR_SPECS } from "./escape-room-simulator-bootstrap.mjs";
import { OFF_GRID_BUNKER_ACTUATOR_SPECS } from "./off-grid-bunker-simulator-bootstrap.mjs";

/**
 * Every simulated actuator the seeder configures, across all showcase worlds.
 *
 * Order is irrelevant — configureSimulatedCommandProfiles waits for each spec's
 * stateTopic independently — so this follows the simulator's scenario order for
 * readability rather than implying a sequence.
 */
export const ALL_ACTUATOR_SPECS = [
  ...AGRICULTURE_ACTUATOR_SPECS,
  ...RESEARCH_VESSEL_ACTUATOR_SPECS,
  ...UNDERGROUND_MINING_ACTUATOR_SPECS,
  ...WILDLIFE_ACTUATOR_SPECS,
  ...STAGE_SHOW_ACTUATOR_SPECS,
  ...ESCAPE_ROOM_ACTUATOR_SPECS,
  ...OFF_GRID_BUNKER_ACTUATOR_SPECS,
];
