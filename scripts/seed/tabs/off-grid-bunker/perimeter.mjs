// scripts/seed/tabs/off-grid-bunker/perimeter.mjs — demo automation manifest (source lives in scripts/seed/projects/bunker-perimeter)
export const bunkerPerimeterAutomation = {
  "key": "bunker-perimeter",
  "name": "Perimeter Security",
  "triggerTopic": "+/bunker/#",
  "demoAccess": {
    "fireEvents": [
      "toggle-lights",
      "return-auto",
      "simulate-contacts",
      "clear-perimeter"
    ]
  },
  "projectDir": "bunker-perimeter"
};
