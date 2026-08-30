// demo/seed/tabs/research-vessel/underway.mjs — demo automation manifest (source lives in demo/seed/projects/vessel-underway)
export const underwayAutomation = {
  "key": "vessel-underway",
  "name": "Underway Science",
  "triggerTopic": "sensor/underway/#",
  "demoAccess": {
    "fireEvents": [
      "sampling-start",
      "sampling-stop",
      "simulate-front",
      "reset-underway"
    ]
  },
  "projectDir": "vessel-underway"
};
