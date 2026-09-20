// demo/seed/tabs/underground-mining/mine-overview.mjs — demo automation manifest (source lives in demo/seed/projects/mine-overview)
export const mineOverviewAutomation = {
  "key": "mine-overview",
  "name": "Mine Operations Overview",
  // Woken by a durable Shared State change, not by a broker topic (ADR-0016). The
  // subsystems write `mine-summary/atmosphere`, `/ventilation`, `/personnel` and
  // `/dewatering`; this pattern is the internal path, so internal overview composition
  // no longer travels through `aeolus/events/...`.
  "triggerType": "shared-state",
  "triggerTopic": "mine-summary/#",
  "projectDir": "mine-overview"
};
