// scripts/seed/tabs/underground-mining/atmosphere.mjs — demo automation manifest (source lives in scripts/seed/projects/mine-atmosphere)
export const atmosphereAutomation = {
  "key": "mine-atmosphere",
  "name": "Atmospheric Safety",
  "triggerTopic": "sensor/mine/gas/#",
  "demoAccess": {
    "fireEvents": [
      "acknowledge-alarm",
      "simulate-gas-rise",
      "reset-atmosphere"
    ]
  },
  "projectDir": "mine-atmosphere"
};
