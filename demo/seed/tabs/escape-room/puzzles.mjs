// demo/seed/tabs/escape-room/puzzles.mjs — demo automation manifest (source lives in demo/seed/projects/escape-puzzles)
export const puzzleProgressAutomation = {
  "key": "escape-puzzles",
  "name": "Puzzle Progress",
  "triggerTopic": "sensor/escape/puzzles",
  "demoAccess": {
    "fireEvents": [
      "simulate-solve",
      "reset-puzzles"
    ]
  },
  "projectDir": "escape-puzzles"
};
