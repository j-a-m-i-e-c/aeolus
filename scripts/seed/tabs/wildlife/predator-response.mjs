// scripts/seed/tabs/wildlife/predator-response.mjs — demo automation manifest (source lives in scripts/seed/projects/wildlife-predator-response)
export const predatorResponseAutomation = {
  "key": "wildlife-predator-response",
  "name": "Predator Response",
  "triggerTopic": "aeolus/events/+/wildlife/detection/classified",
  "demoAccess": {
    "fireEvents": [
      "toggle-armed",
      "stop-deterrent"
    ]
  },
  "projectDir": "wildlife-predator-response"
};
