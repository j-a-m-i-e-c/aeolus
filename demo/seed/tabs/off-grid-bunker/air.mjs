// demo/seed/tabs/off-grid-bunker/air.mjs — demo automation manifest (source lives in demo/seed/projects/bunker-air)
export const bunkerAirAutomation = {
  "key": "bunker-air",
  "name": "Air & Filtration",
  "triggerTopic": "switch/bunker/filter/state",
  "demoAccess": {
    "fireEvents": [
      "seal",
      "unseal"
    ]
  },
  "projectDir": "bunker-air"
};
