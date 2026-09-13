// Agriculture showcase composition.
//
// The Farm is one operator tab containing four first-class Aeolus automations.
// Each domain owns its own Logic and UI. There is deliberately no hidden
// coordinator automation and no shared in-process state between domains.
//
// A fifth automation records tank history on a schedule. It is headless, because
// recording history is not an operator task — which also shows that an Aeolus
// automation does not have to own a dashboard pane to be useful.

import { waterAutomation } from "./water.mjs";
import { waterHistoryAutomation } from "./water-history.mjs";
import { livestockAutomation } from "./livestock.mjs";
import { troughAutomation } from "./troughs.mjs";
import { energyAutomation } from "./energy.mjs";
import { dataStore } from "./data-store.mjs";

const tab = { id: "tab-agriculture", name: "Agriculture", icon: "sprout" };

// Physical truth is owned by the separate MQTT simulator. The seed no longer
// impersonates Farm hardware by publishing fake device state itself.
const devices = [];

const automations = [
  waterAutomation,
  waterHistoryAutomation,
  livestockAutomation,
  troughAutomation,
  energyAutomation,
];

// The Agriculture tab groups four independent automation worlds. No pane is a
// combined property dashboard and there is deliberately no mixed device grid.
// Each visual surface explains one automation and its own physical domain.
//
// Where those panes sit is in demo/seed/layouts/showcase-layout.json, arranged by hand
// and captured from a running showcase (§7.2). It used to be here as x/y/w/h, which made
// this file the author of the arrangement and meant every reseed overwrote a layout
// someone had tuned on the Pi.

export default { tab, devices, automations, dataStore };
