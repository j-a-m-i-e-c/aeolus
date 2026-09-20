// demo/seed/tabs/off-grid-bunker/overview.mjs — demo automation manifest (source lives in demo/seed/projects/bunker-overview)
export const bunkerOverviewAutomation = {
  "key": "bunker-overview",
  "name": "Bunker Overview",
  // Woken by a durable Shared State change, not by a broker topic (ADR-0016). The
  // subsystems write `bunker-summary/power`, `/air`, `/perimeter` and `/comms`; this
  // pattern is the internal path, so internal overview composition no longer travels
  // through `aeolus/events/...`.
  "triggerType": "shared-state",
  "triggerTopic": "bunker-summary/#",
  "projectDir": "bunker-overview"
};
