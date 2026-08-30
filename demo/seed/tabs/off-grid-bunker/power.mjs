// demo/seed/tabs/off-grid-bunker/power.mjs — demo automation manifest (source lives in demo/seed/projects/bunker-power)
export const bunkerPowerAutomation = {
  "key": "bunker-power",
  "name": "Power & Supplies",
  "triggerTopic": "sensor/bunker/#",
  "demoAccess": {
    "fireEvents": [
      "generator-on",
      "generator-off",
      "simulate-low-power",
      "reset-power"
    ]
  },
  "projectDir": "bunker-power"
};
