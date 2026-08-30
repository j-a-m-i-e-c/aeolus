// demo/seed/tabs/stage-show/sequencer.mjs — demo automation manifest (source lives in demo/seed/projects/stage-show-sequencer)
export const showSequencerAutomation = {
  "key": "stage-show-sequencer",
  "name": "Show Control",
  "triggerTopic": "+/stage/#",
  "demoAccess": {
    "fireEvents": [
      "run-cue",
      "fire-effect",
      "stop-fx",
      "simulate-trip",
      "reset-safety"
    ]
  },
  "projectDir": "stage-show-sequencer"
};
