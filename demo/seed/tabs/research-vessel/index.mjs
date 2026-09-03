import { missionOverviewAutomation } from "./mission-overview.mjs";
import { ctdAutomation } from "./ctd.mjs";
import { ctdHistoryAutomation } from "./ctd-history.mjs";
import { rovAutomation } from "./rov.mjs";
import { underwayAutomation } from "./underway.mjs";
import { dataStore } from "./data-store.mjs";

const tab = { id: "tab-research-vessel", name: "Research Vessel", icon: "ship" };
const devices = [];
// CTD History is headless: it records the cast record on a schedule and owns no
// pane, because how often history is written is a retention decision rather than
// something an operator drives.
const automations = [missionOverviewAutomation, ctdAutomation, ctdHistoryAutomation, rovAutomation, underwayAutomation];

// The hero is a read-only scientific mission view. CTD, ROV and underway
// science remain the three owning applications below it.
const panes = [
  { kind: "automation", ref: "vessel-mission-overview", x: 0, y: 0, w: 12, h: 13 },
  { kind: "automation", ref: "vessel-ctd", x: 0, y: 13, w: 6, h: 12 },
  { kind: "automation", ref: "vessel-rov", x: 6, y: 13, w: 6, h: 12 },
  { kind: "automation", ref: "vessel-underway", x: 0, y: 25, w: 12, h: 10 },
];

export default { tab, devices, automations, panes, dataStore };
