// scripts/seed/tabs/research-vessel/ctd.mjs — demo automation manifest (source lives in scripts/seed/projects/vessel-ctd)
export const ctdAutomation = {
  "key": "vessel-ctd",
  "name": "CTD Operations",
  "triggerTopic": "sensor/ctd/#",
  "demoAccess": {
    "fireEvents": [
      "deploy-420",
      "hold-ctd",
      "recover-ctd",
      "simulate-snag",
      "reset-ctd"
    ]
  },
  "projectDir": "vessel-ctd"
};
