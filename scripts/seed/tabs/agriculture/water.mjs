// scripts/seed/tabs/agriculture/water.mjs — demo automation manifest (source lives in scripts/seed/projects/farm-water)
export const waterAutomation = {
  "key": "farm-water",
  "name": "Water Management",
  "triggerTopic": "sensor/farm/#",
  "demoAccess": {
    "fireEvents": [
      "transfer-500",
      "transfer-1000",
      "pump-stop",
      "simulate-header-low",
      "simulate-property-demand",
      "reset-water"
    ]
  },
  "projectDir": "farm-water"
};
