import { missionOverviewAutomation } from "./mission-overview.mjs";
import { stationKeepingAutomation } from "./station-keeping.mjs";
import { ctdAutomation } from "./ctd.mjs";
import { rovAutomation } from "./rov.mjs";
import { underwayAutomation } from "./underway.mjs";
import { dataStore } from "./data-store.mjs";

const tab = { id: "tab-research-vessel", name: "Research Vessel", icon: "ship" };

// The physical vessel is owned by the separate MQTT simulator. The seed does
// not impersonate hardware or publish device state.
const devices = [];

const automations = [
  missionOverviewAutomation,
  stationKeepingAutomation,
  ctdAutomation,
  rovAutomation,
  underwayAutomation,
];

// A real hero makes sense on a vessel: all four physical systems occupy the same
// ship and water column. The overview is read-only and receives only bounded
// summary events from the four owning automations; it is not a coordinator.
const panes = [
  { kind: "automation", ref: "vessel-mission-overview", x: 0, y: 0, w: 12, h: 13 },
  { kind: "automation", ref: "vessel-station-keeping", x: 0, y: 13, w: 6, h: 11 },
  { kind: "automation", ref: "vessel-ctd", x: 6, y: 13, w: 6, h: 11 },
  { kind: "automation", ref: "vessel-rov", x: 0, y: 24, w: 6, h: 11 },
  { kind: "automation", ref: "vessel-underway", x: 6, y: 24, w: 6, h: 11 },
];

export default { tab, devices, automations, panes, dataStore };
