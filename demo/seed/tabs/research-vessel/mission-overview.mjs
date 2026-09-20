// demo/seed/tabs/research-vessel/mission-overview.mjs — demo automation manifest (source lives in demo/seed/projects/vessel-mission-overview)
export const missionOverviewAutomation = {
  "key": "vessel-mission-overview",
  "name": "Mission Overview",
  // Woken by a durable Shared State change, not by a broker topic (ADR-0016). CTD, ROV
  // and underway science write `vessel-summary/ctd`, `/rov` and `/underway`; this
  // pattern is the internal path, so internal overview composition no longer travels
  // through `aeolus/events/...`.
  "triggerType": "shared-state",
  "triggerTopic": "vessel-summary/#",
  "projectDir": "vessel-mission-overview"
};
