// demo/seed/tabs/underground-mining/ventilation.mjs — demo automation manifest (source lives in demo/seed/projects/mine-ventilation)
export const ventilationAutomation = {
  "key": "mine-ventilation",
  "name": "Ventilation Control",
  "triggerTopic": "aeolus/events/+/mine/atmosphere/#",
  "demoAccess": {
    "fireEvents": [
      "force-boost",
      "return-auto"
    ]
  },
  "projectDir": "mine-ventilation"
};
