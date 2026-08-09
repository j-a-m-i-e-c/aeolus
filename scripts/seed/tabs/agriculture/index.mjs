// scripts/seed/tabs/agriculture/index.mjs — Agriculture showcase composition.
//
// The visual tab remains one coherent property-operations surface, while the
// backend is split by real responsibility. Each domain module may export more
// than one Aeolus rule because the current runtime stores one trigger pattern per
// rule; the domain boundary, not the rule count, is the architectural unit.

import { consoleAutomation } from "./console.mjs";
import { waterAutomations } from "./water.mjs";
import { livestockAutomations } from "./livestock.mjs";
import { troughAutomations } from "./troughs.mjs";
import { energyAutomations } from "./energy.mjs";
import { dataStore } from "./data-store.mjs";

const tab = { id: "tab-agriculture", name: "Agriculture", icon: "sprout" };

// Phase 3 physical truth is owned by the separate MQTT simulator. The seed no
// longer impersonates Farm hardware by publishing fake state messages itself.
const devices = [];

const automations = [
  consoleAutomation,
  ...waterAutomations,
  ...livestockAutomations,
  ...troughAutomations,
  ...energyAutomations,
];

// Only the console owns the rich custom UI. The domain rules stay invisible in
// the operator layout but remain first-class automations in Aeolus.
const panes = [
  { kind: "automation", ref: "farm-console", x: 0, y: 0, w: 12, h: 17 },
  { kind: "device-grid", x: 0, y: 17, w: 12, h: 6 },
];

export default { tab, devices, automations, panes, dataStore };
