// demo/seed/shared-state.mjs — Showcase Shared State fixtures.
//
// Shared State is durable current values that automations intentionally share
// (ADR-0016). It is core, always available, and deliberately global — it has no
// tab owner — so the showcase declares its fixtures here rather than inventing a
// fake owning tab for them.
//
// These particular buckets are illustrative: they show an operator what Shared
// State looks like in the UI. The showcase's real coordination state is written at
// runtime and is not declared here: the subsystem summaries the overview automations
// compose from (`bunker-summary`, `mine-summary`, `vessel-summary`), the physical
// facts Game Master reads (`escape-observed`), and the seeder's own ledger
// (`_showcase:seed-ledger`). Undeclared means a reseed leaves those buckets alone —
// the automations that own them write them again as soon as the room reports.
//
// What does NOT belong here is history. Timestamped observations are Data Store
// Collections, which accumulate and are separately bounded by retention limits.

const seededAt = new Date().toISOString();

export const sharedStateBuckets = [
  {
    name: "demo-runtime",
    entries: {
      "dataset": "Aeolus multi-domain showcase",
      "seeded-at": seededAt,
      "reset-policy": "Cleared and reseeded whenever the demo seed is rebuilt",
      // Named as two distinct facilities, not as two modes of one store. Describing
      // Shared State as a "storage mode" of the Data Store is the mental model
      // ADR-0016 exists to correct.
      "what-aeolus-stores": {
        "shared-state": "durable current values shared between automations",
        "collections": "historical observations, optional and retention-bounded",
      },
    },
  },
  {
    name: "policy-snapshots",
    entries: {
      "farm-water": {
        headerLowPct: 30,
        headerRecoveryPct: 70,
        troughRefillPct: 45,
        energyStopSocPct: 30,
      },
      "mine-atmosphere": {
        methaneWarningPct: 0.5,
        methaneAlarmPct: 1.0,
        normalVentDemandPct: 48,
        alarmVentDemandPct: 100,
      },
      "wildlife-response": {
        mode: "humane light/sound pulse",
        pulseMs: 6200,
        actOnCategory: "predator",
      },
    },
  },
  {
    name: "latest-checkpoints",
    entries: {
      "farm-water-transfer": {
        outcome: "observed",
        deliveredLitres: 500,
        note: "Example persisted batch summary",
      },
      "research-ctd": {
        outcome: "recovered",
        maxDepthM: 420,
        note: "Example persisted cast checkpoint",
      },
      "wildlife-detection": {
        species: "Red Fox",
        category: "predator",
        confidence: 0.97,
        note: "Example persisted classification summary",
      },
    },
  },
];
