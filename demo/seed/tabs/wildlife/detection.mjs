// demo/seed/tabs/wildlife/detection.mjs — demo automation manifest (source lives in demo/seed/projects/wildlife-detection)
export const wildlifeDetectionAutomation = {
  "key": "wildlife-detection",
  "name": "Wildlife Detection",
  // `+/wildlife/#` rather than `sensor/wildlife/#` so a deterrent publish also wakes
  // this automation. The hero pane shows the physical consequence of a classification,
  // and the deterrent's fan spinning up is the interesting part of it — on the narrower
  // pattern the pane would hold a stale rpm until the next sensor message. Still a
  // read-only interest: the deterrent belongs to Predator Response (showcase-cleanup
  // §6.1, §6.2).
  "triggerTopic": "+/wildlife/#",
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
