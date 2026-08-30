// demo/seed/tabs/underground-mining/dewatering.mjs — demo automation manifest (source lives in demo/seed/projects/mine-dewatering)
export const dewateringAutomation = {
  "key": "mine-dewatering",
  "name": "Dewatering",
  "triggerTopic": "sensor/mine/sump/#",
  "demoAccess": {
    "fireEvents": [
      "pump-on",
      "pump-off",
      "toggle-auto",
      "simulate-heavy-inflow",
      "reset-sump"
    ]
  },
  "projectDir": "mine-dewatering"
};
