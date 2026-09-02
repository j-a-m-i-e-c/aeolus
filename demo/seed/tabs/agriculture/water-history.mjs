// demo/seed/tabs/agriculture/water-history.mjs — demo automation manifest (source lives in demo/seed/projects/farm-water-history)
//
// Headless on purpose: this automation has no UI because it has nothing for an
// operator to do. It records site history on a schedule, which is also how the
// showcase demonstrates that an Aeolus automation need not own a dashboard pane.
export const waterHistoryAutomation = {
  "key": "farm-water-history",
  "name": "Water History",
  "cron": "*/5 * * * *",
  "projectDir": "farm-water-history"
};
