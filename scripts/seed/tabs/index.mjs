// scripts/seed/tabs/index.mjs — Ordered registry of demo tab modules.
//
// Each module exports a default object: { tab, devices, automations, panes, dataStore }.
// Order here is the order tabs appear in the dashboard sidebar.

import researchVessel from "./research-vessel.mjs";
import undergroundMining from "./underground-mining.mjs";
import spacecraft from "./spacecraft.mjs";
import escapeRoom from "./escape-room.mjs";
import offGridBunker from "./off-grid-bunker.mjs";

export const tabModules = [
  researchVessel,
  undergroundMining,
  spacecraft,
  escapeRoom,
  offGridBunker,
];
