// demo/seed/tabs/escape-room/room-fx.mjs — demo automation manifest (source lives in demo/seed/projects/escape-room-fx)
export const roomFxAutomation = {
  "key": "escape-room-fx",
  "name": "Room Systems",
  "triggerTopic": "aeolus/events/+/escape/game/#",
  "demoAccess": {
    "fireEvents": [
      "toggle-smoke"
    ]
  },
  "projectDir": "escape-room-fx"
};
