// demo/seed/tabs/wildlife/nest-monitoring.mjs — demo automation manifest (source lives in demo/seed/projects/wildlife-nest-monitoring)
export const nestMonitoringAutomation = {
  "key": "wildlife-nest-monitoring",
  "name": "Sugar Glider Den",
  "triggerTopic": "sensor/wildlife/nest",
  "demoAccess": {
    "fireEvents": [
      "toggle-auto-cooling",
      "stop-cooling",
      "simulate-visit",
      "simulate-heat",
      "reset-nest"
    ]
  },
  "projectDir": "wildlife-nest-monitoring"
};
