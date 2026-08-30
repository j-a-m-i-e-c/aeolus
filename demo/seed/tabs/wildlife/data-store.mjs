import { genSeries, noise } from "../../lib.mjs";

// Data Store collections for the Wildlife tab. Shape matches seedCollection():
// an array of { name, description?, retentionDays?, records: [{payload, timestamp?}] }.
// The detection Logic appends live rows to "wildlife-events" (same payload shape).
export const dataStore = [
  {
    name: "wildlife-events",
    description: "Classified on-device wildlife detections",
    retentionDays: 90,
    // Seeded history so the collection is populated on first load; the seeded
    // Logic appends live rows (same shape) as visitors trigger detections.
    records: [
      { payload: { species: "Ringtail Possum", category: "native", confidence: 0.94 }, timestamp: Date.now() - 5_400_000 },
      { payload: { species: "Superb Lyrebird", category: "native", confidence: 0.96 }, timestamp: Date.now() - 3_600_000 },
      { payload: { species: "Red Fox", category: "predator", confidence: 0.97 }, timestamp: Date.now() - 1_800_000 },
      { payload: { species: "Short-beaked Echidna", category: "native", confidence: 0.89 }, timestamp: Date.now() - 600_000 },
    ],
  },
  {
    name: "wildlife-detections",
    description: "Hourly native and introduced-animal detection totals (7 days)",
    retentionDays: 90,
    records: genSeries({
      count: 168,
      intervalMs: 3_600_000,
      fields: {
        native: (i) => {
          const h = ((i % 24) + 24) % 24;
          const noct = (h >= 19 || h < 6) ? 3.2 : 0.7;
          return Math.max(0, Math.round(noct + noise(1.1)));
        },
        predator: (i) => {
          const h = ((i % 24) + 24) % 24;
          const noct = (h >= 20 || h < 6) ? 1.1 : 0.15;
          return Math.max(0, Math.round(noct + noise(0.5)));
        },
      },
    }),
  },
];
