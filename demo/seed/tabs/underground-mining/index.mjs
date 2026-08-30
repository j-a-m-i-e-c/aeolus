import { mineOverviewAutomation } from "./mine-overview.mjs";
import { atmosphereAutomation } from "./atmosphere.mjs";
import { ventilationAutomation } from "./ventilation.mjs";
import { personnelAutomation } from "./personnel.mjs";
import { dewateringAutomation } from "./dewatering.mjs";
import { dataStore } from "./data-store.mjs";

const tab = { id: "tab-mining", name: "Underground Mining", icon: "mountain" };
const devices = [];
const automations = [mineOverviewAutomation, atmosphereAutomation, ventilationAutomation, personnelAutomation, dewateringAutomation];

// The cutaway is a read-only supervisory view. Each control surface below owns
// exactly one real mine responsibility; no hidden mine coordinator exists.
const panes = [
  { kind: "automation", ref: "mine-overview", x: 0, y: 0, w: 12, h: 13 },
  { kind: "automation", ref: "mine-atmosphere", x: 0, y: 13, w: 6, h: 11 },
  { kind: "automation", ref: "mine-ventilation", x: 6, y: 13, w: 6, h: 11 },
  { kind: "automation", ref: "mine-personnel", x: 0, y: 24, w: 6, h: 11 },
  { kind: "automation", ref: "mine-dewatering", x: 6, y: 24, w: 6, h: 11 },
];

export default { tab, devices, automations, panes, dataStore };
