import { genSeries, round, noise } from "../../lib.mjs";

export const dataStore = [
  {
    name: "gas-readings",
    description: "Multi-gas atmospheric readings from Level 3 and Drift 7 (48h)",
    retentionDays: 90,
    records: genSeries({
      count: 96,
      intervalMs: 30 * 60_000,
      fields: {
        location: (i) => (i % 2 === 0 ? "Level 3" : "Drift 7"),
        ch4: (i) => round(0.25 + Math.sin(i / 8) * 0.11 + noise(0.05), 2),
        co: (i) => round(13 + Math.sin(i / 11) * 6 + noise(2), 0),
        o2: () => round(20.8 + noise(0.08), 1),
        no2: (i) => round(1.4 + Math.sin(i / 13) * 0.6 + noise(0.18), 1),
      },
    }),
  },
  {
    name: "mine-water",
    description: "Deep sump level and pump duty history",
    retentionDays: 90,
    records: genSeries({
      count: 72,
      intervalMs: 60 * 60_000,
      fields: {
        levelM: (i) => round(1.7 + Math.sin(i / 5) * 0.45 + noise(0.12), 2),
        inflowLps: (i) => round(18 + Math.max(0, Math.sin(i / 9)) * 12 + noise(2), 0),
        pumpDutyPct: (i) => round(18 + Math.max(0, Math.sin(i / 7)) * 22 + noise(3), 0),
      },
    }),
  },
];
