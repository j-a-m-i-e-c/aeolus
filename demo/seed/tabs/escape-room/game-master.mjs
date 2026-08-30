// demo/seed/tabs/escape-room/game-master.mjs — demo automation manifest (source lives in demo/seed/projects/escape-game-master)
export const gameMasterAutomation = {
  "key": "escape-game-master",
  "name": "Game Master",
  "triggerTopic": "aeolus/events/+/escape/puzzles/#",
  "demoAccess": {
    "fireEvents": [
      "add-time",
      "sub-time",
      "pause",
      "hint-nudge",
      "hint-strong",
      "hint-solve",
      "look-calm",
      "look-puzzle",
      "look-tension",
      "talk-start",
      "talk-stop"
    ]
  },
  "projectDir": "escape-game-master"
};
