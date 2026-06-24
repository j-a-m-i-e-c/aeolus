// scripts/seed/tabs/index.mjs — Ordered registry of demo tab modules.
//
// Each module exports a default object: { tab, devices, automations, panes, dataStore }.
// Order here is the order tabs appear in the dashboard sidebar.

import smartHome from "./smart-home.mjs";
import researchVessel from "./research-vessel.mjs";
import undergroundMining from "./underground-mining.mjs";
import spacecraft from "./spacecraft.mjs";
import escapeRoom from "./escape-room.mjs";
import offGridBunker from "./off-grid-bunker.mjs";
import agriculture from "./agriculture.mjs";
import space from "./space.mjs";

export const tabModules = [
  smartHome,
  agriculture,
  researchVessel,
  undergroundMining,
  spacecraft,
  escapeRoom,
  offGridBunker,
  space,
];
