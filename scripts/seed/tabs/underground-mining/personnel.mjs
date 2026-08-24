// scripts/seed/tabs/underground-mining/personnel.mjs — demo automation manifest (source lives in scripts/seed/projects/mine-personnel)
export const personnelAutomation = {
  "key": "mine-personnel",
  "name": "Personnel & Muster",
  "triggerTopic": "sensor/mine/personnel",
  "demoAccess": {
    "fireEvents": [
      "initiate-muster",
      "clear-muster",
      "simulate-tag-dropout",
      "reset-personnel"
    ]
  },
  "projectDir": "mine-personnel"
};
