// scripts/seed/tabs/index.mjs — Ordered registry of demo tab modules.
//
// Each module exports a default object: { tab, devices, automations, panes, dataStore }.
// Order here is the order tabs appear in the dashboard sidebar.

import researchVessel from "./research-vessel.mjs";
import undergroundMining from "./underground-mining.mjs";
import escapeRoom from "./escape-room.mjs";
import stageShow from "./stage-show.mjs";
import offGridBunker from "./off-grid-bunker.mjs";
import agriculture from "./agriculture.mjs";
import wildlife from "./wildlife.mjs";
import space from "./space.mjs";

export const tabModules = [
  agriculture,
  wildlife,
  researchVessel,
  undergroundMining,
  escapeRoom,
  stageShow,
  offGridBunker,
  space,
];
