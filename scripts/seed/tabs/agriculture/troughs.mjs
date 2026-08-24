// scripts/seed/tabs/agriculture/troughs.mjs — demo automation manifest (source lives in scripts/seed/projects/farm-troughs)
export const troughAutomation = {
  "key": "farm-troughs",
  "name": "Trough Watering",
  "triggerTopic": "sensor/farm/troughs",
  "demoAccess": {
    "fireEvents": [
      "refill-troughs",
      "simulate-drinking",
      "toggle-auto",
      "reset-troughs"
    ]
  },
  "projectDir": "farm-troughs"
};
