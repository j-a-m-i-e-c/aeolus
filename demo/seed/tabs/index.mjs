// demo/seed/tabs/index.mjs — Ordered registry of demo tab modules.
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

// This order is deliberate, not alphabetical and not grouped by domain.
//
// Agriculture leads because it is the clearest demonstration of automating a
// whole physical site. Stage & Show follows immediately so a visitor who arrived
// thinking Aeolus is farm software is corrected on the second tab rather than the
// sixth. The remaining site domains then broaden progressively, and Space sits
// last because it is the one tab driven by real external data instead of the
// simulator, which makes it the odd one out rather than the finale.
export const tabModules = [
  agriculture,
  stageShow,
  wildlife,
  researchVessel,
  undergroundMining,
  escapeRoom,
  offGridBunker,
  space,
];
