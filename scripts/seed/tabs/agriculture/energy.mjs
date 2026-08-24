// scripts/seed/tabs/agriculture/energy.mjs — demo automation manifest (source lives in scripts/seed/projects/farm-energy)
export const energyAutomation = {
  "key": "farm-energy",
  "name": "Site Energy",
  "triggerTopic": "sensor/farm/energy/#",
  "demoAccess": {
    "fireEvents": [
      "simulate-low-battery",
      "restore-battery",
      "toggle-opportunity",
      "reset-energy"
    ]
  },
  "projectDir": "farm-energy"
};
