// scripts/seed/tabs/research-vessel/rov.mjs — demo automation manifest (source lives in scripts/seed/projects/vessel-rov)
export const rovAutomation = {
  "key": "vessel-rov",
  "name": "ROV Operations",
  "triggerTopic": "sensor/rov/#",
  "demoAccess": {
    "fireEvents": [
      "rov-dive",
      "rov-survey",
      "rov-hold",
      "rov-recover",
      "simulate-rov-current",
      "reset-rov"
    ]
  },
  "projectDir": "vessel-rov"
};
