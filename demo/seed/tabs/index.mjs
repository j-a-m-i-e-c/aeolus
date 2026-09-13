// demo/seed/tabs/index.mjs — Ordered registry of demo tab modules.
//
// Each module exports a default object: { tab, devices, automations, dataStore }.
// Order here is the order tabs appear in the dashboard sidebar.
//
// Pane geometry is deliberately not here. It is arranged by hand on a running showcase
// and captured into demo/seed/layouts/showcase-layout.json (§7.2). Tab ORDER stays in
// this file, because the reasoning below is a decision about how the showcase argues its
// case — not something to be rewritten by a stray drag on the Pi.

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
