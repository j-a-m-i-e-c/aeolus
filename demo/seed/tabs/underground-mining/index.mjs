import { mineOverviewAutomation } from "./mine-overview.mjs";
import { atmosphereAutomation } from "./atmosphere.mjs";
import { atmosphereHistoryAutomation } from "./atmosphere-history.mjs";
import { ventilationAutomation } from "./ventilation.mjs";
import { personnelAutomation } from "./personnel.mjs";
import { dewateringAutomation } from "./dewatering.mjs";
import { dewateringHistoryAutomation } from "./dewatering-history.mjs";
import { dataStore } from "./data-store.mjs";

const tab = { id: "tab-mining", name: "Underground Mining", icon: "mountain" };
const devices = [];
// The two History automations are headless: they record the gas and sump records
// on a schedule and own no pane. Keeping them out of Atmospheric Safety and
// Dewatering leaves those control paths free of retention concerns.
const automations = [
  mineOverviewAutomation,
  atmosphereAutomation,
  atmosphereHistoryAutomation,
  ventilationAutomation,
  personnelAutomation,
  dewateringAutomation,
  dewateringHistoryAutomation,
];

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
