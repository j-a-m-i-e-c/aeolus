import { genSeries, round, noise } from "../../lib.mjs";

export const dataStore = [
  {
    name: "tank-levels",
    description: "Shed catchment, header, office & house tank levels (72h)",
    retentionDays: 90,
    records: genSeries({
      count: 72,
      intervalMs: 3_600_000,
      fields: {
        shedCatchment: (i) => round(80 - i * 0.08 + noise(1.5), 0),
        header: (i) => round(55 + Math.sin(i / 5) * 25 + noise(3), 0),
        office: (i) => round(75 + Math.sin(i / 12) * 8 + noise(2), 0),
        house: (i) => round(50 + Math.sin(i / 4) * 22 + noise(3), 0),
      },
    }),
  },
];
