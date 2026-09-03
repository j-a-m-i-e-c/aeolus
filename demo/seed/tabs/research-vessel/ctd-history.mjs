// demo/seed/tabs/research-vessel/ctd-history.mjs — demo automation manifest (source lives in demo/seed/projects/vessel-ctd-history)
//
// Headless on purpose: recording the cast record is not an operator task, so this
// automation has no UI and owns no dashboard pane.
export const ctdHistoryAutomation = {
  "key": "vessel-ctd-history",
  "name": "CTD History",
  "cron": "*/5 * * * *",
  "projectDir": "vessel-ctd-history"
};
