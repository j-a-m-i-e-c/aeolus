// demo/seed/tabs/underground-mining/dewatering-history.mjs — demo automation manifest (source lives in demo/seed/projects/mine-dewatering-history)
//
// Headless on purpose: recording the sump record is not an operator task, so this
// automation has no UI and owns no dashboard pane.
export const dewateringHistoryAutomation = {
  "key": "mine-dewatering-history",
  "name": "Dewatering History",
  "cron": "*/5 * * * *",
  "projectDir": "mine-dewatering-history"
};
