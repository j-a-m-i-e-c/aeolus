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
// science remain the three owning applications below it. Where each sits is in
// demo/seed/layouts/showcase-layout.json (§7.2).

export default { tab, devices, automations, dataStore };
