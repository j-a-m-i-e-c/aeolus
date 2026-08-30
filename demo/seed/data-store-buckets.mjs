// demo/seed/data-store-buckets.mjs — Global key/value examples for the demo.
//
// Collections are naturally owned by domain tabs. Buckets are intentionally
// shared, unscoped persistent state in Aeolus, so the showcase keeps their seed
// data here instead of inventing a fake tab owner. These are snapshots/examples,
// not a hidden automation-to-automation coordination channel.

const seededAt = new Date().toISOString();

export const demoBuckets = [
  {
    name: "demo-runtime",
    entries: {
      "dataset": "Aeolus multi-domain showcase",
      "seeded-at": seededAt,
      "reset-policy": "Cleared and reseeded whenever the demo seed is rebuilt",
      "storage-modes": ["time-series collections", "key/value buckets"],
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
