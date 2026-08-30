import { genSeries, round, noise } from "../../lib.mjs";

export const dataStore = [
  {
    name: "ctd-casts",
    description: "CTD cast samples: depth, temperature, salinity, dissolved oxygen",
    retentionDays: 180,
    records: genSeries({
      count: 110,
      intervalMs: 12_000,
      fields: {
        depth: (i) => Math.min(500, i * 4.6),
        temperature: (i) => round(18.5 - 14.3 / (1 + Math.exp(-((i * 4.6) - 90) / 18)) + noise(0.08), 2),
        salinity: (i) => round(35.0 - 0.4 / (1 + Math.exp(-((i * 4.6) - 90) / 40)) + noise(0.015), 3),
        oxygen: (i) => round(6.3 - Math.min(2, (i * 4.6) / 420) + noise(0.06), 2),
      },
    }),
  },
];
