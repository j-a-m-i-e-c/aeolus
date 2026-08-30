// Agriculture showcase composition.
//
// The Farm is one operator tab containing four first-class Aeolus automations.
// Each domain owns its own Logic and UI. There is deliberately no hidden
// coordinator automation and no shared in-process state between domains.

import { waterAutomation } from "./water.mjs";
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
  livestockAutomation,
  troughAutomation,
  energyAutomation,
];

// The Agriculture tab groups four independent automation worlds. No pane is a
// combined property dashboard and there is deliberately no mixed device grid.
// Each visual surface explains one automation and its own physical domain.
const panes = [
  { kind: "automation", ref: "farm-water", x: 0, y: 0, w: 6, h: 13 },
  { kind: "automation", ref: "farm-livestock", x: 6, y: 0, w: 6, h: 13 },
  { kind: "automation", ref: "farm-troughs", x: 0, y: 13, w: 6, h: 13 },
  { kind: "automation", ref: "farm-energy", x: 6, y: 13, w: 6, h: 13 },
];

export default { tab, devices, automations, panes, dataStore };
