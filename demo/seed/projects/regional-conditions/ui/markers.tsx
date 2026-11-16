// One shape and one palette per layer, shared by the map and its legend so the two can
// never disagree. Each layer's colours come from a separate family so a marker can be
// told apart by colour as well as by shape:
//
//   River gauge   circle    colour = trend over the last hour (amber, teal, blue), grey when stale
//   Rain gauge    raindrop  colour = rain in the latest complete hour (lilac to magenta)
//   RFS incident  flame     colour = RFS alert level (cream, orange, red)

export const RIVER = {
  rising: '#F0B860',
  falling: '#4FD1B5',
  steady: '#3E9FD6',
  stale: '#6E7F8A',
  suspect: '#EAB77B',
  ring: '#D8F4FF',
};

// Millimetres in the latest complete hour, heaviest first.
export const RAIN_BINS: { min: number; colour: string; label: string }[] = [
  { min: 20, colour: '#F052A8', label: '20+ mm' },
  { min: 10, colour: '#C24FD0', label: '10–20' },
  { min: 4, colour: '#9160E0', label: '4–10' },
  { min: 1, colour: '#B28CF0', label: '1–4' },
  { min: 0.01, colour: '#DCCBF7', label: 'under 1' },
];
export const RAIN_DRY = '#C9D2F0';
export const RAIN_STALE = '#6E7F8A';

export function rainColour(mm: number): string {
  return (RAIN_BINS.find((bin) => mm >= bin.min) ?? RAIN_BINS[RAIN_BINS.length - 1]).colour;
}

export const FIRE = {
  advice: '#F1DDA8',
  watchAndAct: '#F59A3C',
  emergency: '#FF5C5C',
};

export function fireColour(alert: unknown): string {
  const v = String(alert || '').toLowerCase();
  return v.includes('emergency') ? FIRE.emergency : v.includes('watch') ? FIRE.watchAndAct : FIRE.advice;
}

type At = { x: number; y: number };

/** River gauge: a filled circle with a bright centre. Suspect readings get a dashed amber ring. */
export function RiverGlyph({ x, y, fill, suspect = false, r = 9 }: At & { fill: string; suspect?: boolean; r?: number }) {
  return <g>
    <circle cx={x} cy={y} r={r} fill={fill} stroke={suspect ? RIVER.suspect : RIVER.ring}
      strokeWidth={suspect ? 2.5 : 1.4} strokeDasharray={suspect ? '3 2' : undefined} />
    <circle cx={x} cy={y} r={r * 0.28} fill="#F2FCFF" />
  </g>;
}

/** Rain gauge: a raindrop, point up. Filled when it rained, outlined when dry, dashed grey when stale. */
export function RainGlyph({ x, y, fill, stroke, dashed = false, size = 11 }: At & { fill: string; stroke: string; dashed?: boolean; size?: number }) {
  const s = size;
  const d = `M${x},${y - s} C${x + s * 0.55},${y - s * 0.3} ${x + s * 0.72},${y + s * 0.12} ${x + s * 0.72},${y + s * 0.34}`
    + ` A${s * 0.72},${s * 0.72} 0 0 1 ${x - s * 0.72},${y + s * 0.34}`
    + ` C${x - s * 0.72},${y + s * 0.12} ${x - s * 0.55},${y - s * 0.3} ${x},${y - s} Z`;
  return <path d={d} fill={fill} stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeDasharray={dashed ? '3 2' : undefined} />;
}

/** RFS incident: a flame on a dark disc, so it reads as a different kind of thing from a gauge. */
export function FireGlyph({ x, y, colour, r = 12 }: At & { colour: string; r?: number }) {
  const k = r / 12;
  return <g>
    <circle cx={x} cy={y} r={r} fill="#160F0C" stroke={colour} strokeWidth={2.2} />
    <path d={`M${x},${y - 7 * k} C${x + 6 * k},${y - 1 * k} ${x + 6 * k},${y + 7 * k} ${x},${y + 7 * k}`
      + ` C${x - 6 * k},${y + 7 * k} ${x - 6 * k},${y + 1 * k} ${x - 2 * k},${y - 3 * k}`
      + ` C${x - 1 * k},${y} ${x + 1 * k},${y} ${x},${y - 7 * k} Z`} fill={colour} />
  </g>;
}
