// scripts/seed/tabs/wildlife/detection.mjs — demo automation manifest (source lives in scripts/seed/projects/wildlife-detection)
export const wildlifeDetectionAutomation = {
  "key": "wildlife-detection",
  "name": "Wildlife Detection",
  "triggerTopic": "sensor/wildlife/#",
  "demoAccess": {
    "fireEvents": [
      "simulate-native",
      "simulate-fox",
      "simulate-cat",
      "reset-wildlife"
    ]
  },
  "projectDir": "wildlife-detection"
};
