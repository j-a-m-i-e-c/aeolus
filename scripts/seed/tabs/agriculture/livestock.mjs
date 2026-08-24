// scripts/seed/tabs/agriculture/livestock.mjs — demo automation manifest (source lives in scripts/seed/projects/farm-livestock)
export const livestockAutomation = {
  "key": "farm-livestock",
  "name": "Livestock & Virtual Fence",
  "triggerTopic": "sensor/fence/#",
  "demoAccess": {
    "fireEvents": [
      "recall-strays",
      "simulate-strays",
      "move-herd",
      "simulate-fence-fault",
      "restore-fence",
      "reset-livestock"
    ]
  },
  "projectDir": "farm-livestock"
};
