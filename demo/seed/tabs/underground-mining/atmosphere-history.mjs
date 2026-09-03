// demo/seed/tabs/underground-mining/atmosphere-history.mjs — demo automation manifest (source lives in demo/seed/projects/mine-atmosphere-history)
//
// Headless on purpose: recording the gas record is not an operator task, so this
// automation has no UI and owns no dashboard pane. Keeping it separate from
// Atmospheric Safety also keeps the alarm path clear of retention concerns.
export const atmosphereHistoryAutomation = {
  "key": "mine-atmosphere-history",
  "name": "Atmospheric History",
  "cron": "*/5 * * * *",
  "projectDir": "mine-atmosphere-history"
};
