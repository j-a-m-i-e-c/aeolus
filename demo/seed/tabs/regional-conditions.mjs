// demo/seed/tabs/regional-conditions.mjs — Regional Conditions demo manifest.
// Authored Logic/UI lives in demo/seed/projects/regional-conditions/.
//
// Like Space, this tab is driven by real public data rather than the simulator: WaterNSW
// river and rain gauges plus NSW RFS feeds. No devices, and no seeded fixtures, because
// every number on it must come from a source that can be named.
const tab = {
  "id": "tab-regional-conditions",
  "name": "Regional Conditions",
  "icon": "cloud-rain"
};
const devices = [];
const automations = [{
  "key": "regional-conditions",
  "name": "Regional Conditions",
  "cron": "*/10 * * * *",
  "demoAccess": {
    "fireEvents": [
      "refresh"
    ]
  },
  "projectDir": "regional-conditions"
}];
// Pane geometry lives in demo/seed/layouts/showcase-layout.json (§7.2).
const dataStore = [];
export default { tab, devices, automations, dataStore };
