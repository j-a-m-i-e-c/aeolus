// demo/seed/tabs/off-grid-bunker/comms.mjs — demo automation manifest (source lives in demo/seed/projects/bunker-comms)
export const bunkerCommsAutomation = {
  "key": "bunker-comms",
  "name": "Communications",
  "triggerTopic": "sensor/bunker/radio/#",
  "demoAccess": {
    "fireEvents": [
      "transmit-checkin",
      "simulate-contact"
    ]
  },
  "projectDir": "bunker-comms"
};
