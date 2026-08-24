// scripts/seed/tabs/space.mjs — Live Space demo manifest.
// Authored Logic/UI lives in scripts/seed/projects/space/.

const tab = {
  "id": "tab-space",
  "name": "Live Space",
  "icon": "rocket"
};
const devices = [];
const automations = [{
  "key": "space",
  "name": "Live Space",
  "cron": "* * * * *",
  "demoAccess": {
    "fireEvents": [
      "refresh"
    ]
  },
  "projectDir": "space"
}];
const panes = [
  {
    "kind": "automation",
    "ref": "space",
    "x": 0,
    "y": 0,
    "w": 12,
    "h": 24
  }
];
const dataStore = [
  {
    "name": "iss-track",
    "description": "Recent ISS positions captured from the live public feed",
    "retentionDays": 7,
    "records": [
      {
        "payload": {
          "lat": -12.4,
          "lon": 130.8,
          "alt": 419
        },
        "timestamp": 1787479048448
      },
      {
        "payload": {
          "lat": 8.7,
          "lon": 145.2,
          "alt": 421
        },
        "timestamp": 1787479648448
      },
      {
        "payload": {
          "lat": 27.3,
          "lon": 162.5,
          "alt": 417
        },
        "timestamp": 1787480248448
      },
      {
        "payload": {
          "lat": 41.9,
          "lon": -179.1,
          "alt": 420
        },
        "timestamp": 1787480728448
      }
    ]
  }
];

export default { tab, devices, automations, panes, dataStore };
